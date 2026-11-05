use crate::{
    state::{trusted, AppState},
    update_backup,
};
use serde::Serialize;
use std::{
    io::Read,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct UpdateState {
    pending: Mutex<Option<Update>>,
    /// A package that was downloaded and passed signature verification, kept in memory until it is
    /// installed (on quit or "restart now") or replaced by a newer check. Nothing is written to disk.
    staged: Mutex<Option<(Update, Vec<u8>)>>,
    checking: AtomicBool,
    downloading: AtomicBool,
}
struct Reset<'a>(&'a AtomicBool);
impl Drop for Reset<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    version: String,
    notes: String,
}

/// Stage events let the UI say "已备份" or "正在安装" only after the native side reached that point.
fn progress(app: &AppHandle, stage: &str, message: &str) {
    let _ = app.emit_to(
        "main",
        "workbench:update-progress",
        serde_json::json!({ "stage": stage, "message": message }),
    );
}

#[tauri::command]
pub async fn check_update(
    window: WebviewWindow,
    app: AppHandle,
) -> Result<Option<UpdateInfo>, String> {
    trusted(&window)?;
    if cfg!(debug_assertions) {
        return Err("开发预览版不检查线上更新，请使用正式发行版。".into());
    }
    if !cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        return Err("此平台暂请从开源发行页更新。".into());
    }
    let state = app.state::<UpdateState>();
    if state.checking.swap(true, Ordering::SeqCst) {
        return Err("正在检查更新，请稍等。".into());
    }
    let _reset = Reset(&state.checking);
    let update = app
        .updater_builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "更新配置不可用，请从发行页下载。")?
        .check()
        .await
        .map_err(|_| "暂时无法获取更新，请稍后重试或查看发行页。")?;
    if let Some(value) = &update {
        validate_download(value)?;
    }
    let result = update.as_ref().map(|value| UpdateInfo {
        version: value.version.clone(),
        notes: value
            .body
            .clone()
            .unwrap_or_default()
            .chars()
            .take(4000)
            .collect(),
    });
    *state.pending.lock().map_err(|_| "无法读取更新状态。")? = update;
    Ok(result)
}

fn validate_download(update: &Update) -> Result<(), String> {
    let url = &update.download_url;
    let prefix = format!(
        "/corn12138/content-workbench/releases/download/v{}/",
        update.version
    );
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || !url.path().starts_with(&prefix)
        || !url.path().ends_with(".app.tar.gz")
    {
        return Err("更新包地址不属于官方发行页，已停止升级。".into());
    }
    Ok(())
}

fn download(app: &AppHandle, update: &Update) -> Result<Vec<u8>, String> {
    const LIMIT: u64 = 100 * 1024 * 1024;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(120))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let url = attempt.url();
            let host = url.host_str().unwrap_or_default();
            if attempt.previous().len() > 5
                || url.scheme() != "https"
                || !(host == "github.com" || host.ends_with(".githubusercontent.com"))
            {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|_| "无法建立更新连接。")?;
    let mut response = client
        .get(update.download_url.clone())
        .send()
        .map_err(|_| "更新下载失败，请稍后重试。")?
        .error_for_status()
        .map_err(|_| "更新包暂时不可用。")?;
    if response.content_length().is_some_and(|size| size > LIMIT) {
        return Err("更新包超过大小限制。".into());
    }
    let mut bytes = Vec::new();
    let mut buffer = [0; 64 * 1024];
    let mut reported = 0;
    loop {
        let read = response
            .read(&mut buffer)
            .map_err(|_| "更新下载中断，请重试。")?;
        if read == 0 {
            break;
        }
        if bytes.len() as u64 + read as u64 > LIMIT {
            return Err("更新包超过大小限制。".into());
        }
        bytes.extend_from_slice(&buffer[..read]);
        let mb = bytes.len() / (1024 * 1024);
        if mb > reported {
            progress(app, "download", &format!("正在下载更新… {mb} MB"));
            reported = mb;
        }
    }
    progress(app, "verify", "正在校验更新包签名…");
    update
        .verify(&bytes)
        .map_err(|_| "更新包签名或版本校验失败，原应用未修改。")?;
    Ok(bytes)
}

fn pending_update(app: &AppHandle, version: &str) -> Result<Update, String> {
    let update = app
        .state::<UpdateState>()
        .pending
        .lock()
        .map_err(|_| "无法读取更新状态。")?
        .clone()
        .filter(|item| item.version == version)
        .ok_or("请先重新检查更新。")?;
    validate_download(&update)?;
    Ok(update)
}

/// Downloads and verifies the update in the background without touching the library or the
/// installed app. Installing stays a separate step (on quit or when the user restarts).
#[tauri::command]
pub async fn download_update(
    window: WebviewWindow,
    app: AppHandle,
    version: String,
) -> Result<(), String> {
    trusted(&window)?;
    let update = pending_update(&app, &version)?;
    let state = app.state::<UpdateState>();
    if state
        .staged
        .lock()
        .map_err(|_| "无法读取更新状态。")?
        .as_ref()
        .is_some_and(|(staged, _)| staged.version == version)
    {
        return Ok(());
    }
    if state.downloading.swap(true, Ordering::SeqCst) {
        return Err("正在下载更新，请稍等。".into());
    }
    let handle = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _reset = Reset(&handle.state::<UpdateState>().downloading);
        let bytes = download(&handle, &update)?;
        *handle
            .state::<UpdateState>()
            .staged
            .lock()
            .map_err(|_| "无法保存下载的更新。")? = Some((update, bytes));
        Ok(())
    })
    .await
    .map_err(|_| "更新下载未完成。".to_string())?;
    if result.is_err() {
        state.downloading.store(false, Ordering::SeqCst);
    }
    result
}

/// Backs up the library and the current app, then installs. Shared by "restart now" and install on
/// quit; the caller has already set the `updating` fence.
fn run_install(handle: &AppHandle, update: Update, restart: bool) -> Result<(), String> {
    let bundle = update_backup::app_bundle(&std::env::current_exe().map_err(|_| "无法定位应用。")?)?;
    let staged = handle
        .state::<UpdateState>()
        .staged
        .lock()
        .map_err(|_| "无法读取更新状态。")?
        .take()
        .filter(|(item, _)| item.version == update.version);
    let bytes = match staged {
        Some((_, bytes)) => {
            progress(handle, "verify", "已下载并通过签名校验。");
            bytes
        }
        None => {
            progress(handle, "download", "正在下载更新…");
            download(handle, &update)?
        }
    };
    progress(handle, "backup", "正在备份资料和旧版应用…");
    let state = handle.state::<AppState>();
    let store = state
        .store
        .as_ref()
        .ok_or("资料不可用，已取消升级。")?
        .lock()
        .map_err(|_| "资料正忙，已取消升级。")?;
    update_backup::prepare(
        &state.directory,
        &bundle,
        &store,
        &handle.package_info().version.to_string(),
    )?;
    progress(handle, "backedUp", "已建立升级备份。");
    progress(
        handle,
        "install",
        if restart { "正在安装，完成后将重新打开…" } else { "正在安装，完成后退出…" },
    );
    update
        .install(bytes)
        .map_err(|_| "安装未完成，升级前副本已保留；请查看升级备份。")?;
    progress(
        handle,
        "restart",
        if restart { "安装完成，正在重新打开…" } else { "安装完成，正在退出…" },
    );
    state.can_close.store(true, Ordering::SeqCst);
    drop(store);
    if restart {
        handle.restart();
    }
    handle.exit(0);
    Ok(())
}

#[tauri::command]
pub async fn install_update(
    window: WebviewWindow,
    app: AppHandle,
    version: String,
) -> Result<(), String> {
    trusted(&window)?;
    let state = app.state::<AppState>();
    if state.updating.swap(true, Ordering::SeqCst) {
        return Err("更新正在进行。".into());
    }
    // All store writes and close requests are fenced until the replacement either succeeds or fails.
    let _reset = Reset(&state.updating);
    if state.close_pending.load(Ordering::SeqCst) {
        return Err("应用正在关闭，请重新打开后升级。".into());
    }
    let update = pending_update(&app, &version)?;
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || run_install(&handle, update, true))
        .await
        .map_err(|_| "升级未完成，请查看升级备份后重试。".to_string())?
}

/// Install on quit: called by the window after all edits were saved for this close attempt. On
/// success the app exits with the new version installed; on failure the quit is cancelled so the
/// user sees what happened, and the next quit closes normally.
#[tauri::command]
pub async fn finish_close_with_update(
    window: WebviewWindow,
    app: AppHandle,
    attempt: u64,
    version: String,
) -> Result<(), String> {
    trusted(&window)?;
    let state = app.state::<AppState>();
    if !state.close_pending.load(Ordering::SeqCst)
        || state.close_attempt.load(Ordering::SeqCst) != attempt
    {
        return Ok(());
    }
    if state.updating.swap(true, Ordering::SeqCst) {
        return Err("更新正在进行。".into());
    }
    let _reset = Reset(&state.updating);
    let result = match pending_update(&app, &version) {
        Ok(update) => {
            let handle = app.clone();
            tauri::async_runtime::spawn_blocking(move || run_install(&handle, update, false))
                .await
                .map_err(|_| "升级未完成，请查看升级备份后重试。".to_string())
                .and_then(|r| r)
        }
        Err(error) => Err(error),
    };
    if result.is_err() {
        state.close_pending.store(false, Ordering::SeqCst);
    }
    result
}

#[tauri::command]
pub fn open_update_backups(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    trusted(&window)?;
    let root = app.state::<AppState>().directory.join("update-backups");
    if !root.is_dir() {
        return Err("还没有升级备份。每次安装更新前会自动建立。".into());
    }
    app.opener()
        .open_path(root.to_string_lossy(), None::<&str>)
        .map_err(|_| "备份文件夹未能打开。".into())
}
