//! Long-running child processes (kubectl watch, logs, port-forward) and
//! one-shot command runs. Every child is tracked so it can be stopped on
//! request and when the app quits.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

/// How much of a child's stderr is kept for the error message.
const STDERR_TAIL: usize = 4096;

#[derive(Default)]
pub struct ProcManager {
    children: Mutex<HashMap<u32, Child>>,
    next_id: AtomicU32,
}

pub type Procs = Arc<ProcManager>;

/// How a tracked child ended.
#[derive(Debug, Clone, Serialize)]
pub struct ProcExit {
    pub id: u32,
    pub code: Option<i32>,
    /// Last part of stderr, for a readable error.
    pub stderr: String,
    /// True when the app stopped it (not a failure).
    pub killed: bool,
}

#[derive(Clone, Serialize)]
struct ProcLine {
    id: u32,
    line: String,
}

impl ProcManager {
    /// Spawn `cmd`, hand its stdout to `on_stdout` on a reader thread, and call
    /// `on_exit` once the child has ended (stopped or on its own).
    pub fn spawn<R, E>(self: &Arc<Self>, mut cmd: Command, on_stdout: R, on_exit: E) -> Result<u32, String>
    where
        R: FnOnce(u32, ChildStdout) + Send + 'static,
        E: FnOnce(ProcExit) + Send + 'static,
    {
        cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = cmd.spawn().map_err(|e| format!("could not start {:?}: {e}", cmd.get_program()))?;
        let stdout = child.stdout.take().ok_or("no stdout")?;
        let stderr = child.stderr.take().ok_or("no stderr")?;
        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        self.children.lock().unwrap().insert(id, child);

        let tail = Arc::new(Mutex::new(String::new()));
        let err_tail = Arc::clone(&tail);
        let err_thread = std::thread::spawn(move || collect_tail(stderr, &err_tail));

        let me = Arc::clone(self);
        std::thread::spawn(move || {
            on_stdout(id, stdout);
            let _ = err_thread.join();
            // Take the child out first: never hold the lock while waiting.
            let removed = me.children.lock().unwrap().remove(&id);
            let (code, killed) = match removed {
                Some(mut child) => (child.wait().ok().and_then(|s| s.code()), false),
                None => (None, true),
            };
            let stderr = tail.lock().unwrap().trim().to_string();
            on_exit(ProcExit { id, code, stderr, killed });
        });
        Ok(id)
    }

    /// Spawn `cmd` and emit each stdout line as `event` `{id, line}`, then
    /// `proc-exit` when it ends.
    pub fn spawn_lines(self: &Arc<Self>, app: AppHandle, cmd: Command, event: &'static str) -> Result<u32, String> {
        let line_app = app.clone();
        self.spawn(
            cmd,
            move |id, stdout| {
                for_each_line(stdout, |line| {
                    let _ = line_app.emit(event, ProcLine { id, line });
                });
            },
            move |exit| {
                let _ = app.emit("proc-exit", exit);
            },
        )
    }

    #[allow(dead_code)]
    pub fn is_running(&self, id: u32) -> bool {
        self.children.lock().unwrap().contains_key(&id)
    }

    pub fn kill(&self, id: u32) {
        let child = self.children.lock().unwrap().remove(&id);
        if let Some(mut child) = child {
            terminate(&mut child);
        }
    }

    pub fn kill_all(&self) {
        let children: Vec<Child> = self.children.lock().unwrap().drain().map(|(_, c)| c).collect();
        for mut child in children {
            terminate(&mut child);
        }
    }
}

/// Call `f` for each line of `stream`, decoding lossily so a non-UTF-8 line
/// (binary logs, latin1) never stops the stream.
pub fn for_each_line(stream: impl Read, mut f: impl FnMut(String)) {
    let mut reader = BufReader::new(stream);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                while matches!(buf.last(), Some(b'\n' | b'\r')) {
                    buf.pop();
                }
                f(String::from_utf8_lossy(&buf).into_owned());
            }
        }
    }
}

/// SIGTERM first so kubectl can close its streams, then SIGKILL.
fn terminate(child: &mut Child) {
    unsafe {
        libc_kill(child.id() as i32, 15);
    }
    let deadline = Instant::now() + Duration::from_millis(800);
    while Instant::now() < deadline {
        if let Ok(Some(_)) = child.try_wait() {
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let _ = child.kill();
    let _ = child.wait();
}

extern "C" {
    #[link_name = "kill"]
    fn libc_kill(pid: i32, sig: i32) -> i32;
}

fn collect_tail(mut stream: impl Read, tail: &Mutex<String>) {
    let mut buf = [0u8; 4096];
    loop {
        match stream.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let mut t = tail.lock().unwrap();
                t.push_str(&String::from_utf8_lossy(&buf[..n]));
                if t.len() > STDERR_TAIL {
                    let mut cut = t.len() - STDERR_TAIL;
                    while !t.is_char_boundary(cut) {
                        cut += 1;
                    }
                    t.drain(..cut);
                }
            }
        }
    }
}

/// Run `cmd` to completion and return stdout, or stderr as the error.
pub fn run(mut cmd: Command, timeout: Duration) -> Result<String, String> {
    run_with_input(&mut cmd, None, timeout)
}

/// Like [`run`], feeding `input` on stdin (e.g. a manifest for `kubectl apply -f -`).
pub fn run_with_input(cmd: &mut Command, input: Option<&str>, timeout: Duration) -> Result<String, String> {
    cmd.stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("could not start {:?}: {e}", cmd.get_program()))?;
    if let (Some(text), Some(mut stdin)) = (input, child.stdin.take()) {
        let text = text.to_string();
        std::thread::spawn(move || {
            use std::io::Write;
            let _ = stdin.write_all(text.as_bytes());
        });
    }
    let mut stdout = child.stdout.take().ok_or("no stdout")?;
    let mut stderr = child.stderr.take().ok_or("no stderr")?;
    let out_thread = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stdout.read_to_string(&mut s);
        s
    });
    let err_thread = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(15)),
            Ok(None) => {
                terminate(&mut child);
                return Err(format!("timed out after {}s", timeout.as_secs()));
            }
            Err(e) => return Err(e.to_string()),
        }
    };
    let out = out_thread.join().unwrap_or_default();
    let err = err_thread.join().unwrap_or_default();
    if status.success() {
        Ok(out)
    } else {
        Err(clean_error(&err).unwrap_or_else(|| format!("exited with {status}")))
    }
}

/// The meaningful part of a CLI error: drop blank lines, keep it short.
pub fn clean_error(stderr: &str) -> Option<String> {
    let lines: Vec<&str> = stderr.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    if lines.is_empty() {
        return None;
    }
    let text = lines[lines.len().saturating_sub(4)..].join("\n");
    Some(text.trim_start_matches("error: ").trim_start_matches("Error from server ").to_string())
}

#[tauri::command]
pub async fn proc_kill(procs: State<'_, Procs>, id: u32) -> Result<(), String> {
    let procs = procs.inner().clone();
    crate::util::blocking(move || {
        procs.kill(id);
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn run_returns_stdout_or_stderr() {
        let mut ok = Command::new("/bin/sh");
        ok.args(["-c", "echo hi"]);
        assert_eq!(run(ok, Duration::from_secs(5)).unwrap(), "hi\n");
        let mut bad = Command::new("/bin/sh");
        bad.args(["-c", "echo 'error: boom' >&2; exit 3"]);
        assert_eq!(run(bad, Duration::from_secs(5)).unwrap_err(), "boom");
    }

    #[test]
    fn run_feeds_stdin_and_times_out() {
        let mut cat = Command::new("/bin/cat");
        assert_eq!(run_with_input(&mut cat, Some("abc"), Duration::from_secs(5)).unwrap(), "abc");
        let mut slow = Command::new("/bin/sleep");
        slow.arg("5");
        assert!(run(slow, Duration::from_millis(200)).unwrap_err().contains("timed out"));
    }

    #[test]
    fn spawned_child_streams_and_can_be_killed() {
        let procs: Procs = Arc::default();
        let (tx, rx) = mpsc::channel();
        let mut cmd = Command::new("/bin/sh");
        cmd.args(["-c", "echo ready; sleep 30"]);
        let id = procs
            .spawn(
                cmd,
                |_, out| {
                    for _ in BufReader::new(out).lines() {}
                },
                move |exit| tx.send(exit).unwrap(),
            )
            .unwrap();
        assert!(procs.is_running(id));
        procs.kill(id);
        let exit = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(exit.killed);
        assert!(!procs.is_running(id));
    }

    #[test]
    fn lines_survive_invalid_utf8() {
        let mut lines = Vec::new();
        for_each_line(&b"ok\n\xff\xfe bad\r\nlast"[..], |l| lines.push(l));
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0], "ok");
        assert!(lines[1].ends_with(" bad"));
        assert_eq!(lines[2], "last");
    }

    #[test]
    fn clean_error_keeps_last_lines() {
        assert_eq!(clean_error("\nerror: nope\n").as_deref(), Some("nope"));
        assert_eq!(clean_error("  \n"), None);
    }
}
