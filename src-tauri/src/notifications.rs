//! Task-change notifications: compares a snapshot of task statuses against the
//! current database state and fires a native macOS notification for every
//! status transition and every newly-created task.
//!
//! The snapshot is updated after each diff, so rapid sequences of changes each
//! get their own notification rather than being coalesced.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;
use taskboard_core::{Db, Status, TaskFilter};

/// Map of task_id → (status, title) last seen by the notification system.
#[derive(Default, Clone)]
pub struct TaskSnapshot(Arc<Mutex<HashMap<i64, (Status, String)>>>);

impl TaskSnapshot {
    /// Query the DB, diff against the snapshot, fire notifications, update snapshot.
    pub fn diff_and_notify(&self, app: &AppHandle) {
        let db = match Db::open_default() {
            Ok(db) => db,
            Err(_) => return,
        };
        let tasks = match db.list_tasks(&TaskFilter::default()) {
            Ok(t) => t,
            Err(_) => return,
        };

        let mut snapshot = self.0.lock().unwrap();

        for task in &tasks {
            match snapshot.get(&task.id) {
                None => {
                    // New task appeared.
                    let kind_label = if task.kind == taskboard_core::Kind::Bug {
                        "🐛 Bug"
                    } else {
                        "📋 Task"
                    };
                    send(
                        app,
                        &format!("{kind_label} created"),
                        &format!("#{} {}", task.id, truncate(&task.title, 60)),
                    );
                }
                Some((prev_status, _)) if *prev_status != task.status => {
                    // Status changed.
                    let emoji = status_emoji(task.status);
                    send(
                        app,
                        &format!("{emoji} {} → {}", prev_status, task.status),
                        &format!("#{} {}", task.id, truncate(&task.title, 60)),
                    );
                }
                _ => {}
            }
            snapshot.insert(task.id, (task.status, task.title.clone()));
        }

        // Remove deleted tasks from the snapshot (no notification — deletion is explicit).
        let current_ids: std::collections::HashSet<i64> = tasks.iter().map(|t| t.id).collect();
        snapshot.retain(|id, _| current_ids.contains(id));
    }

    /// Seed the snapshot without firing notifications — called once at startup
    /// so we don't notify about all pre-existing tasks on first launch.
    pub fn seed(&self) {
        let db = match Db::open_default() {
            Ok(db) => db,
            Err(_) => return,
        };
        let tasks = match db.list_tasks(&TaskFilter::default()) {
            Ok(t) => t,
            Err(_) => return,
        };
        let mut snapshot = self.0.lock().unwrap();
        for task in tasks {
            snapshot.insert(task.id, (task.status, task.title));
        }
    }
}

fn send(app: &AppHandle, title: &str, body: &str) {
    let _ = app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show();
}

fn status_emoji(status: Status) -> &'static str {
    match status {
        Status::Open => "🔵",
        Status::Waiting => "🟡",
        Status::InProgress => "🟣",
        Status::Review => "🔴",
        Status::Done => "✅",
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let cut: String = s.chars().take(max.saturating_sub(1)).collect();
        format!("{cut}…")
    }
}
