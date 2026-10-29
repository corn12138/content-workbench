use crate::{
    state::{trusted, AppState},
    store::models::*,
};
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub fn snapshot(window: WebviewWindow, state: State<AppState>) -> Result<Snapshot, String> {
    trusted(&window)?;
    state.lock()?.snapshot()
}
#[tauri::command]
pub fn save_draft(
    window: WebviewWindow,
    state: State<AppState>,
    input: DraftInput,
) -> Result<Draft, String> {
    trusted(&window)?;
    state.lock()?.save_draft(input)
}
#[tauri::command]
pub fn archive_draft(
    window: WebviewWindow,
    state: State<AppState>,
    id: String,
    archived: bool,
) -> Result<(), String> {
    trusted(&window)?;
    state.lock()?.archive_draft(&id, archived)
}
#[tauri::command]
pub fn revisions(
    window: WebviewWindow,
    state: State<AppState>,
    id: String,
) -> Result<Vec<Revision>, String> {
    trusted(&window)?;
    state.lock()?.revisions(&id)
}
#[tauri::command]
pub fn restore_revision(
    window: WebviewWindow,
    state: State<AppState>,
    id: String,
    revision: i64,
    expected_revision: i64,
) -> Result<Draft, String> {
    trusted(&window)?;
    state
        .lock()?
        .restore_revision(&id, revision, expected_revision)
}
#[tauri::command]
pub fn record_publication(
    window: WebviewWindow,
    state: State<AppState>,
    draft_id: String,
    revision: i64,
    url: String,
) -> Result<Publication, String> {
    trusted(&window)?;
    state.lock()?.record_publication(&draft_id, revision, &url)
}
#[tauri::command]
pub fn save_reading(
    window: WebviewWindow,
    state: State<AppState>,
    input: ReadingInput,
) -> Result<Reading, String> {
    trusted(&window)?;
    state.lock()?.save_reading(input)
}
#[tauri::command]
pub fn delete_reading(
    window: WebviewWindow,
    state: State<AppState>,
    id: String,
) -> Result<(), String> {
    trusted(&window)?;
    state.lock()?.delete_reading(&id)
}
#[tauri::command]
pub fn reading_to_draft(
    window: WebviewWindow,
    state: State<AppState>,
    id: String,
) -> Result<Draft, String> {
    trusted(&window)?;
    state.lock()?.reading_to_draft(&id)
}
#[tauri::command]
pub fn copy_text(window: WebviewWindow, app: AppHandle, text: String) -> Result<(), String> {
    trusted(&window)?;
    if text.encode_utf16().count() > 2_000_000 {
        return Err("内容过长，无法复制。".into());
    }
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn open_external(window: WebviewWindow, app: AppHandle, url: String) -> Result<(), String> {
    trusted(&window)?;
    let parsed = url::Url::parse(&url).map_err(|_| "链接格式不正确。")?;
    if url.len() > 2048
        || !matches!(parsed.scheme(), "http" | "https")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("只能打开普通网页链接。".into());
    }
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn info(
    window: WebviewWindow,
    app: AppHandle,
    state: State<AppState>,
) -> Result<serde_json::Value, String> {
    trusted(&window)?;
    Ok(
        serde_json::json!({ "version":app.package_info().version.to_string(), "dataPath":state.directory,
        "platform":std::env::consts::OS, "mode":"desktop" }),
    )
}

#[tauri::command]
pub fn asset_data(
    window: WebviewWindow,
    state: State<AppState>,
    name: String,
) -> Result<String, String> {
    trusted(&window)?;
    state.lock()?.asset_data_url(&name)
}
