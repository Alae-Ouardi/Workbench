//! Pod logs streamed line by line as `k8s-log` events (`{id, line}`);
//! `proc-exit` follows when the stream ends.

use serde::Deserialize;
use tauri::{AppHandle, State};

use super::kubectl::{self, check_name};
use crate::proc::Procs;

#[derive(Debug, Deserialize)]
pub struct LogOptions {
    pub container: Option<String>,
    pub follow: bool,
    pub previous: bool,
    pub timestamps: bool,
    /// Lines of history to start with.
    pub tail: u32,
}

pub fn log_args(pod: &str, opts: &LogOptions) -> Result<Vec<String>, String> {
    let mut args = vec!["logs".to_string(), check_name(pod)?.to_string()];
    match &opts.container {
        Some(c) => args.extend(["-c".into(), check_name(c)?.to_string()]),
        None => args.push("--all-containers=true".into()),
    }
    args.push(format!("--tail={}", opts.tail.min(50_000)));
    if opts.follow {
        args.push("--follow".into());
    }
    if opts.previous {
        args.push("--previous".into());
    }
    if opts.timestamps {
        args.push("--timestamps".into());
    }
    if opts.container.is_none() {
        args.push("--prefix".into());
    }
    Ok(args)
}

#[tauri::command]
pub async fn k8s_logs_start(
    app: AppHandle,
    procs: State<'_, Procs>,
    context: String,
    namespace: String,
    pod: String,
    options: LogOptions,
) -> Result<u32, String> {
    crate::util::ensure_env().await?;
    let args = log_args(&pod, &options)?;
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let cmd = kubectl::kubectl(&context, Some(&namespace), &refs)?;
    procs.spawn_lines(app, cmd, "k8s-log")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_log_arguments() {
        let opts = LogOptions { container: Some("api".into()), follow: true, previous: false, timestamps: true, tail: 500 };
        assert_eq!(log_args("pod-1", &opts).unwrap(), ["logs", "pod-1", "-c", "api", "--tail=500", "--follow", "--timestamps"]);
        let all = LogOptions { container: None, follow: false, previous: true, timestamps: false, tail: 10 };
        assert!(log_args("pod-1", &all).unwrap().contains(&"--prefix".to_string()));
        assert!(log_args("--all", &all).is_err());
    }
}
