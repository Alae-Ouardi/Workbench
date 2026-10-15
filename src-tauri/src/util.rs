//! Small helpers shared by the Tauri command modules.

/// Run blocking work (network, subprocess, database) off the async runtime.
pub async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("background task failed: {e}"))?
}

/// Make sure the login-shell environment is captured, off the main thread
/// (it is read once at launch and can take a few seconds).
pub async fn ensure_env() -> Result<(), String> {
    blocking(|| {
        crate::env::shell_env();
        Ok(())
    })
    .await
}

/// Ask where to save (native dialog, in Rust) and write the text there.
/// The frontend never chooses the path itself. Returns false when cancelled.
#[tauri::command]
pub async fn save_text_file(app: tauri::AppHandle, default_name: String, contents: String) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    blocking(move || {
        let name: String = default_name.chars().filter(|c| !matches!(c, '/' | '\\' | ':')).collect();
        let Some(picked) = app.dialog().file().set_file_name(&name).blocking_save_file() else {
            return Ok(false);
        };
        let path = picked.into_path().map_err(|e| e.to_string())?;
        std::fs::write(&path, contents).map_err(|e| format!("could not save {}: {e}", path.display()))?;
        Ok(true)
    })
    .await
}
