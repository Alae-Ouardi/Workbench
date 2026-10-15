//! Building and running kubectl. Every call names its context (and namespace)
//! explicitly — the user's current-context is never read or changed — and
//! every user-supplied value is validated so it can't be taken for a flag.

use std::process::Command;
use std::time::Duration;

use serde_json::Value;

use crate::proc;

pub const QUICK: Duration = Duration::from_secs(30);
pub const SLOW: Duration = Duration::from_secs(90);

/// Resource kinds the app works with (anything else is refused).
pub const KINDS: &[&str] = &[
    "pods",
    "deployments",
    "statefulsets",
    "daemonsets",
    "replicasets",
    "jobs",
    "cronjobs",
    "services",
    "ingresses",
    "configmaps",
    "secrets",
    "persistentvolumeclaims",
    "nodes",
    "events",
    "namespaces",
];

/// Kinds that are not namespaced.
pub fn cluster_scoped(kind: &str) -> bool {
    matches!(kind, "nodes" | "namespaces")
}

pub fn check_kind(kind: &str) -> Result<&str, String> {
    KINDS.iter().find(|k| **k == kind).copied().ok_or_else(|| format!("unsupported resource kind: {kind}"))
}

/// Kubernetes object names (DNS-1123 style, plus `:` used by some events).
pub fn check_name(name: &str) -> Result<&str, String> {
    let ok = !name.is_empty()
        && name.len() <= 253
        && !name.starts_with(['-', '.'])
        && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '.' | ':'));
    if ok {
        Ok(name)
    } else {
        Err(format!("not a valid Kubernetes name: {name}"))
    }
}

/// Context names come from the kubeconfig and may hold `@`, `/`, `:` (EKS
/// ARNs); they only must not look like a flag or carry control characters.
pub fn check_context(context: &str) -> Result<&str, String> {
    let ok = !context.is_empty() && !context.starts_with('-') && !context.chars().any(char::is_control);
    if ok {
        Ok(context)
    } else {
        Err(format!("not a valid context name: {context}"))
    }
}

/// `kubectl --context C [-n NS] args…` with the user's shell environment.
pub fn kubectl(context: &str, namespace: Option<&str>, args: &[&str]) -> Result<Command, String> {
    let mut cmd = crate::env::command("kubectl");
    cmd.arg("--context").arg(check_context(context)?);
    if let Some(ns) = namespace {
        cmd.arg("--namespace").arg(check_name(ns)?);
    }
    cmd.args(args);
    Ok(cmd)
}

pub fn run(context: &str, namespace: Option<&str>, args: &[&str], timeout: Duration) -> Result<String, String> {
    proc::run(kubectl(context, namespace, args)?, timeout).map_err(friendly)
}

pub fn run_json(context: &str, namespace: Option<&str>, args: &[&str]) -> Result<Value, String> {
    let mut full = args.to_vec();
    full.extend(["-o", "json"]);
    let out = run(context, namespace, &full, SLOW)?;
    serde_json::from_str(&out).map_err(|e| format!("kubectl returned unreadable JSON: {e}"))
}

/// Shorter, clearer messages for the errors people actually hit.
pub fn friendly(err: String) -> String {
    let lower = err.to_lowercase();
    if lower.contains("could not start") && lower.contains("kubectl") {
        "kubectl was not found. Install it or make sure it is on your shell PATH.".into()
    } else if lower.contains("forbidden") {
        format!("Your account is not allowed to do this here.\n{err}")
    } else if lower.contains("unable to connect") || lower.contains("i/o timeout") || lower.contains("no such host") {
        format!("The cluster could not be reached (VPN?).\n{err}")
    } else if lower.contains("unauthorized") || lower.contains("token") && lower.contains("expired") {
        format!("Your cluster login has expired. Log in again in a terminal, then retry.\n{err}")
    } else {
        err
    }
}

/// Drop the bulky, never-shown parts of an object (managed fields, the
/// last-applied annotation) and blank secret values so they only cross to
/// the UI when explicitly revealed.
pub fn slim(mut object: Value) -> Value {
    if let Some(meta) = object.get_mut("metadata").and_then(Value::as_object_mut) {
        meta.remove("managedFields");
        if let Some(ann) = meta.get_mut("annotations").and_then(Value::as_object_mut) {
            ann.remove("kubectl.kubernetes.io/last-applied-configuration");
        }
    }
    if object.get("kind").and_then(Value::as_str) == Some("Secret") {
        for field in ["data", "stringData"] {
            if let Some(data) = object.get_mut(field).and_then(Value::as_object_mut) {
                for value in data.values_mut() {
                    *value = Value::String(String::new());
                }
            }
        }
    }
    object
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn validates_names_kinds_and_contexts() {
        assert!(check_name("api-7f9c.x").is_ok());
        assert!(check_name("--all").is_err());
        assert!(check_name("Bad_Name").is_err());
        assert!(check_kind("pods").is_ok());
        assert!(check_kind("clusterroles").is_err());
        assert!(check_context("arn:aws:eks:eu-central-1:1:cluster/x").is_ok());
        assert!(check_context("--kubeconfig=/tmp/x").is_err());
    }

    #[test]
    fn slim_strips_noise_and_secret_values() {
        let secret = json!({
            "kind": "Secret",
            "metadata": {"name": "s", "managedFields": [1], "annotations": {"kubectl.kubernetes.io/last-applied-configuration": "{}", "keep": "1"}},
            "data": {"password": "c2VjcmV0"}
        });
        let out = slim(secret);
        assert!(out["metadata"].get("managedFields").is_none());
        assert_eq!(out["metadata"]["annotations"]["keep"], "1");
        assert!(out["metadata"]["annotations"].get("kubectl.kubernetes.io/last-applied-configuration").is_none());
        assert_eq!(out["data"]["password"], "");
    }

    #[test]
    fn friendly_explains_common_failures() {
        assert!(friendly("Error from server (Forbidden): pods is forbidden".into()).starts_with("Your account"));
        assert!(friendly("Unable to connect to the server: dial tcp: i/o timeout".into()).contains("VPN"));
    }
}
