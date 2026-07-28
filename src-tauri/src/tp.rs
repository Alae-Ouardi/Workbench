//! Tauri commands for the TargetProcess integration, plus the background
//! worker that drains the sync queue.
//!
//! Follows `board.rs`: a fresh `Db` per call, and every error flattened to a
//! `String` for the frontend.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use taskboard_core::tp::client::{parse_entity_id, TpClient};
use taskboard_core::{Db, Project, SyncQueueItem, SyncReport, TpSettings, TpUser, TpUserStory};
use tauri::{AppHandle, Emitter};

/// How often the worker looks for queued work. Frequent enough that a task
/// marked done in the app shows its TargetProcess id almost immediately.
const DRAIN_INTERVAL: Duration = Duration::from_secs(15);

fn db() -> Result<Db, String> {
    Db::open_default().map_err(|e| e.to_string())
}

/// Settings as the frontend sees them: the token itself is never sent back,
/// only whether one is stored.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TpSettingsView {
    #[serde(flatten)]
    pub settings: TpSettings,
    pub token_set: bool,
    /// Pre-normalized base URL, so the frontend can build entity links directly.
    pub base_url_normalized: String,
}

fn view(settings: TpSettings) -> TpSettingsView {
    TpSettingsView {
        token_set: taskboard_core::tp::config::load_token().is_some(),
        base_url_normalized: settings.normalized_base_url().to_string(),
        settings,
    }
}

#[tauri::command]
pub fn tp_get_settings() -> Result<TpSettingsView, String> {
    Ok(view(TpSettings::load()))
}

#[tauri::command]
pub fn tp_save_settings(settings: TpSettings) -> Result<TpSettingsView, String> {
    let mut current = TpSettings::load();
    current.apply_update(settings);
    current.save().map_err(|e| e.to_string())?;
    Ok(view(current))
}

/// Store a new access token. The cached user belongs to the old token, so it is
/// dropped; the next `tp_test_connection` repopulates it.
#[tauri::command]
pub fn tp_set_token(token: String) -> Result<TpSettingsView, String> {
    taskboard_core::tp::config::save_token(&token).map_err(|e| e.to_string())?;
    let mut settings = TpSettings::load();
    settings.clear_cached_user();
    settings.save().map_err(|e| e.to_string())?;
    Ok(view(settings))
}

#[tauri::command]
pub fn tp_clear_token() -> Result<TpSettingsView, String> {
    taskboard_core::tp::config::clear_token().map_err(|e| e.to_string())?;
    let mut settings = TpSettings::load();
    settings.clear_cached_user();
    settings.save().map_err(|e| e.to_string())?;
    Ok(view(settings))
}

/// Verify the URL and token by asking TargetProcess who we are, caching the
/// answer so the sync worker doesn't have to repeat it.
#[tauri::command]
pub fn tp_test_connection() -> Result<TpUser, String> {
    let mut settings = TpSettings::load();
    let client = TpClient::from_settings(&settings).map_err(|e| e.to_string())?;
    let user = client.get_context().map_err(|e| e.to_string())?;
    settings.cached_user_id = Some(user.id);
    settings.cached_user_name = user.name.clone();
    settings.save().map_err(|e| e.to_string())?;
    Ok(user)
}

/// Search user stories by name, or resolve a pasted id / entity URL.
#[tauri::command]
pub fn tp_search_user_stories(query: String) -> Result<Vec<TpUserStory>, String> {
    let settings = TpSettings::load();
    let client = TpClient::from_settings(&settings).map_err(|e| e.to_string())?;
    client
        .search_user_stories(&query)
        .map_err(|e| e.to_string())
}

/// Link a project to a user story. `user_story` accepts an id or a pasted
/// `…/entity/<id>` URL, so the field is forgiving about what gets pasted in.
#[tauri::command]
pub fn tp_link_project(project_id: i64, user_story: String) -> Result<Project, String> {
    let user_story_id = parse_entity_id(&user_story)
        .ok_or_else(|| format!("'{user_story}' is not a user story id or URL"))?;
    db()?
        .link_tp_project(project_id, user_story_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn tp_unlink_project(project_id: i64) -> Result<Project, String> {
    db()?
        .unlink_tp_project(project_id)
        .map_err(|e| e.to_string())
}

/// Queue every not-yet-mirrored task of a project. Returns how many operations
/// were queued.
#[tauri::command]
pub fn tp_backfill_project(project_id: i64) -> Result<usize, String> {
    db()?
        .backfill_tp_project(project_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn tp_sync_now(app: AppHandle) -> Result<SyncReport, String> {
    let report = db()?.drain_tp_queue().map_err(|e| e.to_string())?;
    if report.succeeded > 0 || report.dropped > 0 {
        let _ = app.emit("board-changed", ());
    }
    Ok(report)
}

#[tauri::command]
pub fn tp_list_queue() -> Result<Vec<SyncQueueItem>, String> {
    db()?.list_tp_queue().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn tp_retry_queue_item(id: i64) -> Result<(), String> {
    db()?.retry_tp_op(id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn tp_retry_all_queue_items() -> Result<usize, String> {
    db()?.retry_all_tp_ops().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn tp_dismiss_queue_item(id: i64) -> Result<(), String> {
    db()?.dismiss_tp_op(id).map_err(|e| e.to_string())
}

/// Start the background drain loop.
///
/// Cheap when idle: it opens the database, counts the queue, and goes back to
/// sleep unless there is something due. Mirrors `watcher.rs` in using a plain
/// thread — this workspace has no async runtime.
pub fn spawn_sync_worker(app: AppHandle) {
    let running = Arc::new(AtomicBool::new(false));
    std::thread::spawn(move || loop {
        std::thread::sleep(DRAIN_INTERVAL);
        // Skip a tick rather than stacking drains if one runs long.
        if running.swap(true, Ordering::SeqCst) {
            continue;
        }
        if let Ok(db) = Db::open_default() {
            let due = db.count_tp_queue().map(|(pending, _)| pending).unwrap_or(0);
            if due > 0 {
                match db.drain_tp_queue() {
                    Ok(report) if report.succeeded > 0 || report.dropped > 0 => {
                        let _ = app.emit("board-changed", ());
                    }
                    // Failures are recorded on the queue rows; the settings view
                    // and the per-task badges are where the user sees them.
                    Ok(_) => {}
                    Err(e) => eprintln!("taskboard: TargetProcess sync failed: {e}"),
                }
            }
        }
        running.store(false, Ordering::SeqCst);
    });
}
