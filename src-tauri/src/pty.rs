//! PTY backend for the embedded terminal: spawns the user's shell in a
//! project directory and streams output to the frontend via events.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

/// Sessions by id. Each session has its own lock, so one terminal that
/// can't take input (a stopped program) never blocks the others.
type Sessions = Arc<Mutex<HashMap<u32, Arc<Mutex<PtySession>>>>>;

#[derive(Default)]
pub struct PtyState {
    sessions: Sessions,
    next_id: AtomicU32,
}

struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    pid: Option<u32>,
}

/// A lock that survives a panic elsewhere (the data stays usable).
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Time a shell gets to exit after its hang-up before it is force-killed.
const KILL_GRACE: Duration = Duration::from_millis(800);

/// The shell leads its own session (the terminal's), so the session id is
/// its pid: signalling the session reaches programs it started too
/// (`npm run dev`, background jobs), not just the shell.
fn signal_session(sid: u32, signal: &str) -> bool {
    std::process::Command::new("/usr/bin/pkill")
        .args([signal, "-s", &sid.to_string()])
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Hang up a terminal session; anything in it still running after the grace
/// period (a shell or program that ignores SIGHUP) is killed.
fn end(session: &Arc<Mutex<PtySession>>, wait: bool) {
    let pid = {
        let mut s = lock(session);
        let _ = s.killer.kill();
        s.pid
    };
    let Some(pid) = pid else { return };
    signal_session(pid, "-HUP");
    let check = move || {
        std::thread::sleep(KILL_GRACE);
        // pkill succeeds only if something in the session was still running.
        signal_session(pid, "-KILL");
    };
    if wait {
        check();
    } else {
        std::thread::spawn(check);
    }
}

#[derive(Clone, Serialize)]
struct PtyOutput {
    id: u32,
    data: Vec<u8>,
}

#[derive(Clone, Serialize)]
struct PtyExit {
    id: u32,
}

/// The user's login shell in `cwd`, with the environment their Terminal app
/// would have (a GUI app starts without the shell's PATH, so kubectl, aws,
/// nvm… would otherwise be missing).
fn shell_command(cwd: &str, env: &HashMap<String, String>) -> CommandBuilder {
    let shell = env
        .get("SHELL")
        .cloned()
        .or_else(|| std::env::var("SHELL").ok())
        .unwrap_or_else(|| "/bin/zsh".to_string());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l");
    if !env.is_empty() {
        cmd.env_clear();
        for (key, value) in env {
            cmd.env(key, value);
        }
    }
    cmd.cwd(cwd);
    cmd.env("PWD", cwd);
    cmd
}

/// The folder a terminal starts in: an existing absolute directory.
fn checked_dir(cwd: &str) -> Result<String, String> {
    let path = std::path::Path::new(cwd);
    if !path.is_absolute() {
        return Err(format!("{cwd} is not an absolute folder path."));
    }
    let real = path.canonicalize().map_err(|_| format!("The folder {cwd} doesn't exist (moved or deleted?)."))?;
    if !real.is_dir() {
        return Err(format!("{cwd} is not a folder."));
    }
    Ok(real.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyState>,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<u32, String> {
    // Captured once per launch, off the main thread.
    crate::util::ensure_env().await?;
    let cmd = shell_command(&checked_dir(&cwd)?, crate::env::shell_env());
    start(app, &state, cmd, cols, rows)
}

/// Run `program args…` in a terminal session with the user's login-shell
/// environment; the session ends when the program exits (e.g. `kubectl exec`).
pub fn spawn_command(
    app: AppHandle,
    state: &PtyState,
    program: &str,
    args: &[String],
    cols: u16,
    rows: u16,
) -> Result<u32, String> {
    let path = crate::env::resolve(program).ok_or_else(|| format!("{program} was not found on your PATH"))?;
    let mut cmd = CommandBuilder::new(path);
    cmd.args(args);
    cmd.env_clear();
    for (key, value) in crate::env::shell_env() {
        cmd.env(key, value);
    }
    start(app, state, cmd, cols, rows)
}

fn start(app: AppHandle, state: &PtyState, mut cmd: CommandBuilder, cols: u16, rows: u16) -> Result<u32, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let pid = child.process_id();
    let mut killer = child.clone_killer();
    let streams = pair.master.try_clone_reader().and_then(|r| pair.master.take_writer().map(|w| (r, w)));
    let (mut reader, writer) = match streams {
        Ok(pair) => pair,
        Err(e) => {
            // Don't leave the process running without a terminal attached.
            let _ = killer.kill();
            return Err(e.to_string());
        }
    };

    let id = state.next_id.fetch_add(1, Ordering::SeqCst) + 1;
    lock(&state.sessions).insert(
        id,
        Arc::new(Mutex::new(PtySession {
            writer,
            master: pair.master,
            killer,
            pid,
        })),
    );

    let sessions = Arc::clone(&state.sessions);
    std::thread::spawn(move || {
        let mut child = child;
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let _ = app.emit(
                        "pty-output",
                        PtyOutput {
                            id,
                            data: buf[..n].to_vec(),
                        },
                    );
                }
            }
        }
        let _ = child.wait();
        lock(&sessions).remove(&id);
        let _ = app.emit("pty-exit", PtyExit { id });
    });

    Ok(id)
}

impl PtyState {
    fn get(&self, id: u32) -> Result<Arc<Mutex<PtySession>>, String> {
        lock(&self.sessions).get(&id).cloned().ok_or_else(|| format!("no terminal session #{id}"))
    }

    /// End every session (app quit), force-killing any that ignore the hang-up.
    pub fn kill_all(&self) {
        let sessions: Vec<_> = lock(&self.sessions).drain().map(|(_, s)| s).collect();
        let checks: Vec<_> = sessions.iter().map(|s| {
            let s = Arc::clone(s);
            std::thread::spawn(move || end(&s, true))
        }).collect();
        for c in checks {
            let _ = c.join();
        }
    }
}

/// Async: a full terminal buffer blocks the write, and must not block the UI.
#[tauri::command]
pub async fn pty_write(state: State<'_, PtyState>, id: u32, data: String) -> Result<(), String> {
    let session = state.get(id)?;
    let mut s = lock(&session);
    s.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    s.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(state: State<'_, PtyState>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let session = state.get(id)?;
    let s = lock(&session);
    s.master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_kill(state: State<'_, PtyState>, id: u32) -> Result<(), String> {
    if let Some(session) = lock(&state.sessions).remove(&id) {
        end(&session, false);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shells_get_the_login_environment_and_folder() {
        let env: HashMap<String, String> =
            [("PATH", "/opt/homebrew/bin:/usr/bin"), ("SHELL", "/bin/zsh")].into_iter().map(|(k, v)| (k.into(), v.into())).collect();
        let dir = std::env::temp_dir();
        let cmd = shell_command(dir.to_str().unwrap(), &env);
        assert_eq!(cmd.get_argv()[0], "/bin/zsh");
        assert_eq!(cmd.get_env("PATH").and_then(|v| v.to_str()), Some("/opt/homebrew/bin:/usr/bin"));
        assert_eq!(cmd.get_cwd().map(|p| p.into()), Some(dir.as_os_str().to_owned()));
    }

    #[test]
    fn only_existing_absolute_folders_are_used() {
        assert!(checked_dir("/definitely/not/here").is_err());
        assert!(checked_dir("relative/dir").is_err());
        let tmp = std::env::temp_dir();
        assert!(checked_dir(tmp.to_str().unwrap()).is_ok());
    }
}
