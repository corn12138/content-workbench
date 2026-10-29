use crate::{
    state::{trusted, AppState},
    store::models::ImportResult,
};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::Path,
};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

fn bounded_text(path: &Path, limit: u64) -> Result<String, String> {
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("文件过大，未修改当前资料。".into());
    }
    String::from_utf8(bytes).map_err(|_| "请选择 UTF-8 编码的文件。".into())
}

fn atomic_write(path: &Path, body: &str) -> Result<(), String> {
    // A sibling temporary file keeps an interrupted export from truncating a previous backup.
    let temporary = path.with_file_name(format!(".workbench-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary).map_err(|e| e.to_string())?;
        file.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        fs::rename(&temporary, path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

#[tauri::command]
pub async fn import_markdown(
    window: WebviewWindow,
    app: AppHandle,
) -> Result<Option<ImportResult>, String> {
    trusted(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("导入文章")
            .add_filter("Markdown", &["md", "markdown"])
            .blocking_pick_file();
        let Some(selected) = selected else {
            return Ok(None);
        };
        let path = selected.into_path().map_err(|e| e.to_string())?;
        let text = bounded_text(&path, 2_000_000)?;
        let state = app.state::<AppState>();
        let result = state.lock()?.import_markdown(
            path.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .as_ref(),
            &text,
        )?;
        Ok(Some(result))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn export_draft(
    window: WebviewWindow,
    app: AppHandle,
    id: String,
) -> Result<bool, String> {
    trusted(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let draft = app
            .state::<AppState>()
            .lock()?
            .snapshot()?
            .drafts
            .into_iter()
            .find(|item| item.id == id)
            .ok_or("找不到这篇稿件。")?;
        let filename: String = draft
            .title
            .chars()
            .take(100)
            .map(|c| {
                if c.is_control() || "/\\:*?\"<>|".contains(c) {
                    '-'
                } else {
                    c
                }
            })
            .collect();
        let selected = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("导出 Markdown")
            .set_file_name(format!(
                "{}.md",
                if filename.is_empty() {
                    "未命名稿件"
                } else {
                    &filename
                }
            ))
            .add_filter("Markdown", &["md"])
            .blocking_save_file();
        let Some(selected) = selected else {
            return Ok(false);
        };
        atomic_write(
            &selected.into_path().map_err(|e| e.to_string())?,
            &draft.body,
        )?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn backup(window: WebviewWindow, app: AppHandle) -> Result<bool, String> {
    trusted(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("备份全部资料")
            .set_file_name("内容工作台备份.json")
            .add_filter("工作台备份", &["json"])
            .blocking_save_file();
        let Some(selected) = selected else {
            return Ok(false);
        };
        let json = app.state::<AppState>().lock()?.export_backup()?;
        atomic_write(&selected.into_path().map_err(|e| e.to_string())?, &json)?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn restore_backup(window: WebviewWindow, app: AppHandle) -> Result<bool, String> {
    trusted(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("恢复资料")
            .add_filter("工作台备份", &["json"])
            .blocking_pick_file();
        let Some(selected) = selected else {
            return Ok(false);
        };
        let json = bounded_text(
            &selected.into_path().map_err(|e| e.to_string())?,
            25_000_000,
        )?;
        let confirmed = app
            .dialog()
            .message("当前资料会先自动备份。线上文章不会被修改。")
            .title("用这份备份恢复本地资料？")
            .parent(&window)
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "恢复".into(),
                "取消".into(),
            ))
            .blocking_show();
        if !confirmed {
            return Ok(false);
        }
        app.state::<AppState>().lock()?.restore_backup(&json)?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}
