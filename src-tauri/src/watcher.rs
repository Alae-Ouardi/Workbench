//! Watches the taskboard database directory for changes from any source
//! (UI, CLI, MCP server) and:
//!   1. Emits a `board-changed` event to the frontend for live refresh.
//!   2. Diffs the task-status snapshot and fires native macOS notifications.

use std::time::Duration;

use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode};
use tauri::{AppHandle, Emitter};
use taskboard_core::Db;

use crate::notifications::TaskSnapshot;

pub fn start(app: AppHandle, snapshot: TaskSnapshot) -> Result<(), Box<dyn std::error::Error>> {
    // Ensure the DB (and its directory) exist, then seed the snapshot so we
    // don't fire notifications for all pre-existing tasks on first run.
    Db::open_default()?;
    snapshot.seed();

    let db_dir = Db::default_path()
        .parent()
        .expect("db path always has a parent directory")
        .to_path_buf();

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
                // Diff first (fires notifications for external changes).
                snapshot.diff_and_notify(&app);
                // Then tell the frontend to re-render.
                let _ = app.emit("board-changed", ());
            }
        }
    });
    Ok(())
}
