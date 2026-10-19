// The desktop shell around the NeuroReflect screens. The journal itself lives in
// the window's own storage (IndexedDB); this side only adds what a browser tab
// cannot do safely: provider requests without CORS limits (the HTTP plugin, scoped
// in capabilities/default.json), saving exports through the system save dialog,
// one running copy at a time, and remembering the window's size.

/// Saves an export where the person chooses, through the system save dialog.
/// The window has no other way to write files. Returns false if they cancel.
#[tauri::command]
async fn save_text_file(app: tauri::AppHandle, suggested_name: String, contents: String) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .set_title("Save your NeuroReflect export")
        .set_file_name(&suggested_name)
        .add_filter("NeuroReflect export", &["json"])
        .blocking_save_file();
    let Some(picked) = picked else { return Ok(false) };
    let path = picked.into_path().map_err(|e| format!("That location can't be used: {e}"))?;
    std::fs::write(&path, contents).map_err(|e| format!("The file could not be saved: {e}"))?;
    Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        use tauri::Manager;
        // Must be registered first. Opening the app again focuses the window that
        // is already open, so only one copy of the journal is ever unlocked.
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }))
            .plugin(tauri_plugin_window_state::Builder::default().build());
    }

    builder
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_text_file])
        .run(tauri::generate_context!())
        .expect("NeuroReflect could not start");
}
