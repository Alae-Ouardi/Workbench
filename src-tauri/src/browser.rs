//! Browser panes: real web views placed inside the main window, over the area
//! of a pane in the Terminal workspace. The frontend reports each pane's
//! bounds; navigation and titles are reported back as `browser-state` events.
//!
//! Only http(s) and about:blank pages may load. In particular the app's own
//! origin (tauri://…) is refused, so a web page can never gain access to the
//! app's commands.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;
use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, Url, Webview, WebviewUrl};

#[derive(Default)]
pub struct Browsers {
    /// Pane id → its web view.
    views: Mutex<HashMap<String, Webview>>,
    /// Every create/move/close runs one at a time, in arrival order, so
    /// overlapping requests for a pane can never create two views.
    ops: tauri::async_runtime::Mutex<()>,
}

#[derive(Debug, Clone, Serialize)]
struct BrowserState {
    pane_id: String,
    url: String,
    title: Option<String>,
    loading: Option<bool>,
}

/// Pages a browser pane may show.
pub fn allowed(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https") || url.as_str() == "about:blank"
}

/// Parse what was typed in the address bar.
fn parse(input: &str) -> Result<Url, String> {
    let url = Url::parse(input.trim()).map_err(|_| format!("'{input}' is not a web address."))?;
    if !allowed(&url) {
        return Err("Only http and https pages can be opened here.".into());
    }
    Ok(url)
}

/// A window label made from the pane id (labels allow letters, digits, - and _).
fn label_for(pane_id: &str) -> String {
    let clean: String = pane_id.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' }).collect();
    format!("browser-{clean}")
}

fn emit(app: &AppHandle, pane_id: &str, url: &Url, title: Option<String>, loading: Option<bool>) {
    let _ = app.emit_to(
        "main",
        "browser-state",
        BrowserState { pane_id: pane_id.to_string(), url: url.to_string(), title, loading },
    );
}

fn lock(b: &Browsers) -> std::sync::MutexGuard<'_, HashMap<String, Webview>> {
    b.views.lock().unwrap_or_else(|e| e.into_inner())
}

fn place(view: &Webview, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    view.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    view.set_size(LogicalSize::new(width.max(1.0), height.max(1.0))).map_err(|e| e.to_string())
}

fn build(app: &AppHandle, pane_id: &str, start: Url) -> WebviewBuilder<tauri::Wry> {
    let (nav_app, load_app, title_app, open_app) = (app.clone(), app.clone(), app.clone(), app.clone());
    let (nav_id, load_id, title_id, open_id) = (pane_id.to_string(), pane_id.to_string(), pane_id.to_string(), pane_id.to_string());
    WebviewBuilder::new(label_for(pane_id), WebviewUrl::External(start))
        .on_navigation(move |url| {
            let ok = allowed(url);
            if ok {
                emit(&nav_app, &nav_id, url, None, Some(true));
            }
            ok
        })
        .on_page_load(move |_view, payload| {
            let loading = matches!(payload.event(), PageLoadEvent::Started);
            emit(&load_app, &load_id, payload.url(), None, Some(loading));
        })
        .on_document_title_changed(move |view, title| {
            if let Ok(url) = view.url() {
                emit(&title_app, &title_id, &url, Some(title), None);
            }
        })
        // target=_blank and window.open: stay in this pane.
        .on_new_window(move |url, _features| {
            if allowed(&url) {
                if let Some(view) = open_app.get_webview(&label_for(&open_id)) {
                    let _ = view.navigate(url);
                }
            }
            NewWindowResponse::Deny
        })
}

/// Make a pane's web view match what the pane wants: shown at these bounds
/// (created on first need, loading `url`), hidden, or — with an empty `url` —
/// gone. Called repeatedly by the pane; idempotent.
#[tauri::command]
pub async fn browser_sync(
    app: AppHandle,
    browsers: State<'_, Browsers>,
    pane_id: String,
    url: String,
    visible: bool,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let _one_at_a_time = browsers.ops.lock().await;
    let existing = lock(&browsers).get(&pane_id).cloned();
    if url.trim().is_empty() {
        if let Some(view) = existing {
            lock(&browsers).remove(&pane_id);
            view.close().map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    match existing {
        Some(view) if visible => {
            place(&view, x, y, width, height)?;
            view.show().map_err(|e| e.to_string())
        }
        Some(view) => view.hide().map_err(|e| e.to_string()),
        // Not created yet and not wanted on screen: nothing to do.
        None if !visible => Ok(()),
        None => {
            let start = parse(&url)?;
            let window = app.get_window("main").ok_or("The main window is gone.")?;
            let view = window
                .add_child(build(&app, &pane_id, start), LogicalPosition::new(x, y), LogicalSize::new(width.max(1.0), height.max(1.0)))
                .map_err(|e| e.to_string())?;
            lock(&browsers).insert(pane_id, view);
            Ok(())
        }
    }
}

#[tauri::command]
pub async fn browser_navigate(browsers: State<'_, Browsers>, pane_id: String, url: String) -> Result<(), String> {
    let url = parse(&url)?;
    let view = lock(&browsers).get(&pane_id).cloned().ok_or("This browser pane isn't open.")?;
    view.navigate(url).map_err(|e| e.to_string())
}

/// back, forward or reload.
#[tauri::command]
pub async fn browser_go(browsers: State<'_, Browsers>, pane_id: String, action: String) -> Result<(), String> {
    let view = lock(&browsers).get(&pane_id).cloned().ok_or("This browser pane isn't open.")?;
    match action.as_str() {
        "back" => view.eval("history.back()"),
        "forward" => view.eval("history.forward()"),
        "reload" => view.reload(),
        other => return Err(format!("Unknown browser action {other}.")),
    }
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_close(browsers: State<'_, Browsers>, pane_id: String) -> Result<(), String> {
    let _one_at_a_time = browsers.ops.lock().await;
    let view = lock(&browsers).remove(&pane_id);
    if let Some(view) = view {
        view.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_web_pages_may_load() {
        for ok in ["https://github.com", "http://localhost:3000/app", "about:blank"] {
            assert!(parse(ok).is_ok(), "{ok}");
        }
        for bad in ["tauri://localhost/index.html", "file:///etc/passwd", "javascript:alert(1)", "ipc://localhost", "not a url"] {
            assert!(parse(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn labels_are_valid() {
        assert_eq!(label_for("p-mv87db55-1"), "browser-p-mv87db55-1");
        assert_eq!(label_for("a/b c"), "browser-a_b_c");
    }
}
