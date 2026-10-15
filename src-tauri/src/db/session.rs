//! Live database sessions: connect (secret → relay pod → port-forward →
//! MySQL), disconnect (stop forward, delete relay pod), and expiry after the
//! relay's lifetime. The password stays in this module.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use mysql::prelude::Queryable;
use mysql::consts::CapabilityFlags;
use mysql::{Conn, Opts, OptsBuilder, Pool, PoolConstraints, PoolOpts, SslOpts};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use super::connections::{self, Connection, Kind, Target};
use super::tunnel::{self, DbSecret, RELAY_LIFETIME_SECS};
use crate::k8s::forward::{self, Forwards};
use crate::proc::Procs;
use crate::util::blocking;

pub struct Session {
    pub info: SessionInfo,
    pub pool: Pool,
    /// Options the pool was opened with, for one-off connections (cancel).
    opts: Opts,
    /// The port-forward and relay pod behind a cluster session; none for a
    /// local database.
    tunnel: Option<Tunnel>,
    password: String,
    /// Row-change batches previewed but not yet confirmed, oldest first.
    batches: Mutex<Vec<(String, Vec<super::changes::Statement>)>>,
}

const MAX_BATCHES: usize = 20;

impl Session {
    pub fn conn(&self) -> Result<mysql::PooledConn, String> {
        self.pool.get_conn().map_err(|e| format!("Lost the database connection ({e}). Reconnect and try again."))
    }

    /// A fresh connection outside the pool (the pool may be busy with the
    /// very query being cancelled).
    pub fn side_conn(&self) -> Result<Conn, String> {
        Conn::new(self.opts.clone()).map_err(|e| e.to_string())
    }

    pub fn store_batch(&self, statements: Vec<super::changes::Statement>) -> String {
        let id = format!("{:x}", rand_id());
        let mut batches = self.batches.lock().unwrap();
        // Only recent previews matter: drop the oldest beyond the cap.
        if batches.len() >= MAX_BATCHES {
            batches.remove(0);
        }
        batches.push((id.clone(), statements));
        id
    }

    pub fn take_batch(&self, id: &str) -> Option<Vec<super::changes::Statement>> {
        let mut batches = self.batches.lock().unwrap();
        let index = batches.iter().position(|(b, _)| b == id)?;
        Some(batches.remove(index).1)
    }
}

struct Tunnel {
    forward_id: u32,
    relay_pod: String,
}

fn rand_id() -> u128 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    nanos ^ (std::process::id() as u128) << 64
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionInfo {
    pub connection_id: String,
    pub context: String,
    pub namespace: String,
    /// Where the client connects: 127.0.0.1 for a tunnel, else the local host.
    pub host: String,
    pub local_port: u16,
    pub database: String,
    pub user: String,
    pub server_version: String,
    pub connected_at: String,
    /// When the relay pod stops; empty for a local database (no time limit).
    pub expires_at: String,
}

#[derive(Default)]
pub struct SessionRegistry {
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    /// Connections being opened right now, and those of them the user cancelled.
    connecting: Mutex<HashSet<String>>,
    cancelled: Mutex<HashSet<String>>,
}

/// Marks a connect in progress; ends it (and forgets a cancel) when dropped.
struct Attempt<'a> {
    sessions: &'a SessionRegistry,
    id: String,
}

impl<'a> Attempt<'a> {
    fn start(sessions: &'a SessionRegistry, id: &str) -> Result<Self, String> {
        if !sessions.connecting.lock().unwrap().insert(id.to_string()) {
            return Err("This connection is already being opened.".into());
        }
        Ok(Self { sessions, id: id.to_string() })
    }
}

impl Drop for Attempt<'_> {
    fn drop(&mut self) {
        self.sessions.connecting.lock().unwrap().remove(&self.id);
        self.sessions.cancelled.lock().unwrap().remove(&self.id);
    }
}

pub type Sessions = Arc<SessionRegistry>;

impl SessionRegistry {
    pub fn get(&self, id: &str) -> Result<Arc<Session>, String> {
        self.sessions.lock().unwrap().get(id).cloned().ok_or_else(|| "Not connected. Connect first.".to_string())
    }

    fn is_cancelled(&self, id: &str) -> bool {
        self.cancelled.lock().unwrap().contains(id)
    }
}

/// Returned by a connect the user cancelled; the UI treats it as "no error".
pub const CANCELLED: &str = "cancelled";

#[derive(Clone, Serialize)]
struct Step {
    connection_id: String,
    step: &'static str,
    state: &'static str,
    detail: String,
}

#[derive(Clone, Serialize)]
struct SessionEnd {
    connection_id: String,
    reason: &'static str,
}

fn step(app: &AppHandle, id: &str, step: &'static str, state: &'static str, detail: impl Into<String>) {
    let _ = app.emit("db-connect-step", Step { connection_id: id.to_string(), step, state, detail: detail.into() });
}

/// Run one step, reporting start, success or failure.
fn run_step<T>(app: &AppHandle, id: &str, name: &'static str, start: &str, work: impl FnOnce() -> Result<(T, String), String>) -> Result<T, String> {
    step(app, id, name, "running", start);
    match work() {
        Ok((value, done)) => {
            step(app, id, name, "done", done);
            Ok(value)
        }
        Err(e) => {
            step(app, id, name, "error", e.clone());
            Err(e)
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Tls {
    Off,
    /// Certificate checked against the host.
    Verified,
    /// Through a tunnel or on this Mac the certificate names another host.
    Unchecked,
}

fn open_pool(host: &str, port: u16, secret: &DbSecret, tls: Tls) -> Result<(Pool, Opts), mysql::Error> {
    let mut opts = OptsBuilder::new()
        // "Rows matched", not "rows changed": saving an unchanged value must
        // still count as touching its one row.
        .additional_capabilities(CapabilityFlags::CLIENT_FOUND_ROWS)
        .ip_or_hostname(Some(host))
        .tcp_port(port)
        .user(Some(&secret.user))
        .pass(Some(&secret.password))
        .db_name(Some(&secret.database))
        .tcp_connect_timeout(Some(Duration::from_secs(10)))
        .read_timeout(Some(Duration::from_secs(600)))
        .pool_opts(PoolOpts::default().with_constraints(PoolConstraints::new(1, 4).expect("valid pool size")));
    match tls {
        Tls::Off => {}
        Tls::Verified => opts = opts.ssl_opts(Some(SslOpts::default())),
        Tls::Unchecked => {
            opts = opts.ssl_opts(Some(SslOpts::default().with_danger_accept_invalid_certs(true).with_danger_skip_domain_validation(true)))
        }
    }
    let opts = Opts::from(opts);
    let pool = Pool::new(opts.clone())?;
    pool.get_conn()?.query_drop("SELECT 1")?;
    Ok((pool, opts))
}

fn is_loopback(host: &str) -> bool {
    matches!(host, "127.0.0.1" | "localhost" | "::1")
}

/// Connect, retrying `attempts` times (a fresh port-forward needs a moment),
/// and with TLS when the server insists on it. Certificates are only left
/// unchecked on this Mac, where they cannot name the host.
fn connect_mysql(host: &str, port: u16, secret: &DbSecret, attempts: u64, cancelled: impl Fn() -> bool) -> Result<(Pool, Opts, String), String> {
    let mut last = String::new();
    for attempt in 0..attempts {
        if cancelled() {
            return Err(CANCELLED.into());
        }
        match open_pool(host, port, secret, Tls::Off) {
            Ok(pool) => return version(pool),
            Err(e) => {
                let text = e.to_string();
                if text.to_lowercase().contains("secure transport") || text.to_lowercase().contains("ssl") {
                    if cancelled() {
                        return Err(CANCELLED.into());
                    }
                    let tls = if is_loopback(host) { Tls::Unchecked } else { Tls::Verified };
                    return open_pool(host, port, secret, tls).map_err(|e| e.to_string()).and_then(version);
                }
                if text.contains("Access denied") {
                    return Err(format!("The database refused the credentials: {text}"));
                }
                last = text;
            }
        }
        if attempt + 1 < attempts {
            std::thread::sleep(Duration::from_millis(700 * (attempt + 1)));
        }
    }
    Err(format!("Could not reach MySQL on {host}:{port}: {last}"))
}

fn version((pool, opts): (Pool, Opts)) -> Result<(Pool, Opts, String), String> {
    let v: Option<String> = pool.get_conn().and_then(|mut c| c.query_first("SELECT VERSION()")).map_err(|e| e.to_string())?;
    Ok((pool, opts, v.unwrap_or_default()))
}

fn find(id: &str) -> Result<(Connection, String), String> {
    let file = connections::load()?;
    let relay = connections::relay_pod(&file);
    let conn = file.connections.into_iter().find(|c| c.id == id).ok_or("This connection no longer exists.")?;
    Ok((conn, relay))
}

fn connect(app: &AppHandle, procs: &Procs, forwards: &Forwards, sessions: &Sessions, id: &str) -> Result<SessionInfo, String> {
    if let Ok(existing) = sessions.get(id) {
        // Reuse a live session; a session whose tunnel died is replaced.
        let alive = existing.tunnel.as_ref().map_or(true, |t| forwards.list().iter().any(|f| f.id == t.forward_id));
        if alive {
            return Ok(existing.info.clone());
        }
        disconnect(app, id, "tunnel-lost");
    }
    let _attempt = Attempt::start(sessions, id)?;
    let (conn, relay) = find(id)?;
    if conn.kind == Kind::Local {
        return connect_local(app, sessions, id, &conn);
    }
    let Target { context, namespace } = connections::resolve(&conn);
    let cancelled = || sessions.is_cancelled(id);
    // On failure or cancel, undo what this attempt started: its tunnel, and
    // the relay pod if it created it and no open connection uses it.
    let undo = |created_pod: bool, forward_id: Option<u32>, error: String| -> String {
        if let Some(fid) = forward_id {
            forward::stop(procs, forwards, fid);
        }
        let shared = sessions.sessions.lock().unwrap().values().any(|s| s.tunnel.is_some() && s.info.context == context && s.info.namespace == namespace);
        if created_pod && !shared {
            let _ = tunnel::delete_pod(&context, &namespace, &relay, false);
        }
        error
    };
    let check = |created_pod: bool, forward_id: Option<u32>| if cancelled() { Err(undo(created_pod, forward_id, CANCELLED.into())) } else { Ok(()) };

    let secret = run_step(app, id, "secret", &format!("Reading {} in {namespace}", conn.secret), || {
        tunnel::read_secret(&context, &namespace, &conn.secret).map(|s| {
            let done = format!("{}@{}:{} / {}", s.user, s.host, s.port, s.database);
            (s, done)
        })
    })?;
    check(false, None)?;
    let (created, started_at) = run_step(app, id, "pod", &format!("Checking relay pod {relay}"), || {
        tunnel::ensure_relay(&context, &namespace, &relay, &secret).map(|(created, started)| {
            ((created, started), if created { format!("Created {relay}") } else { format!("Reusing running {relay}") })
        })
    })?;
    check(created, None)?;
    run_step(app, id, "ready", "Waiting for the relay pod to run", || {
        tunnel::wait_running(&context, &namespace, &relay, cancelled).map(|_| ((), "Running".into()))
    })
    .map_err(|e| undo(created, None, e))?;
    check(created, None)?;
    let fwd = run_step(app, id, "forward", &format!("Forwarding localhost:{}", conn.local_port), || {
        forward::start(app, procs, forwards, &context, &namespace, &format!("pod/{relay}"), conn.local_port, secret.port, "db")
            .map(|f| (f, format!("localhost:{} → {}", conn.local_port, secret.port)))
    })
    .map_err(|e| undo(created, None, e))?;
    check(created, Some(fwd.id))?;
    let (pool, opts, server_version) = run_step(app, id, "database", "Connecting to MySQL", || {
        connect_mysql("127.0.0.1", conn.local_port, &secret, 4, cancelled).map(|(p, o, v)| ((p, o, v.clone()), format!("MySQL {v}")))
    })
    .map_err(|e| undo(created, Some(fwd.id), e))?;
    check(created, Some(fwd.id))?;

    let now = chrono::Utc::now();
    // A reused relay pod has less than an hour left: count from its start.
    let pod_start = started_at
        .as_deref()
        .and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok())
        .map(|t| t.with_timezone(&chrono::Utc))
        .unwrap_or(now);
    let expires = pod_start + chrono::Duration::seconds(RELAY_LIFETIME_SECS as i64 - 60);
    let info = SessionInfo {
        connection_id: id.to_string(),
        context,
        namespace,
        host: "127.0.0.1".into(),
        local_port: conn.local_port,
        database: secret.database.clone(),
        user: secret.user.clone(),
        server_version,
        connected_at: now.to_rfc3339(),
        expires_at: expires.to_rfc3339(),
    };
    let session = Arc::new(Session {
        info: info.clone(),
        pool,
        opts,
        tunnel: Some(Tunnel { forward_id: fwd.id, relay_pod: relay }),
        password: secret.password,
        batches: Mutex::new(Vec::new()),
    });
    sessions.sessions.lock().unwrap().insert(id.to_string(), session);
    let lifetime = (expires - now).to_std().unwrap_or(Duration::from_secs(60));
    schedule_expiry(app.clone(), id.to_string(), info.connected_at.clone(), lifetime);
    Ok(info)
}

/// A database reached directly: one step, no tunnel, no time limit.
fn connect_local(app: &AppHandle, sessions: &Sessions, id: &str, conn: &Connection) -> Result<SessionInfo, String> {
    let password = super::local::password(id)?;
    let secret = DbSecret {
        host: conn.host.trim().to_string(),
        port: conn.local_port,
        user: conn.user.trim().to_string(),
        password,
        database: conn.database.trim().to_string(),
    };
    let (pool, opts, server_version) = run_step(app, id, "database", &format!("Connecting to {}:{}", secret.host, secret.port), || {
        connect_mysql(&secret.host, secret.port, &secret, 1, || sessions.is_cancelled(id)).map(|(p, o, v)| ((p, o, v.clone()), format!("MySQL {v}")))
    })?;
    if sessions.is_cancelled(id) {
        return Err(CANCELLED.into());
    }
    let info = SessionInfo {
        connection_id: id.to_string(),
        context: String::new(),
        namespace: String::new(),
        host: secret.host.clone(),
        local_port: secret.port,
        database: secret.database.clone(),
        user: secret.user.clone(),
        server_version,
        connected_at: chrono::Utc::now().to_rfc3339(),
        expires_at: String::new(),
    };
    let session = Arc::new(Session { info: info.clone(), pool, opts, tunnel: None, password: secret.password, batches: Mutex::new(Vec::new()) });
    sessions.sessions.lock().unwrap().insert(id.to_string(), session);
    Ok(info)
}

/// The relay pod exits after an hour; end the session just before.
fn schedule_expiry(app: AppHandle, id: String, connected_at: String, after: Duration) {
    std::thread::spawn(move || {
        std::thread::sleep(after);
        let sessions = app.state::<Sessions>().inner().clone();
        let same = sessions.get(&id).map(|s| s.info.connected_at == connected_at).unwrap_or(false);
        if same {
            disconnect(&app, &id, "expired");
        }
    });
}

/// The tunnel behind a session died: end the session so a reconnect starts clean.
pub fn forward_died(app: &AppHandle, forward_id: u32) {
    let sessions = app.state::<Sessions>().inner().clone();
    let id = sessions.sessions.lock().unwrap().iter().find(|(_, s)| s.tunnel.as_ref().is_some_and(|t| t.forward_id == forward_id)).map(|(id, _)| id.clone());
    if let Some(id) = id {
        disconnect(app, &id, "tunnel-lost");
    }
}

pub fn disconnect(app: &AppHandle, id: &str, reason: &'static str) {
    let sessions = app.state::<Sessions>().inner().clone();
    let Some(session) = sessions.sessions.lock().unwrap().remove(id) else { return };
    if let Some(t) = &session.tunnel {
        let procs = app.state::<Procs>().inner().clone();
        let forwards = app.state::<Forwards>().inner().clone();
        forward::stop(&procs, &forwards, t.forward_id);
        // Another open connection may share this namespace's relay pod.
        let shared = sessions
            .sessions
            .lock()
            .unwrap()
            .values()
            .any(|s| s.tunnel.is_some() && s.info.context == session.info.context && s.info.namespace == session.info.namespace);
        if !shared {
            let _ = tunnel::delete_pod(&session.info.context, &session.info.namespace, &t.relay_pod, false);
        }
    }
    let _ = app.emit("db-session-end", SessionEnd { connection_id: id.to_string(), reason });
}

/// App quit: stop every tunnel at once, then remove the relay pods in
/// parallel with a short timeout so quitting never hangs (the pods expire on
/// their own anyway).
pub fn disconnect_all(app: &AppHandle) {
    let sessions: Vec<Arc<Session>> = app.state::<Sessions>().sessions.lock().unwrap().drain().map(|(_, s)| s).collect();
    let procs = app.state::<Procs>().inner().clone();
    let forwards = app.state::<Forwards>().inner().clone();
    let mut pods = std::collections::HashSet::new();
    for s in &sessions {
        if let Some(t) = &s.tunnel {
            forward::stop(&procs, &forwards, t.forward_id);
            pods.insert((s.info.context.clone(), s.info.namespace.clone(), t.relay_pod.clone()));
        }
    }
    let handles: Vec<_> = pods
        .into_iter()
        .map(|(ctx, ns, pod)| std::thread::spawn(move || tunnel::delete_pod_quick(&ctx, &ns, &pod)))
        .collect();
    for h in handles {
        let _ = h.join();
    }
}

#[tauri::command]
pub async fn db_connect(
    app: AppHandle,
    procs: State<'_, Procs>,
    forwards: State<'_, Forwards>,
    sessions: State<'_, Sessions>,
    connection_id: String,
) -> Result<SessionInfo, String> {
    let (procs, forwards, sessions) = (procs.inner().clone(), forwards.inner().clone(), sessions.inner().clone());
    blocking(move || connect(&app, &procs, &forwards, &sessions, &connection_id)).await
}

/// Stop a connect in progress at its next step; it cleans up after itself.
#[tauri::command]
pub fn db_cancel_connect(sessions: State<'_, Sessions>, connection_id: String) {
    if sessions.connecting.lock().unwrap().contains(&connection_id) {
        sessions.cancelled.lock().unwrap().insert(connection_id);
    }
}

#[tauri::command]
pub async fn db_disconnect(app: AppHandle, connection_id: String) -> Result<(), String> {
    blocking(move || {
        disconnect(&app, &connection_id, "disconnected");
        Ok(())
    })
    .await
}

#[tauri::command]
pub fn db_sessions(sessions: State<'_, Sessions>) -> Vec<SessionInfo> {
    sessions.sessions.lock().unwrap().values().map(|s| s.info.clone()).collect()
}

/// The password, only on an explicit "copy password" (for an external client).
#[tauri::command]
pub fn db_password(sessions: State<'_, Sessions>, connection_id: String) -> Result<String, String> {
    // Explicit user action ("Copy password") for an external SQL client.
    sessions.get(&connection_id).map(|s| s.password.clone())
}
