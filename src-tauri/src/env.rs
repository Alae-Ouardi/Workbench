//! The user's login-shell environment, for the command-line tools the app
//! launches (kubectl and its auth plugins). An app opened from the Dock gets a
//! bare launchd environment with no Homebrew or `/usr/local/bin` on PATH, so
//! the shell's environment is captured once and handed to every child.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

const MARKER: &str = "__TASKBOARD_ENV__";
const CAPTURE_TIMEOUT: Duration = Duration::from_secs(8);
const FALLBACK_PATHS: &[&str] = &["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];

static ENV: OnceLock<HashMap<String, String>> = OnceLock::new();

/// The captured environment (computed on first use).
pub fn shell_env() -> &'static HashMap<String, String> {
    ENV.get_or_init(|| capture().unwrap_or_else(fallback))
}

/// Warm the cache in the background so the first kubectl call is not slowed.
pub fn warm_up() {
    std::thread::spawn(|| {
        shell_env();
    });
}

/// A `Command` for `program` resolved on the captured PATH, with that
/// environment applied. Arguments are never passed through a shell.
pub fn command(program: &str) -> Command {
    let env = shell_env();
    let mut cmd = Command::new(resolve(program).unwrap_or_else(|| PathBuf::from(program)));
    cmd.env_clear().envs(env);
    cmd
}

/// Full path of `program` on the captured PATH.
pub fn resolve(program: &str) -> Option<PathBuf> {
    let path = shell_env().get("PATH")?;
    find_on_path(program, path)
}

fn find_on_path(program: &str, path: &str) -> Option<PathBuf> {
    path.split(':')
        .filter(|dir| !dir.is_empty())
        .map(|dir| Path::new(dir).join(program))
        .find(|candidate| candidate.is_file())
}

fn capture() -> Option<HashMap<String, String>> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    // -i so zsh reads .zshrc (where PATH is usually set); the marker skips any
    // banner the rc files print.
    let script = format!("printf '%s' '{MARKER}'; env -0");
    let mut child = Command::new(&shell)
        .args(["-ilc", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut out = Vec::new();
        let _ = stdout.read_to_end(&mut out);
        out
    });
    let deadline = Instant::now() + CAPTURE_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(25)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let out = reader.join().ok()?;
    let parsed = parse_env(&String::from_utf8_lossy(&out));
    parsed.contains_key("PATH").then_some(parsed)
}

/// Parse `env -0` output that follows the marker.
fn parse_env(raw: &str) -> HashMap<String, String> {
    let Some(start) = raw.find(MARKER) else {
        return HashMap::new();
    };
    raw[start + MARKER.len()..]
        .split('\0')
        .filter_map(|entry| entry.split_once('='))
        .filter(|(key, _)| !key.is_empty() && !key.contains('\n'))
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect()
}

fn fallback() -> HashMap<String, String> {
    let mut env: HashMap<String, String> = std::env::vars().collect();
    let current = env.get("PATH").cloned().unwrap_or_default();
    let mut parts: Vec<&str> = FALLBACK_PATHS.to_vec();
    parts.extend(current.split(':').filter(|p| !p.is_empty() && !FALLBACK_PATHS.contains(p)));
    env.insert("PATH".into(), parts.join(":"));
    env
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_env_after_banner() {
        let raw = format!("Welcome!\n{MARKER}PATH=/a:/b\0HOME=/h\0MULTI=x=y\0\0");
        let env = parse_env(&raw);
        assert_eq!(env.get("PATH").map(String::as_str), Some("/a:/b"));
        assert_eq!(env.get("HOME").map(String::as_str), Some("/h"));
        assert_eq!(env.get("MULTI").map(String::as_str), Some("x=y"));
    }

    #[test]
    fn missing_marker_yields_nothing() {
        assert!(parse_env("PATH=/a\0").is_empty());
    }

    #[test]
    fn fallback_puts_common_tool_dirs_first() {
        let env = fallback();
        assert!(env["PATH"].starts_with("/opt/homebrew/bin:/usr/local/bin"));
    }

    #[test]
    fn finds_programs_on_path() {
        assert_eq!(find_on_path("sh", "/nope:/bin"), Some(PathBuf::from("/bin/sh")));
        assert_eq!(find_on_path("definitely-not-a-tool", "/bin"), None);
    }
}
