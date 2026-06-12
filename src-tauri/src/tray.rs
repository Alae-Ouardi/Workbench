//! macOS menubar tray icon with a click-to-toggle popover window.

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, Manager,
};

pub fn init(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let open_item = MenuItem::with_id(app, "open", "Open TaskBoard", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().cloned().unwrap())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                position,
                rect,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(popover) = app.get_webview_window("tray") {
                    if popover.is_visible().unwrap_or(false) {
                        let _ = popover.hide();
                    } else {
                        // Position the popover centred horizontally under the tray icon.
                        // `position` is PhysicalPosition<f64> of the cursor click.
                        // `rect` gives the icon bounds; use its right edge to estimate the bar.
                        let popover_w = 380.0_f64;
                        let x = position.x - popover_w / 2.0;
                        // Place just below the icon: icon bottom = position.y + half-icon-height.
                        // We add a small gap so it doesn't overlap the menu bar.
                        let icon_bottom = match rect.size {
                            tauri::Size::Physical(s) => rect.position.to_physical::<f64>(1.0).y + s.height as f64,
                            tauri::Size::Logical(s) => rect.position.to_physical::<f64>(1.0).y + s.height,
                        };
                        let y = icon_bottom + 2.0;
                        let _ = popover.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
                        let _ = popover.show();
                        let _ = popover.set_focus();
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}
