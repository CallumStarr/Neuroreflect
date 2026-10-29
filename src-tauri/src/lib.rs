// The desktop shell around the NeuroReflect screens. The journal itself lives in
// the window's own storage (IndexedDB); this side only adds what a browser tab
// cannot do: provider requests without CORS limits (the HTTP plugin, scoped in
// capabilities/default.json), saving exports through the system save dialog,
// one running copy at a time, the window's size, reminders that arrive while the
// window is hidden in the system tray, starting at sign-in, and quick capture
// from anywhere.

#[cfg(desktop)]
mod desktop;

/// Saves a file where the person chooses, through the system save dialog: an
/// export, or a calendar file for their writing time. The window has no other
/// way to write files. Returns false if they cancel.
#[tauri::command]
async fn save_text_file(
    app: tauri::AppHandle,
    suggested_name: String,
    contents: String,
    filter_name: Option<String>,
    extensions: Option<Vec<String>>,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    let filter_name = filter_name.unwrap_or_else(|| "NeuroReflect export".to_string());
    let extensions = extensions.unwrap_or_else(|| vec!["json".to_string()]);
    // Only plain text files the app makes itself: exports and calendar files.
    if !extensions.iter().all(|e| e == "json" || e == "ics") {
        return Err("That kind of file can't be saved from NeuroReflect.".to_string());
    }
    let ext_refs: Vec<&str> = extensions.iter().map(String::as_str).collect();
    let title = if extensions.iter().any(|e| e == "ics") { "Save your writing time to a calendar file" } else { "Save your NeuroReflect export" };
    let picked = app
        .dialog()
        .file()
        .set_title(title)
        .set_file_name(&suggested_name)
        .add_filter(&filter_name, &ext_refs)
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
