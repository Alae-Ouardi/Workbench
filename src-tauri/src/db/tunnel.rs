//! The steps of `omnevo-db-connector.sh`, done natively: read the database
//! secret, make sure the relay (socat) pod runs, and describe it. Values from
//! the secret are validated before they go anywhere near the pod's command.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use base64::Engine;
use serde_json::{json, Value};

use crate::k8s::kubectl::{self, check_name, QUICK, SLOW};
use crate::proc;

pub const RELAY_IMAGE: &str = "alpine/socat";
pub const RELAY_LABEL: &str = "taskboard-socat";
/// Records which database host:port a relay pod forwards to.
pub const TARGET_ANNOTATION: &str = "taskboard/target";
/// The relay stops itself after an hour, so a crash never leaves it running.
pub const RELAY_LIFETIME_SECS: u64 = 3600;
const POD_READY_TIMEOUT: Duration = Duration::from_secs(120);

/// Credentials read from the cluster secret. Only ever held in Rust.
#[derive(Clone)]
pub struct DbSecret {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: String,
}

impl std::fmt::Debug for DbSecret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DbSecret").field("host", &self.host).field("port", &self.port).field("user", &self.user).finish_non_exhaustive()
    }
}

fn is_hostname(s: &str) -> bool {
    !s.is_empty() && s.len() <= 253 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') && !s.starts_with('-')
}

/// Decode the secret's `data` (base64 values) into credentials.
pub fn parse_secret(json: &Value) -> Result<DbSecret, String> {
    let data: HashMap<String, String> = json
        .get("data")
        .and_then(|d| serde_json::from_value(d.clone()).ok())
        .ok_or("The secret has no data.")?;
    let get = |key: &str| -> Result<String, String> {
        let raw = data.get(key).ok_or_else(|| format!("The secret has no `{key}` key."))?;
        let bytes = base64::engine::general_purpose::STANDARD.decode(raw).map_err(|_| format!("`{key}` is not valid base64."))?;
        String::from_utf8(bytes).map(|s| s.trim_end_matches(['\n', '\r']).to_string()).map_err(|_| format!("`{key}` is not text."))
    };
    let host = get("host")?;
    if !is_hostname(&host) {
        return Err("The database host in the secret is not a valid host name.".into());
    }
    let port = get("port")?.trim().parse::<u16>().map_err(|_| "The database port in the secret is not a number.".to_string())?;
    Ok(DbSecret { host, port, user: get("user")?, password: get("password")?, database: get("dbname")? })
}

pub fn read_secret(context: &str, namespace: &str, secret: &str) -> Result<DbSecret, String> {
    let json = kubectl::run_json(context, Some(namespace), &["get", "secret", check_name(secret)?])?;
    parse_secret(&json)
}

/// The relay pod: forwards its port to the database host, like the script.
pub fn relay_manifest(pod: &str, secret: &DbSecret) -> Value {
    let command = format!(
        "socat tcp-listen:{port},fork,reuseaddr tcp:{host}:{port} & sleep {RELAY_LIFETIME_SECS}",
        port = secret.port,
        host = secret.host
    );
    json!({
        "apiVersion": "v1",
        "kind": "Pod",
        "metadata": {
            "name": pod,
            "labels": { "app": RELAY_LABEL },
            "annotations": { TARGET_ANNOTATION: target_of(secret) }
        },
        "spec": {
            "restartPolicy": "Never",
            "containers": [{
                "name": pod,
                "image": RELAY_IMAGE,
                "command": ["sh", "-c", command],
                "resources": {
                    "requests": { "memory": "50Mi", "cpu": "100m" },
                    "limits": { "memory": "128Mi", "cpu": "500m" }
                }
            }]
        }
    })
}

pub fn target_of(secret: &DbSecret) -> String {
    format!("{}:{}", secret.host, secret.port)
}

/// What matters about an existing relay pod.
#[derive(Debug, PartialEq)]
pub struct RelayState {
    pub phase: String,
    /// Being deleted: still "Running" for its grace period, but going away.
    pub terminating: bool,
    pub target: String,
    pub started_at: Option<String>,
}

fn parse_state(raw: &str) -> RelayState {
    let mut parts = raw.split('|').map(str::trim);
    let mut next = || parts.next().unwrap_or("").to_string();
    let phase = next();
    let terminating = !next().is_empty();
    let target = next();
    let started = next();
    RelayState { phase, terminating, target, started_at: (!started.is_empty()).then_some(started) }
}

/// The relay pod's state, or None when it doesn't exist.
pub fn relay_state(context: &str, namespace: &str, pod: &str) -> Result<Option<RelayState>, String> {
    let template = "jsonpath={.status.phase}|{.metadata.deletionTimestamp}|{.metadata.annotations.taskboard/target}|{.status.startTime}";
    match kubectl::run(context, Some(namespace), &["get", "pod", check_name(pod)?, "-o", template], QUICK) {
        Ok(raw) => Ok(Some(parse_state(&raw))),
        Err(e) if e.contains("NotFound") || e.contains("not found") => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn pod_phase(context: &str, namespace: &str, pod: &str) -> Result<Option<String>, String> {
    Ok(relay_state(context, namespace, pod)?.filter(|s| !s.terminating).map(|s| s.phase))
}

pub fn delete_pod(context: &str, namespace: &str, pod: &str, wait: bool) -> Result<(), String> {
    let wait_flag = if wait { "--wait=true" } else { "--wait=false" };
    kubectl::run(context, Some(namespace), &["delete", "pod", check_name(pod)?, "--ignore-not-found", wait_flag], SLOW).map(|_| ())
}

/// Reuse a running relay that points at this database; otherwise replace it.
/// Returns (created, pod start time).
pub fn ensure_relay(context: &str, namespace: &str, pod: &str, secret: &DbSecret) -> Result<(bool, Option<String>), String> {
    match relay_state(context, namespace, pod)? {
        Some(state) if state.phase == "Running" && !state.terminating && state.target == target_of(secret) => {
            return Ok((false, state.started_at));
        }
        // Stopped, shutting down, or forwarding somewhere else: start over.
        Some(_) => delete_pod(context, namespace, pod, true)?,
        None => {}
    }
    let manifest = relay_manifest(pod, secret).to_string();
    let mut cmd = kubectl::kubectl(context, Some(namespace), &["apply", "-f", "-"])?;
    proc::run_with_input(&mut cmd, Some(&manifest), SLOW).map_err(kubectl::friendly)?;
    Ok((true, None))
}

/// Delete without waiting, giving up after a few seconds (used on quit).
pub fn delete_pod_quick(context: &str, namespace: &str, pod: &str) {
    if let (Ok(pod), Ok(mut cmd)) = (check_name(pod), kubectl::kubectl(context, Some(namespace), &["delete", "pod"])) {
        cmd.args([pod, "--ignore-not-found", "--wait=false", "--request-timeout=5s"]);
        let _ = proc::run(cmd, std::time::Duration::from_secs(6));
    }
}

pub fn wait_running(context: &str, namespace: &str, pod: &str) -> Result<(), String> {
    let deadline = Instant::now() + POD_READY_TIMEOUT;
    loop {
        match pod_phase(context, namespace, pod)?.as_deref() {
            Some("Running") => return Ok(()),
            Some("Failed") | Some("Succeeded") => return Err("The relay pod stopped right after starting. Check its events in the Kubernetes view.".into()),
            _ if Instant::now() > deadline => return Err("The relay pod did not start within two minutes (image pull or quota?).".into()),
            _ => std::thread::sleep(Duration::from_secs(1)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn b64(s: &str) -> String {
        base64::engine::general_purpose::STANDARD.encode(s)
    }

    fn secret_json(host: &str, port: &str) -> Value {
        json!({ "data": { "host": b64(host), "port": b64(port), "user": b64("app"), "password": b64("s3cret\n"), "dbname": b64("shop") } })
    }

    #[test]
    fn parses_and_validates_the_secret() {
        let s = parse_secret(&secret_json("db.internal.example.com", "3306")).unwrap();
        assert_eq!((s.host.as_str(), s.port, s.database.as_str()), ("db.internal.example.com", 3306, "shop"));
        assert_eq!(s.password, "s3cret");
        assert!(!format!("{s:?}").contains("s3cret"));
        assert!(parse_secret(&secret_json("db; rm -rf /", "3306")).is_err());
        assert!(parse_secret(&secret_json("db", "33x")).is_err());
        assert!(parse_secret(&json!({ "data": {} })).is_err());
    }

    #[test]
    fn manifest_matches_the_script() {
        let s = parse_secret(&secret_json("db.example.com", "3306")).unwrap();
        let m = relay_manifest("socat-me", &s);
        let cmd = m.pointer("/spec/containers/0/command/2").unwrap().as_str().unwrap();
        assert_eq!(cmd, "socat tcp-listen:3306,fork,reuseaddr tcp:db.example.com:3306 & sleep 3600");
        assert_eq!(m.pointer("/metadata/labels/app").unwrap(), RELAY_LABEL);
        assert_eq!(m.pointer("/spec/containers/0/resources/limits/memory").unwrap(), "128Mi");
        assert_eq!(m.pointer("/metadata/annotations/taskboard~1target").unwrap(), "db.example.com:3306");
    }

    #[test]
    fn reads_relay_state() {
        let s = parse_state("Running|2026-10-12T10:00:00Z|db:3306|2026-10-12T09:00:00Z");
        assert!(s.terminating);
        assert_eq!(s.target, "db:3306");
        let fresh = parse_state("Pending|||");
        assert_eq!(fresh, RelayState { phase: "Pending".into(), terminating: false, target: String::new(), started_at: None });
    }
}
