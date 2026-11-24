// Narrow file-access door for the desktop shell, following the spike's
// save_manifest pattern: the frontend can only touch the filesystem
// through these three commands (a path + text we give it), never through
// a broad filesystem permission. No directory walking, no listing, no
// delete, no rename — if a feature seems to need another command, that
// is a scope question, not a new command.

/// Byte size of a file, used by the intake warning before a file is read.
/// Fast, so it stays on the main thread.
#[tauri::command]
fn stat_file(path: String) -> Result<u64, String> {
    std::fs::metadata(&path)
        .map(|m| m.len())
        .map_err(|e| e.to_string())
}

/// Read a whole file as UTF-8 text. Async + spawn_blocking: data and
/// project files can be megabytes, and a synchronous command would hold
/// the app's main thread (the window cannot even repaint). A decode
/// failure returns a readable error.
#[tauri::command]
async fn read_text_file(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::read_to_string(&path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Write text to a file. Fast, so it stays on the main thread like the
/// spike's save_manifest.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            stat_file,
            read_text_file,
            write_text_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
