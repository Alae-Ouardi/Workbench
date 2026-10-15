//! Kubernetes workspace backend, built on the kubectl CLI so the user's own
//! kubeconfig and login plugins work unchanged.

pub mod actions;
pub mod contexts;
pub mod forward;
pub mod kubectl;
pub mod logs;
pub mod resources;
pub mod watch;

use tauri::{AppHandle, State};

use crate::pty::{self, PtyState};
use kubectl::check_name;

/// An interactive shell in a container, in the embedded terminal. Prefers
/// bash, falls back to sh.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn k8s_exec(
    app: AppHandle,
    state: State<'_, PtyState>,
    context: String,
    namespace: String,
    pod: String,
    container: String,
    cols: u16,
    rows: u16,
) -> Result<u32, String> {
    crate::util::ensure_env().await?;
    kubectl::check_context(&context)?;
    let args: Vec<String> = [
        "--context",
        &context,
        "--namespace",
        check_name(&namespace)?,
        "exec",
        "-it",
        check_name(&pod)?,
        "-c",
        check_name(&container)?,
        "--",
        "sh",
        "-c",
        "if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    pty::spawn_command(app, &state, "kubectl", &args, cols, rows)
}
