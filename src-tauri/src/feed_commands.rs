use crate::{
    feed_fetch::{self, Fetched},
    state::{trusted, AppState},
    store::feed_models::{Feed, Library},
};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager, State, WebviewWindow};

#[tauri::command]
pub fn library(window: WebviewWindow, state: State<AppState>) -> Result<Library, String> {
    trusted(&window)?;
    state.lock()?.library()
}

#[tauri::command]
pub fn unsubscribe(
    window: WebviewWindow,
    state: State<AppState>,
    id: String,
) -> Result<(), String> {
    trusted(&window)?;
    state.lock()?.unsubscribe(&id)
}

#[tauri::command]
pub async fn add_feed(window: WebviewWindow, app: AppHandle, url: String) -> Result<Feed, String> {
    trusted(&window)?;
    let url = feed_fetch::feed_url(&url)?.to_string();
    let epoch = app.state::<AppState>().library_epoch.load(Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || {
        let fetched = feed_fetch::fetch(&url, None)?;
        let state = app.state::<AppState>();
        let mut store = state.lock()?;
        if state.library_epoch.load(Ordering::SeqCst) != epoch {
            return Err("资料已恢复，请重新添加订阅。".into());
        }
        match fetched {
            Fetched::Content { parsed, .. } => store.add_feed(&url, parsed),
            Fetched::NotModified => Err("订阅网站没有返回内容，请重试。".into()),
        }
    })
    .await
    .map_err(|_| "添加订阅未完成。".to_string())?
}

#[tauri::command]
pub async fn refresh_feed(
    window: WebviewWindow,
    app: AppHandle,
    id: String,
) -> Result<Feed, String> {
    trusted(&window)?;
    let state = app.state::<AppState>();
    let (previous, epoch) = {
        let store = state.lock()?;
        (store.feed(&id)?, state.library_epoch.load(Ordering::SeqCst))
    };
    if !previous.enabled {
        return Err("订阅已取消。".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let fetched = feed_fetch::fetch(&previous.url, Some(&previous));
        let state = app.state::<AppState>();
        let mut store = state.lock()?;
        if state.library_epoch.load(Ordering::SeqCst) != epoch {
            return Err("资料已恢复，本次更新已取消。".into());
        }
        match fetched {
            Ok(Fetched::NotModified) => store.feed_status(&previous, None),
            Ok(Fetched::Content {
                parsed,
                etag,
                last_modified,
            }) => store.apply_feed(&previous, parsed, etag, last_modified),
            Err(error) => store.feed_status(&previous, Some(error)),
        }
    })
    .await
    .map_err(|_| "订阅更新未完成。".to_string())?
}
