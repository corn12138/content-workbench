use crate::{
    files::atomic_write,
    image_preview::fetch_asset,
    state::{trusted, AppState},
    store::{
        assets::{Asset, MAX_ASSET_BYTES},
        media,
        models::Draft,
    },
};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    fs,
    sync::atomic::Ordering,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedImages {
    draft: Draft,
    count: usize,
    warnings: Vec<String>,
}

#[tauri::command]
pub async fn prepare_images(
    window: WebviewWindow,
    app: AppHandle,
    id: String,
    revision: i64,
) -> Result<PreparedImages, String> {
    trusted(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let epoch = state.library_epoch.load(Ordering::SeqCst);
        let original = state.lock()?.get_draft(&id)?;
        if original.revision != revision || original.archived {
            return Err("稿件已变化，请重新打开发布预览。".into());
        }
        let images = media::images(&original.body);
        if images.len() > 32 { return Err("请将文章拆分为每篇不超过 32 张图片后准备。".into()); }
        let mut assets = BTreeMap::<String, Asset>::new();
        let mut warnings = Vec::new();
        let started = Instant::now();
        let mut total = 0;
        for (index, image) in images.iter().enumerate() {
            if assets.contains_key(&image.destination) { continue; }
            let result = if let Some(name) = media::managed_name(&image.destination) {
                state.lock()?.asset(name)
            } else if started.elapsed() > Duration::from_secs(45) {
                Err("网络耗时较长，请稍后重试。".into())
            } else {
                fetch_asset(&image.destination)
            };
            match result {
                Ok(asset) => {
                    total += asset.bytes.len();
                    if total > MAX_ASSET_BYTES { return Err("图片总量过大，请拆分文章。".into()); }
                    assets.insert(image.destination.clone(), asset);
                }
                Err(error) => warnings.push(format!("第 {} 张图片：{error}", index + 1)),
            }
        }
        // Restore/save may complete while network requests are in flight; never write into that new library.
        let mut store = state.lock()?;
        if state.library_epoch.load(Ordering::SeqCst) != epoch { return Err("资料已恢复，请重新准备图片。".into()); }
        let draft = store.save_prepared_images(&original, &assets)?;
        drop(store);
        let folder = state.directory.join("prepared-images").join(uuid::Uuid::new_v4().to_string());
        let export = (|| -> Result<(), String> {
            if assets.is_empty() { return Ok(()); }
            fs::create_dir_all(&folder).map_err(|_| "无法创建图片文件夹。")?;
            let mut instructions = String::from("图片按正文出现顺序编号。请在掘金对应位置上传图片，替换原来的图片引用。\n图片已保存在工作台稿件中；这份文件夹只是上传副本。\n\n");
            for (index, image) in images.iter().enumerate() {
                if let Some(asset) = assets.get(&image.destination) {
                    let extension = asset.name.rsplit('.').next().unwrap_or("png");
                    let filename = format!("{:02}-图片.{extension}", index + 1);
                    atomic_write(&folder.join(&filename), &asset.bytes)?;
                    instructions.push_str(&format!("{filename}：{}\n", image.alt));
                }
            }
            atomic_write(&folder.join("图片说明.txt"), instructions.as_bytes())?;
            app.opener().open_path(folder.to_string_lossy(), None::<&str>).map_err(|_| "图片已保存，但文件夹未能打开。".to_string())
        })();
        if !assets.is_empty() {
            if let Err(error) = export { warnings.push(error); }
        }
        Ok(PreparedImages { draft, count: images.iter().filter(|image| assets.contains_key(&image.destination)).count(), warnings })
    }).await.map_err(|_| "图片准备未完成，请重试。".to_string())?
}
