mod board;
mod browser;
mod calendar;
mod db;
mod env;
mod k8s;
mod meetings;
mod menu;
mod notifications;
mod proc;
mod pty;
mod tp;
mod tray;
mod util;
mod watcher;
mod workspace;

use notifications::TaskSnapshot;
use std::sync::Arc;
use tauri::{Manager, RunEvent, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let snapshot = TaskSnapshot::default();
    let meetings: meetings::MeetingsState = Arc::new(meetings::Meetings::load());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(pty::PtyState::default())
        .manage(Arc::new(proc::ProcManager::default()) as proc::Procs)
        .manage(Arc::new(k8s::forward::ForwardRegistry::default()) as k8s::forward::Forwards)
        .manage(Arc::new(db::session::SessionRegistry::default()) as db::session::Sessions)
        .manage(Arc::new(db::query::RunningQueries::default()))
        .manage(Arc::clone(&meetings))
        .manage(browser::Browsers::default())
        .menu(menu::build)
        .on_menu_event(|app, event| menu::handle(app, event.id().as_ref()))
        .setup(move |app| {
            env::warm_up();
            watcher::start(app.handle().clone(), snapshot)?;
            tp::spawn_sync_worker(app.handle().clone());
            tray::init(app)?;
            meetings::start(app.handle().clone(), meetings);
            Ok(())
        })
        .on_window_event(|window, event| {
            // Hide the tray popover when it loses focus (click-away dismissal).
            if window.label() == "tray" {
                if let WindowEvent::Focused(false) = event {
                    if let Some(popover) = window.app_handle().get_webview_window("tray") {
                        tray::hide_on_blur(&popover);
                    }
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
            tray::quit_app,
            browser::browser_sync,
            browser::browser_navigate,
            browser::browser_go,
            browser::browser_close,
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
            workspace::tpw_query,
            workspace::tpw_me,
            workspace::tpw_states,
            workspace::tpw_set_state,
            workspace::tpw_log_time,
            workspace::tpw_get_prefs,
            workspace::tpw_save_prefs,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            proc::proc_kill,
            util::save_text_file,
            k8s::contexts::k8s_contexts,
            k8s::contexts::k8s_namespaces,
            k8s::resources::k8s_list,
            k8s::resources::k8s_get,
            k8s::resources::k8s_get_yaml,
            k8s::resources::k8s_describe,
            k8s::resources::k8s_events_for,
            k8s::resources::k8s_top,
            k8s::resources::k8s_secret_value,
            k8s::actions::k8s_delete,
            k8s::actions::k8s_scale,
            k8s::actions::k8s_rollout_restart,
            k8s::actions::k8s_replace_yaml,
            k8s::watch::k8s_watch_start,
            k8s::watch::k8s_watch_stop,
            k8s::logs::k8s_logs_start,
            k8s::forward::k8s_forward_start,
            k8s::forward::k8s_forward_stop,
            k8s::forward::k8s_forward_list,
            k8s::k8s_exec,
            db::connections::db_connections_get,
            db::connections::db_connections_save,
            db::session::db_connect,
            db::session::db_disconnect,
            db::session::db_cancel_connect,
            db::local::db_local_password_set,
            db::local::db_local_password_saved,
            db::session::db_sessions,
            db::session::db_password,
            db::schema::db_tables,
            db::schema::db_table_detail,
            db::schema::db_completion_schema,
            db::query::db_rows,
            db::query::db_query,
            db::query::db_cancel,
            db::changes::db_prepare_changes,
            db::changes::db_apply_changes,
            meetings::meeting_overview,
            meetings::meeting_split,
            meetings::meeting_stop,
            meetings::meeting_log,
            meetings::meeting_dismiss,
            meetings::meeting_settings_get,
            meetings::meeting_settings_save,
            meetings::meeting_holidays,
            meetings::meeting_run_recurring,
            meetings::menubar_refresh,
            calendar::calendar_access,
            calendar::calendar_request_access,
            calendar::calendar_events,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Leave nothing running behind: terminals, log streams, tunnels.
            if let RunEvent::Exit = event {
                db::session::disconnect_all(app);
                app.state::<proc::Procs>().kill_all();
                app.state::<pty::PtyState>().kill_all();
            }
        });
}
