use crate::{
    files::atomic_write,
    image_preview::fetch_asset,
    state::{trusted, AppState},
    store::{
        assets::{Asset, MAX_ASSET_BYTES},
        media,
        models::Draft,
        workflow_models::PreparedImage,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedImages {
    draft: Draft,
    count: usize,
    warnings: Vec<String>,
    images: Vec<PreparedImage>,
    folder: bool,
}

fn source_label(destination: &str) -> String {
    if media::managed_name(destination).is_some() {
        return "已随稿保存的图片".into();
    }
    match url::Url::parse(destination) {
        Ok(url) => format!("{}{}", url.host_str().unwrap_or_default(), url.path())
            .chars()
            .take(120)
            .collect(),
        Err(_) => "本地路径（未随稿保存）".into(),
    }
}

/// Downloads remote images into the draft and writes numbered upload copies. Images already stored in
/// the library are reused without network access, so running it again only retries the failed items.
/// The draft gains a revision only when at least one remote reference was replaced.
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
        let mut failures = BTreeMap::<String, String>::new();
        let started = Instant::now();
        let mut total = 0;
        for image in &images {
            if assets.contains_key(&image.destination) || failures.contains_key(&image.destination) { continue; }
            let result = if let Some(name) = media::managed_name(&image.destination) {
                state.lock()?.asset(name).map_err(|_| "已保存的图片缺失，请重新插入。".to_string())
            } else if url::Url::parse(&image.destination).is_err() {
                Err("本机路径图片无法读取，请用“插入图片”重新添加。".into())
            } else if started.elapsed() > Duration::from_secs(45) {
                Err("网络耗时较长，本次未下载，请稍后重试。".into())
            } else {
                fetch_asset(&image.destination)
            };
            match result {
                Ok(asset) => {
                    total += asset.bytes.len();
                    if total > MAX_ASSET_BYTES { return Err("图片总量过大，请拆分文章。".into()); }
                    assets.insert(image.destination.clone(), asset);
                }
                Err(error) => { failures.insert(image.destination.clone(), error); }
            }
        }
        // Restore/save may complete while network requests are in flight; never write into that new library.
        let mut store = state.lock()?;
        if state.library_epoch.load(Ordering::SeqCst) != epoch { return Err("资料已恢复，请重新准备图片。".into()); }
        let remote: BTreeMap<String, Asset> = assets
            .iter()
            .filter(|(destination, _)| media::managed_name(destination).is_none())
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        let draft = if remote.is_empty() { original.clone() } else { store.save_prepared_images(&original, &remote)? };
        if draft.revision != original.revision { store.follow_image_revision(original.revision, &draft)?; }
        let results: Vec<PreparedImage> = images
            .iter()
            .enumerate()
            .map(|(index, image)| {
                let asset = assets.get(&image.destination);
                PreparedImage {
                    position: index as i64 + 1,
                    source: source_label(&image.destination),
                    filename: asset.map(|a| format!("{:02}-图片.{}", index + 1, a.name.rsplit('.').next().unwrap_or("png"))),
                    status: if asset.is_some() { "ready" } else { "failed" }.into(),
                    error: failures.get(&image.destination).cloned(),
                }
            })
            .collect();
        store.save_image_results(&draft, results.clone())?;
        drop(store);
        let mut warnings = Vec::new();
        let folder = state.directory.join("prepared-images").join(&draft.id);
        let export = (|| -> Result<bool, String> {
            if fs::metadata(&folder).is_ok() {
                // Only this draft's own upload copies live here; replace them with the current set.
                for entry in fs::read_dir(&folder).map_err(|_| "无法整理图片文件夹。")?.flatten() {
                    if entry.file_type().is_ok_and(|t| t.is_file()) { let _ = fs::remove_file(entry.path()); }
                }
            }
            if assets.is_empty() { return Ok(false); }
            fs::create_dir_all(&folder).map_err(|_| "无法创建图片文件夹。")?;
            let mut instructions = String::from("图片按正文出现顺序编号。请在掘金对应位置上传图片，替换原来的图片引用。\n图片已保存在工作台稿件中；这份文件夹只是上传副本，上传到掘金需要你在网页中完成。\n\n");
            for (image, result) in images.iter().zip(&results) {
                if let (Some(asset), Some(filename)) = (assets.get(&image.destination), &result.filename) {
                    atomic_write(&folder.join(filename), &asset.bytes)?;
                    instructions.push_str(&format!("{filename}：{}\n", image.alt));
                }
            }
            atomic_write(&folder.join("图片说明.txt"), instructions.as_bytes())?;
            Ok(true)
        })();
        let folder_ready = match export {
            Ok(value) => value,
            Err(error) => { warnings.push(format!("图片已随稿保存，但上传副本未能写入：{error}")); false }
        };
        Ok(PreparedImages {
            draft,
            count: results.iter().filter(|r| r.status == "ready").count(),
            warnings,
            images: results,
            folder: folder_ready,
        })
    }).await.map_err(|_| "图片准备未完成，请重试。".to_string())?
}
