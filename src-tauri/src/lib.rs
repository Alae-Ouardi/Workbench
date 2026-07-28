mod board;
mod notifications;
mod pty;
mod tp;
mod tray;
mod watcher;

use notifications::TaskSnapshot;
use tauri::WindowEvent;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let snapshot = TaskSnapshot::default();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(pty::PtyState::default())
        .setup(move |app| {
            watcher::start(app.handle().clone(), snapshot)?;
            tp::spawn_sync_worker(app.handle().clone());
            tray::init(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Hide the tray popover when it loses focus (click-away dismissal).
            if window.label() == "tray" {
                if let WindowEvent::Focused(false) = event {
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            board::list_projects,
            board::list_tasks,
            board::get_task,
            board::create_task,
            board::create_project,
            board::set_status,
            board::update_task,
            board::add_comment,
            board::set_dependencies,
            board::delete_task,
            board::delete_project,
            board::get_briefing,
            board::update_project_context,
            board::show_main_window,
            tp::tp_get_settings,
            tp::tp_save_settings,
            tp::tp_set_token,
            tp::tp_clear_token,
            tp::tp_test_connection,
            tp::tp_search_user_stories,
            tp::tp_link_project,
            tp::tp_unlink_project,
            tp::tp_backfill_project,
            tp::tp_sync_now,
            tp::tp_list_queue,
            tp::tp_retry_queue_item,
            tp::tp_retry_all_queue_items,
            tp::tp_dismiss_queue_item,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
