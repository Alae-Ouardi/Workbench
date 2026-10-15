//! Changes to the cluster. Each is confirmed in the UI first; here they are
//! validated and run with an explicit context and namespace.

use super::kubectl::{self, check_kind, check_name, cluster_scoped, SLOW};
use crate::proc;
use crate::util::blocking;

const SCALABLE: &[&str] = &["deployments", "statefulsets", "replicasets"];
const RESTARTABLE: &[&str] = &["deployments", "statefulsets", "daemonsets"];

#[tauri::command]
pub async fn k8s_delete(context: String, namespace: String, kind: String, name: String) -> Result<String, String> {
    blocking(move || {
        let kind = check_kind(&kind)?;
        let name = check_name(&name)?;
        let ns = (!cluster_scoped(kind)).then_some(namespace.as_str());
        kubectl::run(&context, ns, &["delete", kind, name, "--wait=false"], SLOW)
    })
    .await
}

#[tauri::command]
pub async fn k8s_scale(context: String, namespace: String, kind: String, name: String, replicas: u32) -> Result<String, String> {
    blocking(move || {
        let kind = check_kind(&kind)?;
        if !SCALABLE.contains(&kind) {
            return Err(format!("{kind} cannot be scaled"));
        }
        let name = check_name(&name)?;
        let replicas = format!("--replicas={}", replicas.min(500));
        kubectl::run(&context, Some(&namespace), &["scale", kind, name, &replicas], SLOW)
    })
    .await
}

#[tauri::command]
pub async fn k8s_rollout_restart(context: String, namespace: String, kind: String, name: String) -> Result<String, String> {
    blocking(move || {
        let kind = check_kind(&kind)?;
        if !RESTARTABLE.contains(&kind) {
            return Err(format!("{kind} cannot be restarted"));
        }
        let name = check_name(&name)?;
        let target = format!("{kind}/{name}");
        kubectl::run(&context, Some(&namespace), &["rollout", "restart", &target], SLOW)
    })
    .await
}

/// Replace an object with edited YAML. `replace` (not `apply`) so a version
/// conflict fails instead of silently overwriting someone else's change.
/// With `dry_run` the server validates the change without saving it.
#[tauri::command]
pub async fn k8s_replace_yaml(context: String, namespace: String, yaml: String, dry_run: bool) -> Result<String, String> {
    blocking(move || {
        let mut args = vec!["replace", "-f", "-", "-o", "name"];
        if dry_run {
            args.push("--dry-run=server");
        }
        let mut cmd = kubectl::kubectl(&context, Some(&namespace), &args)?;
        proc::run_with_input(&mut cmd, Some(&yaml), SLOW).map_err(kubectl::friendly)
    })
    .await
}
