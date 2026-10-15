//! The macOS app menu. The default menu binds ⌘W to "Close Window"; here ⌘W
//! closes a tab instead, and ⌘T opens one. Tab items are forwarded to the
//! frontend as `menu-tab` events.

use serde::Serialize;
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Runtime};

#[derive(Clone, Serialize)]
struct TabAction {
    action: &'static str,
}

const ACTIONS: &[(&str, &str, &str)] = &[
    ("tab-new", "New Tab", "CmdOrCtrl+T"),
    ("tab-close", "Close Tab", "CmdOrCtrl+W"),
    ("tab-next", "Next Tab", "Ctrl+Tab"),
    ("tab-prev", "Previous Tab", "Ctrl+Shift+Tab"),
];

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let app_menu = Submenu::with_items(
        app,
        "Workbench",
        true,
        &[
            &PredefinedMenuItem::about(app, None, Some(AboutMetadata::default()))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let tab_items: Vec<MenuItem<R>> = ACTIONS
        .iter()
        .map(|(id, label, accel)| MenuItem::with_id(app, *id, *label, true, Some(*accel)))
        .collect::<tauri::Result<_>>()?;
    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &tab_items.iter().map(|i| i as &dyn tauri::menu::IsMenuItem<R>).collect::<Vec<_>>(),
    )?;

    // Without an Edit menu, copy and paste shortcuts do nothing in the webview.
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &window_menu])
}

/// Forward tab menu items to the frontend.
pub fn handle<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let action = match id {
        "tab-new" => "new",
        "tab-close" => "close",
        "tab-next" => "next",
        "tab-prev" => "prev",
        _ => return,
    };
    let _ = app.emit_to("main", "menu-tab", TabAction { action });
}
