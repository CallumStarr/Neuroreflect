// The desktop shell around the NeuroReflect screens. The journal itself lives in
// the window's own storage (IndexedDB); this side only adds what a browser tab
// cannot do: provider requests without CORS limits (the HTTP plugin, scoped in
// capabilities/default.json), saving exports through the system save dialog,
// one running copy at a time, the window's size, reminders that arrive while the
// window is hidden in the system tray, starting at sign-in, and quick capture
// from anywhere.

#[cfg(desktop)]
mod desktop;

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
        builder = desktop::install(builder);
    }

    builder
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            save_text_file,
            #[cfg(desktop)]
            desktop::set_reminders,
            #[cfg(desktop)]
            desktop::take_fired_reminders,
            #[cfg(desktop)]
            desktop::set_desktop_prefs,
            #[cfg(desktop)]
            desktop::quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("NeuroReflect could not start");
}
