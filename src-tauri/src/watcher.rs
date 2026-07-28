//! Watches the taskboard database for changes from any source (UI, CLI, MCP
//! server) and:
//!   1. Emits a `board-changed` event to the frontend for live refresh.
//!   2. Diffs the task-status snapshot and fires native macOS notifications.
//!
//! SQLite is opened in WAL mode, so filesystem watchers alone are unreliable.
//! A periodic poll (every 2 seconds) backs up the watcher to catch CLI/MCP
//! changes that never touch the main DB file.

use std::time::Duration;

use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode};
use taskboard_core::Db;
use tauri::{AppHandle, Emitter};

use crate::notifications::TaskSnapshot;

const POLL_INTERVAL: Duration = Duration::from_secs(2);

pub fn start(app: AppHandle, snapshot: TaskSnapshot) -> Result<(), Box<dyn std::error::Error>> {
    // Ensure the DB (and its directory) exist, then seed the snapshot so we
    // don't fire notifications for all pre-existing tasks on first run.
    Db::open_default()?;
    snapshot.seed();

    let db_dir = Db::default_path()
        .parent()
        .expect("db path always has a parent directory")
        .to_path_buf();

    // File-system watcher for fast UI updates when the main DB file changes.
    let watcher_app = app.clone();
    let watcher_snapshot = snapshot.clone();
    std::thread::spawn(move || {
        let (tx, rx) = std::sync::mpsc::channel();
        let mut debouncer = match new_debouncer(Duration::from_millis(300), tx) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("taskboard: failed to create file watcher: {e}");
                return;
            }
        };
        if let Err(e) = debouncer
            .watcher()
            .watch(&db_dir, RecursiveMode::NonRecursive)
        {
            eprintln!("taskboard: failed to watch {}: {e}", db_dir.display());
            return;
        }
        for event in rx {
            if event.is_ok() {
                notify_if_changed(&watcher_snapshot, &watcher_app);
            }
        }
    });

    // Polling fallback: SQLite WAL mode may leave changes in the WAL file, so
    // the filesystem watcher can miss CLI/MCP edits. Poll every 2 seconds.
    std::thread::spawn(move || loop {
        std::thread::sleep(POLL_INTERVAL);
        notify_if_changed(&snapshot, &app);
    });

    Ok(())
}

fn notify_if_changed(snapshot: &TaskSnapshot, app: &AppHandle) {
    // Diff first (fires notifications for external changes).
    if snapshot.diff_and_notify(app) {
        // Then tell the frontend to re-render, but only if something changed.
        let _ = app.emit("board-changed", ());
    }
}
