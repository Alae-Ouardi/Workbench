mod board;
mod notifications;
mod pty;
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
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
