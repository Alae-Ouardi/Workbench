//! macOS menubar tray icon with a click-to-toggle popover window.

use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::{
    tray::{MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager,
};

const TRAY_ID: &str = "main";

/// Text next to the menu-bar icon; empty shows the icon alone.
pub fn set_title(app: &tauri::AppHandle, text: &str) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        // An empty string, not None: None leaves the previous text in place.
        let _ = tray.set_title(Some(text));
    }
}

/// Drop the popover down under the menu bar's right side, on the Today tab,
/// without waiting for a click. It floats above other apps (and on every
/// Space) even when TaskBoard isn't the active app, which macOS doesn't
/// guarantee for the main window.
pub fn show_today(app: &tauri::AppHandle) {
    use tauri::Emitter;
    let Some(popover) = app.get_webview_window("tray") else { return };
    // Already open and in use: leave it (and its tab) alone.
    if popover.is_visible().unwrap_or(false) && popover.is_focused().unwrap_or(false) {
        return;
    }
    let monitor = popover.current_monitor().ok().flatten().or_else(|| popover.primary_monitor().ok().flatten());
    if let Some(m) = monitor {
        let scale = m.scale_factor();
        let (pos, size) = (m.position(), m.size());
        let x = pos.x as f64 + size.width as f64 - (POPOVER_WIDTH + 12.0) * scale;
        let y = pos.y as f64 + MENU_BAR_HEIGHT * scale;
        let _ = popover.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
    }
    let _ = popover.set_visible_on_all_workspaces(true);
    let _ = popover.set_always_on_top(true);
    let _ = popover.show();
    let _ = app.emit_to("tray", "tray-show-today", ());
}

const POPOVER_WIDTH: f64 = 380.0;
/// Points from the top of the screen to just under the menu bar.
const MENU_BAR_HEIGHT: f64 = 30.0;

/// Two click paths can report the same click (see `install_click_action`).
const DOUBLE_CLICK_GUARD: Duration = Duration::from_millis(350);

/// When the popover last closed because it lost focus. Clicking the icon to
/// close it blurs it first; without this the click would reopen it.
static BLUR_HIDDEN: Mutex<Option<Instant>> = Mutex::new(None);

/// The popover lost focus: hide it and remember when.
pub fn hide_on_blur(popover: &tauri::WebviewWindow) {
    *BLUR_HIDDEN.lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
    let _ = popover.hide();
}

/// Quit from the popover (the menu-bar icon has no menu).
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Open the popover under the menu-bar icon, or close it.
fn toggle_popover(app: &AppHandle) {
    static LAST: Mutex<Option<Instant>> = Mutex::new(None);
    {
        let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
        if last.is_some_and(|t| t.elapsed() < DOUBLE_CLICK_GUARD) {
            return;
        }
        *last = Some(Instant::now());
    }
    let Some(popover) = app.get_webview_window("tray") else { return };
    if popover.is_visible().unwrap_or(false) {
        let _ = popover.hide();
        return;
    }
    let just_blurred = BLUR_HIDDEN.lock().unwrap_or_else(|e| e.into_inner()).is_some_and(|t| t.elapsed() < DOUBLE_CLICK_GUARD);
    if just_blurred {
        return;
    }
    if let Some(rect) = app.tray_by_id(TRAY_ID).and_then(|t| t.rect().ok().flatten()) {
        let scale = popover.scale_factor().unwrap_or(1.0);
        let pos = rect.position.to_physical::<f64>(scale);
        let size = rect.size.to_physical::<f64>(scale);
        // Centred under the icon, just below the menu bar.
        let x = pos.x + size.width / 2.0 - POPOVER_WIDTH * scale / 2.0;
        let y = pos.y + size.height + 2.0;
        let _ = popover.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
    }
    let _ = popover.show();
    let _ = popover.set_focus();
}

pub fn init(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    // A template image: macOS recolours it for light/dark menu bars, which a
    // full-colour app icon can't do.
    let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-template@2x.png"))?;

    // No context menu: "Open Workbench" and "Quit" live in the popover. With a
    // menu attached, recent macOS shows it on every click and the popover
    // never opens.
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(tray_icon)
        .icon_as_template(true)
        .tooltip("Workbench")
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button_state: MouseButtonState::Down, .. } = event {
                toggle_popover(tray.app_handle());
            }
        })
        .build(app)?;

    #[cfg(target_os = "macos")]
    {
        let _ = APP.set(app.handle().clone());
        // Off the main thread: `with_inner_tray_icon` dispatches to it and waits.
        let handle = app.handle().clone();
        std::thread::spawn(move || {
            if let Some(tray) = handle.tray_by_id(TRAY_ID) {
                let _ = tray.with_inner_tray_icon(|inner| {
                    if let Some(item) = inner.ns_status_item() {
                        install_click_action(&item);
                    }
                });
            }
        });
    }
    Ok(())
}

#[cfg(target_os = "macos")]
static APP: OnceLock<AppHandle> = OnceLock::new();

#[cfg(target_os = "macos")]
objc2::define_class!(
    // SAFETY: NSObject has no subclassing requirements and this class has no Drop.
    #[unsafe(super(objc2_foundation::NSObject))]
    #[thread_kind = objc2::MainThreadOnly]
    #[name = "WorkbenchTrayClick"]
    struct TrayClick;

    impl TrayClick {
        #[unsafe(method(clicked:))]
        fn clicked(&self, _sender: Option<&objc2::runtime::AnyObject>) {
            if let Some(app) = APP.get() {
                toggle_popover(app);
            }
        }
    }
);

/// The tray library catches clicks with a view laid over the menu-bar button,
/// but on recent macOS the button can receive them itself. Give the button
/// its own action too, so a click always reaches `toggle_popover` (the guard
/// there drops the duplicate when both fire). Runs on the main thread.
#[cfg(target_os = "macos")]
fn install_click_action(item: &objc2_app_kit::NSStatusItem) {
    use objc2::{msg_send, sel, MainThreadMarker, MainThreadOnly as _};
    use objc2_app_kit::NSEventMask;
    let Some(mtm) = MainThreadMarker::new() else { return };
    let Some(button) = item.button(mtm) else { return };
    let target: objc2::rc::Retained<TrayClick> = unsafe { msg_send![TrayClick::alloc(mtm), init] };
    // SAFETY: `clicked:` takes the sender, as an action must.
    unsafe {
        button.setTarget(Some(&target));
        button.setAction(Some(sel!(clicked:)));
    }
    button.sendActionOn(NSEventMask::LeftMouseDown | NSEventMask::RightMouseDown);
    // The button holds its target weakly; keep this one for the app's life.
    std::mem::forget(target);
}
