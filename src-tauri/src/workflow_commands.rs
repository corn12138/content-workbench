use crate::{
    files::{atomic_write, read_bounded, safe_filename},
    local_settings::{self, BackupRecord},
    opml,
    state::{trusted, AppState},
    store::{
        archive::MAX_ARCHIVE,
        models::{Draft, Publication},
        workflow_models::{Feedback, FeedbackInput, Preparation, PreparationInput, Workflow},
        BackupSummary, ExportInput, WorkbenchStore,
    },
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{path::PathBuf, sync::atomic::Ordering, sync::Mutex};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

/// The file chosen during restore preflight. Confirmation re-reads it and compares the digest, so a
/// file replaced after the preview cannot be restored under the earlier summary.
#[derive(Default)]
pub struct RestoreState {
    pending: Mutex<Option<PendingRestore>>,
}
struct PendingRestore {
    token: String,
    path: PathBuf,
    sha256: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeResult {
    draft: Draft,
    duplicate: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReceipt {
    filename: String,
    bundled: bool,
    images: usize,
    missing: usize,
    remote: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupReceipt {
    filename: String,
    size: u64,
    saved_at: String,
    exists: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupPreview {
    token: String,
    filename: String,
    size: u64,
    summary: BackupSummary,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpmlPreview {
    filename: String,
    entries: Vec<opml::OpmlEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileReceipt {
    filename: String,
    count: usize,
}

fn filename_of(path: &std::path::Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

#[tauri::command]
pub fn workflow(window: WebviewWindow, state: State<AppState>) -> Result<Workflow, String> {
    trusted(&window)?;
    state.lock()?.workflow()
}

#[tauri::command]
pub fn save_preparation(
    window: WebviewWindow,
    state: State<AppState>,
    input: PreparationInput,
) -> Result<Preparation, String> {
    trusted(&window)?;
    state.lock()?.save_preparation(input)
}

#[tauri::command]
pub fn clear_preparation(
    window: WebviewWindow,
    state: State<AppState>,
    draft_id: String,
    platform: String,
) -> Result<(), String> {
    trusted(&window)?;
    state.lock()?.clear_preparation(&draft_id, &platform)
}

#[tauri::command]
pub fn update_publication(
    window: WebviewWindow,
    state: State<AppState>,
    id: String,
    url: String,
) -> Result<Publication, String> {
    trusted(&window)?;
    state.lock()?.update_publication(&id, &url)
}

#[tauri::command]
pub fn remove_publication(
    window: WebviewWindow,
    state: State<AppState>,
    id: String,
) -> Result<(), String> {
    trusted(&window)?;
    state.lock()?.remove_publication(&id)
}

#[tauri::command]
pub fn save_feedback(
    window: WebviewWindow,
    state: State<AppState>,
    input: FeedbackInput,
) -> Result<Feedback, String> {
    trusted(&window)?;
    state.lock()?.save_feedback(input)
}

#[tauri::command]
pub fn delete_feedback(
    window: WebviewWindow,
    state: State<AppState>,
    id: String,
) -> Result<(), String> {
    trusted(&window)?;
    state.lock()?.delete_feedback(&id)
}

#[tauri::command]
pub fn compose_notes(
    window: WebviewWindow,
    state: State<AppState>,
    ids: Vec<String>,
) -> Result<ComposeResult, String> {
    trusted(&window)?;
    let (draft, duplicate) = state.lock()?.compose_notes(&ids)?;
    Ok(ComposeResult { draft, duplicate })
}

/// Saves a copy of the editor's current content, which may not be in the database yet.
/// It never changes the stored draft or its save state.
#[tauri::command]
pub async fn export_current(
    window: WebviewWindow,
    app: AppHandle,
    input: ExportInput,
) -> Result<Option<ExportReceipt>, String> {
    trusted(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let exported = app.state::<AppState>().lock()?.export_current(&input)?;
        let extension = if exported.bundled { "zip" } else { "md" };
        let selected = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("另存当前内容")
            .set_file_name(format!(
                "{}.{extension}",
                safe_filename(&input.title, "未命名稿件")
            ))
            .add_filter(
                if exported.bundled {
                    "文章包（Markdown 与图片）"
                } else {
                    "Markdown"
                },
                &[extension],
            )
            .blocking_save_file();
        let Some(selected) = selected else {
            return Ok(None);
        };
        let path = selected.into_path().map_err(|e| e.to_string())?;
        atomic_write(&path, &exported.bytes)?;
        Ok(Some(ExportReceipt {
            filename: filename_of(&path),
            bundled: exported.bundled,
            images: exported.images,
            missing: exported.missing,
            remote: exported.remote,
        }))
    })
    .await
    .map_err(|_| "导出未完成，编辑区内容仍保留。".to_string())?
}

#[tauri::command]
pub async fn opml_preview(
    window: WebviewWindow,
    app: AppHandle,
) -> Result<Option<OpmlPreview>, String> {
    trusted(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("导入订阅列表")
            .add_filter("OPML 订阅列表", &["opml", "xml"])
            .blocking_pick_file();
        let Some(selected) = selected else {
            return Ok(None);
        };
        let path = selected.into_path().map_err(|e| e.to_string())?;
        let bytes = read_bounded(&path, opml::MAX_OPML_BYTES)
            .map_err(|_| "订阅列表文件超过 1 MB 或无法读取。".to_string())?;
        let found = opml::parse(&bytes)?;
        let feeds = app.state::<AppState>().lock()?.library()?.feeds;
        Ok(Some(OpmlPreview {
            filename: filename_of(&path),
            entries: opml::preview(found, &feeds),
        }))
    })
    .await
    .map_err(|_| "读取订阅列表未完成。".to_string())?
}

#[tauri::command]
pub async fn export_opml(
    window: WebviewWindow,
    app: AppHandle,
) -> Result<Option<FileReceipt>, String> {
    trusted(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let feeds = app.state::<AppState>().lock()?.library()?.feeds;
        let count = feeds.iter().filter(|f| f.enabled).count();
        if count == 0 {
            return Err("还没有订阅，暂无可导出的列表。".into());
        }
        let selected = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("导出订阅列表")
            .set_file_name("内容工作台订阅.opml")
            .add_filter("OPML 订阅列表", &["opml"])
            .blocking_save_file();
        let Some(selected) = selected else {
            return Ok(None);
        };
        let path = selected.into_path().map_err(|e| e.to_string())?;
        atomic_write(&path, opml::export(&feeds, &crate::store::now()).as_bytes())?;
        Ok(Some(FileReceipt {
            filename: filename_of(&path),
            count,
        }))
    })
    .await
    .map_err(|_| "导出订阅列表未完成。".to_string())?
}

/// Writes a full backup and returns a receipt only after the file is durable on disk.
#[tauri::command]
pub async fn create_backup(
    window: WebviewWindow,
    app: AppHandle,
) -> Result<Option<BackupReceipt>, String> {
    trusted(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let date = chrono::Local::now().format("%Y-%m-%d").to_string();
        let selected = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("备份全部资料")
            .set_file_name(format!("内容工作台备份-{date}.cwb"))
            .add_filter("工作台备份", &["cwb"])
            .blocking_save_file();
        let Some(selected) = selected else {
            return Ok(None);
        };
        let path = selected.into_path().map_err(|e| e.to_string())?;
        let state = app.state::<AppState>();
        let bytes = state.lock()?.export_full_backup()?;
        atomic_write(&path, &bytes)?;
        let size = std::fs::metadata(&path)
            .map_err(|_| "备份文件已写入，但无法读取文件信息。")?
            .len();
        let record = BackupRecord {
            path: path.to_string_lossy().into_owned(),
            filename: filename_of(&path),
            size,
            saved_at: crate::store::now(),
        };
        // The backup itself is complete; failing to remember its location only affects the receipt.
        let _ = local_settings::update(&state.directory, |s| s.last_backup = Some(record.clone()));
        Ok(Some(BackupReceipt {
            filename: record.filename,
            size,
            saved_at: record.saved_at,
            exists: true,
        }))
    })
    .await
    .map_err(|_| "备份未完成。".to_string())?
}

#[tauri::command]
pub fn last_backup(
    window: WebviewWindow,
    state: State<AppState>,
) -> Result<Option<BackupReceipt>, String> {
    trusted(&window)?;
    Ok(local_settings::read(&state.directory)
        .last_backup
        .map(|record| BackupReceipt {
            exists: std::path::Path::new(&record.path).is_file(),
            filename: record.filename,
            size: record.size,
            saved_at: record.saved_at,
        }))
}

#[tauri::command]
pub fn reveal_backup(
    window: WebviewWindow,
    app: AppHandle,
    state: State<AppState>,
) -> Result<(), String> {
    trusted(&window)?;
    let record = local_settings::read(&state.directory)
        .last_backup
        .ok_or("还没有备份记录。")?;
    let path = PathBuf::from(&record.path);
    if !path.is_file() {
        return Err("找不到上次的备份文件，它可能已被移动或删除。需要时请重新备份。".into());
    }
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|_| "无法在访达中显示备份文件。".into())
}

/// Restore preflight: choose and fully validate a backup without changing any data.
#[tauri::command]
pub async fn inspect_backup(
    window: WebviewWindow,
    app: AppHandle,
) -> Result<Option<BackupPreview>, String> {
    trusted(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("选择要恢复的备份")
            .add_filter("工作台备份", &["cwb", "json"])
            .blocking_pick_file();
        let Some(selected) = selected else {
            return Ok(None);
        };
        let path = selected.into_path().map_err(|e| e.to_string())?;
        let bytes = read_bounded(&path, MAX_ARCHIVE as u64)?;
        let validated = WorkbenchStore::inspect_backup(&bytes)?;
        let token = uuid::Uuid::new_v4().to_string();
        *app.state::<RestoreState>()
            .pending
            .lock()
            .map_err(|_| "无法记录所选备份。")? = Some(PendingRestore {
            token: token.clone(),
            path: path.clone(),
            sha256: format!("{:x}", Sha256::digest(&bytes)),
        });
        Ok(Some(BackupPreview {
            token,
            filename: filename_of(&path),
            size: bytes.len() as u64,
            summary: validated.summary,
        }))
    })
    .await
    .map_err(|_| "读取备份未完成，现有资料没有改动。".to_string())?
}

#[tauri::command]
pub fn cancel_restore(window: WebviewWindow, state: State<RestoreState>) -> Result<(), String> {
    trusted(&window)?;
    *state.pending.lock().map_err(|_| "无法取消。")? = None;
    Ok(())
}

#[tauri::command]
pub async fn restore_inspected(
    window: WebviewWindow,
    app: AppHandle,
    token: String,
) -> Result<bool, String> {
    trusted(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let pending = app
            .state::<RestoreState>()
            .pending
            .lock()
            .map_err(|_| "无法读取所选备份。")?
            .take()
            .filter(|p| p.token == token)
            .ok_or("请重新选择备份文件。")?;
        let bytes = read_bounded(&pending.path, MAX_ARCHIVE as u64)
            .map_err(|_| "找不到所选备份文件，现有资料没有改动。".to_string())?;
        if format!("{:x}", Sha256::digest(&bytes)) != pending.sha256 {
            return Err("备份文件在确认前发生了变化，未恢复。请重新选择。".into());
        }
        let validated = WorkbenchStore::inspect_backup(&bytes)?;
        let state = app.state::<AppState>();
        let mut store = state.lock()?;
        store.restore_validated(validated)?;
        state.library_epoch.fetch_add(1, Ordering::SeqCst);
        Ok(true)
    })
    .await
    .map_err(|_| "恢复未完成，现有资料没有被替换。".to_string())?
}

/// Re-opens the upload copies made by image preparation for this draft.
#[tauri::command]
pub fn open_prepared_images(
    window: WebviewWindow,
    app: AppHandle,
    state: State<AppState>,
    draft_id: String,
) -> Result<(), String> {
    trusted(&window)?;
    crate::store::assert_id(&draft_id)?;
    let folder = state.directory.join("prepared-images").join(&draft_id);
    if !folder.is_dir() {
        return Err("找不到图片文件夹，请重新准备图片。".into());
    }
    app.opener()
        .open_path(folder.to_string_lossy(), None::<&str>)
        .map_err(|_| "图片文件夹未能打开。".into())
}
