//! Task-change notifications: compares a snapshot of task statuses against the
//! current database state and fires a native macOS notification for every
//! status transition, every newly-created task, and every project that just
//! finished all of its tasks.
//!
//! The snapshot is updated after each diff, so rapid sequences of changes each
//! get their own notification rather than being coalesced.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;
use taskboard_core::{Db, Status, Task, TaskFilter};

#[derive(Default, Clone)]
pub struct TaskSnapshot {
    inner: Arc<Mutex<Snapshot>>,
}

#[derive(Default)]
struct Snapshot {
    tasks: HashMap<i64, Status>,
    projects: HashMap<i64, ProjectState>,
}

struct ProjectState {
    name: String,
    active: usize,
    done: usize,
}

impl TaskSnapshot {
    /// Query the DB, diff against the snapshot, fire notifications, update snapshot.
    /// Returns `true` if the DB state differed from the snapshot.
    pub fn diff_and_notify(&self, app: &AppHandle) -> bool {
        let db = match Db::open_default() {
            Ok(db) => db,
            Err(_) => return false,
        };
        let tasks = match db.list_tasks(&TaskFilter::default()) {
            Ok(t) => t,
            Err(_) => return false,
        };

        // 1. Collect per-task notifications without mutating the snapshot.
        let task_notifications: Vec<(String, String)> = {
            let snapshot = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            tasks
                .iter()
                .filter_map(|task| match snapshot.tasks.get(&task.id) {
                    None => {
                        let kind_label = if task.kind == taskboard_core::Kind::Bug {
                            "🐛 Bug"
                        } else {
                            "📋 Task"
                        };
                        Some((
                            format!("{kind_label} created"),
                            format!("#{} {}", task.id, truncate(&task.title, 60)),
                        ))
                    }
                    Some(prev_status) if *prev_status != task.status => {
                        let emoji = status_emoji(task.status);
                        Some((
                            format!("{emoji} {} → {}", prev_status, task.status),
                            format!("#{} {}", task.id, truncate(&task.title, 60)),
                        ))
                    }
                    _ => None,
                })
                .collect()
        };
        for (title, body) in &task_notifications {
            send(app, title, body);
        }

        // 2. Project completion event (immediate) and native notification (delayed).
        let completed = self.detect_completed_projects(&tasks);
        for (project_id, project_name) in &completed {
            let _ = app.emit(
                "project-all-done",
                ProjectAllDone {
                    project_id: *project_id,
                    project_name: project_name.clone(),
                },
            );
        }
        if !completed.is_empty() {
            let app = app.clone();
            let completed: Vec<(i64, String)> = completed
                .iter()
                .map(|(id, name)| (*id, name.clone()))
                .collect();
            std::thread::spawn(move || {
                // Give the per-task status notification time to display first.
                std::thread::sleep(Duration::from_millis(800));
                for (_, project_name) in completed {
                    send(
                        &app,
                        &format!("🎉 Project complete — {project_name}"),
                        "All tasks are done.",
                    );
                }
            });
        }

        // 3. Determine whether anything changed before updating the snapshot.
        let changed = !task_notifications.is_empty()
            || !completed.is_empty()
            || self.has_changes(&tasks);

        // 4. Update snapshot once.
        self.update(&tasks);

        changed
    }

    fn has_changes(&self, tasks: &[Task]) -> bool {
        let snapshot = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let current_tasks: std::collections::HashSet<i64> = tasks.iter().map(|t| t.id).collect();
        let prev_tasks: std::collections::HashSet<i64> = snapshot.tasks.keys().copied().collect();
        if current_tasks != prev_tasks {
            return true;
        }
        for task in tasks {
            if snapshot
                .tasks
                .get(&task.id)
                .map(|s| *s != task.status)
                .unwrap_or(true)
            {
                return true;
            }
        }
        let current_projects = project_states(tasks);
        if snapshot.projects.len() != current_projects.len() {
            return true;
        }
        for (id, state) in &current_projects {
            match snapshot.projects.get(id) {
                Some(prev) if prev.active == state.active && prev.done == state.done => {}
                _ => return true,
            }
        }
        false
    }

    /// Seed the snapshot without firing notifications.
    pub fn seed(&self) {
        let db = match Db::open_default() {
            Ok(db) => db,
            Err(_) => return,
        };
        let tasks = match db.list_tasks(&TaskFilter::default()) {
            Ok(t) => t,
            Err(_) => return,
        };
        self.update(&tasks);
    }

    fn detect_completed_projects(&self, tasks: &[Task]) -> Vec<(i64, String)> {
        let snapshot = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let current = project_states(tasks);
        let mut completed = Vec::new();
        for (id, state) in &current {
            if state.active == 0 && state.done > 0 {
                if let Some(prev) = snapshot.projects.get(id) {
                    if prev.active > 0 {
                        completed.push((*id, state.name.clone()));
                    }
                }
            }
        }
        completed
    }

    fn update(&self, tasks: &[Task]) {
        let mut snapshot = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        snapshot.tasks.clear();
        for task in tasks {
            snapshot.tasks.insert(task.id, task.status);
        }
        snapshot.projects = project_states(tasks);
    }
}

fn project_states(tasks: &[Task]) -> HashMap<i64, ProjectState> {
    let mut map: HashMap<i64, ProjectState> = HashMap::new();
    for task in tasks {
        let entry = map.entry(task.project_id).or_insert_with(|| ProjectState {
            name: task.project_name.clone(),
            active: 0,
            done: 0,
        });
        if task.status == Status::Done {
            entry.done += 1;
        } else {
            entry.active += 1;
        }
    }
    map
}

#[derive(Clone, Serialize)]
struct ProjectAllDone {
    project_id: i64,
    project_name: String,
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

#[cfg(test)]
mod tests {
    use super::*;
    use taskboard_core::{Kind, Priority, Status, Task};

    fn task(id: i64, project_id: i64, project_name: &str, status: Status) -> Task {
        Task {
            id,
            project_id,
            project_name: project_name.to_string(),
            title: format!("Task {id}"),
            description: String::new(),
            status,
            kind: Kind::Task,
            assignee: "me".to_string(),
            priority: Priority::Normal,
            position: 0.0,
            created_at: "2026-06-16T00:00:00Z".to_string(),
            updated_at: "2026-06-16T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn detects_project_completion_when_last_active_task_becomes_done() {
        let snapshot = TaskSnapshot::default();
        snapshot.update(&[
            task(1, 10, "Alpha", Status::Open),
            task(2, 10, "Alpha", Status::Done),
        ]);
        let completed = snapshot.detect_completed_projects(&[
            task(1, 10, "Alpha", Status::Done),
            task(2, 10, "Alpha", Status::Done),
        ]);
        assert_eq!(completed.len(), 1);
        assert_eq!(completed[0], (10, "Alpha".to_string()));
    }

    #[test]
    fn does_not_fire_for_already_done_project() {
        let snapshot = TaskSnapshot::default();
        snapshot.update(&[task(1, 10, "Alpha", Status::Done)]);
        let completed = snapshot.detect_completed_projects(&[task(1, 10, "Alpha", Status::Done)]);
        assert!(completed.is_empty());
    }

    #[test]
    fn does_not_fire_for_empty_project() {
        let snapshot = TaskSnapshot::default();
        snapshot.update(&[]);
        let completed = snapshot.detect_completed_projects(&[]);
        assert!(completed.is_empty());
    }
}
