use crate::store::WorkbenchStore;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64},
        Mutex, MutexGuard,
    },
};
use tauri::WebviewWindow;

pub struct AppState {
    pub store: Option<Mutex<WorkbenchStore>>,
    pub startup_error: Option<String>,
    pub directory: PathBuf,
    pub can_close: AtomicBool,
    pub close_pending: AtomicBool,
    pub close_attempt: AtomicU64,
    pub library_epoch: AtomicU64,
    pub updating: AtomicBool,
}

pub fn trusted(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("无法从此页面执行本地操作。".into());
    }
    Ok(())
}

impl AppState {
    pub fn lock(&self) -> Result<MutexGuard<'_, WorkbenchStore>, String> {
        let store = self
            .store
            .as_ref()
            .ok_or_else(|| {
                self.startup_error
                    .clone()
                    .unwrap_or_else(|| "资料暂时无法访问。".into())
            })?
            .lock()
            .map_err(|_| "资料暂时无法访问，请重新打开应用。".to_string())?;
        if self.updating.load(std::sync::atomic::Ordering::SeqCst) {
            return Err("正在升级，请等待应用重新打开。".into());
        }
        Ok(store)
    }
}
