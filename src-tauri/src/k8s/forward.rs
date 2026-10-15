//! Port-forwards: `kubectl port-forward` children tracked in one registry, so
//! the UI lists them, local ports never clash, and the database tunnel uses
//! the same machinery.

use std::collections::HashMap;
use std::net::TcpListener;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use super::kubectl::{self, check_name};
use crate::proc::{clean_error, Procs};
use crate::util::blocking;

const READY_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Serialize)]
pub struct ForwardInfo {
    pub id: u32,
    pub context: String,
    pub namespace: String,
    /// `pod/name` or `service/name`.
    pub target: String,
    pub local_port: u16,
    pub remote_port: u16,
    /// Who opened it: "k8s" or "db".
    pub owner: String,
    pub started_at: String,
}

#[derive(Default)]
pub struct ForwardRegistry {
    forwards: Mutex<HashMap<u32, ForwardInfo>>,
}

pub type Forwards = Arc<ForwardRegistry>;

impl ForwardRegistry {
    pub fn list(&self) -> Vec<ForwardInfo> {
        let mut all: Vec<ForwardInfo> = self.forwards.lock().unwrap().values().cloned().collect();
        all.sort_by_key(|f| f.id);
        all
    }

    fn port_taken(&self, port: u16) -> bool {
        self.forwards.lock().unwrap().values().any(|f| f.local_port == port)
    }
}

#[derive(Clone, Serialize)]
struct ForwardEnd {
    id: u32,
    error: Option<String>,
}

/// True when nothing listens on `port` on localhost.
pub fn port_free(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// The "ready" line kubectl prints once the local listener is up.
pub fn is_ready_line(line: &str) -> bool {
    line.starts_with("Forwarding from 127.0.0.1:") || line.starts_with("Forwarding from [::1]:")
}

pub fn check_target(target: &str) -> Result<&str, String> {
    let (kind, name) = target.split_once('/').ok_or("target must look like pod/name or service/name")?;
    if !matches!(kind, "pod" | "service" | "svc" | "deployment") {
        return Err(format!("cannot port-forward to {kind}"));
    }
    check_name(name)?;
    Ok(target)
}

/// Start a forward and wait until it is ready (or failed).
#[allow(clippy::too_many_arguments)]
pub fn start(
    app: &AppHandle,
    procs: &Procs,
    registry: &Forwards,
    context: &str,
    namespace: &str,
    target: &str,
    local_port: u16,
    remote_port: u16,
    owner: &str,
) -> Result<ForwardInfo, String> {
    let target = check_target(target)?;
    if registry.port_taken(local_port) || !port_free(local_port) {
        let suggestion = (local_port.saturating_add(1)..local_port.saturating_add(50))
            .find(|p| !registry.port_taken(*p) && port_free(*p))
            .map(|p| format!(" Port {p} is free."))
            .unwrap_or_default();
        return Err(format!(
            "Local port {local_port} is already in use — probably another tunnel, such as the connector script.{suggestion}"
        ));
    }
    let ports = format!("{local_port}:{remote_port}");
    let cmd = kubectl::kubectl(context, Some(namespace), &["port-forward", target, &ports, "--address", "127.0.0.1"])?;

    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    let exit_tx = tx.clone();
    let end_app = app.clone();
    let end_registry = Arc::clone(registry);
    let id = procs.spawn(
        cmd,
        move |_, stdout| {
            let mut announced = false;
            crate::proc::for_each_line(stdout, |line| {
                if !announced && is_ready_line(&line) {
                    announced = true;
                    let _ = tx.send(Ok(()));
                }
            });
        },
        move |exit| {
            let error = (!exit.killed).then(|| {
                kubectl::friendly(clean_error(&exit.stderr).unwrap_or_else(|| "the port-forward stopped".into()))
            });
            let _ = exit_tx.send(Err(error.clone().unwrap_or_else(|| "stopped".into())));
            end_registry.forwards.lock().unwrap().remove(&exit.id);
            if !exit.killed {
                // A database tunnel that dies takes its session with it.
                crate::db::session::forward_died(&end_app, exit.id);
            }
            let _ = end_app.emit("k8s-forward-end", ForwardEnd { id: exit.id, error });
        },
    )?;

    match rx.recv_timeout(READY_TIMEOUT) {
        Ok(Ok(())) => {
            let info = ForwardInfo {
                id,
                context: context.to_string(),
                namespace: namespace.to_string(),
                target: target.to_string(),
                local_port,
                remote_port,
                owner: owner.to_string(),
                started_at: chrono::Utc::now().to_rfc3339(),
            };
            registry.forwards.lock().unwrap().insert(id, info.clone());
            // It may have died between "ready" and being registered.
            if !procs.is_running(id) {
                registry.forwards.lock().unwrap().remove(&id);
                return Err("The port-forward stopped right after starting.".into());
            }
            Ok(info)
        }
        Ok(Err(e)) => Err(e),
        Err(_) => {
            procs.kill(id);
            Err("The port-forward did not become ready in time.".into())
        }
    }
}

pub fn stop(procs: &Procs, registry: &Forwards, id: u32) {
    registry.forwards.lock().unwrap().remove(&id);
    procs.kill(id);
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn k8s_forward_start(
    app: AppHandle,
    procs: State<'_, Procs>,
    registry: State<'_, Forwards>,
    context: String,
    namespace: String,
    target: String,
    local_port: u16,
    remote_port: u16,
) -> Result<ForwardInfo, String> {
    let (procs, registry) = (Arc::clone(&procs), Arc::clone(&registry));
    blocking(move || start(&app, &procs, &registry, &context, &namespace, &target, local_port, remote_port, "k8s")).await
}

#[tauri::command]
pub async fn k8s_forward_stop(procs: State<'_, Procs>, registry: State<'_, Forwards>, id: u32) -> Result<(), String> {
    let (procs, registry) = (Arc::clone(&procs), Arc::clone(&registry));
    blocking(move || {
        stop(&procs, &registry, id);
        Ok(())
    })
    .await
}

#[tauri::command]
pub fn k8s_forward_list(registry: State<'_, Forwards>) -> Vec<ForwardInfo> {
    registry.list()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_ready_lines_and_targets() {
        assert!(is_ready_line("Forwarding from 127.0.0.1:3307 -> 3306"));
        assert!(!is_ready_line("Handling connection for 3307"));
        assert!(check_target("pod/socat-me").is_ok());
        assert!(check_target("secret/x").is_err());
        assert!(check_target("pod/--evil").is_err());
    }

    #[test]
    fn detects_busy_ports() {
        let held = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = held.local_addr().unwrap().port();
        assert!(!port_free(port));
        drop(held);
        assert!(port_free(port));
    }
}
