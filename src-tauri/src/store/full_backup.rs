use super::{
    archive::{self, Files},
    assets::Asset,
    backup_validation::validate_backup,
    feed_models::Library,
    media::{images, managed_name},
    models::Backup,
    WorkbenchStore,
};
use std::{collections::HashSet, fs::OpenOptions, io::Write};

impl WorkbenchStore {
    pub fn export_full_backup(&self) -> Result<Vec<u8>, String> {
        let mut files = Files::new();
        files.insert("core.json".into(), self.export_backup()?.into_bytes());
        files.insert(
            "library.json".into(),
            serde_json::to_vec(&self.library()?).map_err(|e| e.to_string())?,
        );
        for asset in self.all_assets()? {
            files.insert(format!("assets/{}", asset.name), asset.bytes);
        }
        // Validate exports as well as imports so a missing historical image cannot be called a complete backup.
        validate_files(&files)?;
        archive::pack(files)
    }

    pub fn restore_full_backup(&mut self, bytes: &[u8]) -> Result<(), String> {
        let files = if bytes.starts_with(b"PK") {
            archive::unpack(bytes)?
        } else {
            let mut files = Files::new();
            files.insert("core.json".into(), bytes.to_vec());
            files.insert(
                "library.json".into(),
                b"{\"feeds\":[],\"items\":[]}".to_vec(),
            );
            files
        };
        let (core, library, assets) = validate_files(&files)?;
        let recovery = self.export_full_backup()?;
        let path = self
            .directory
            .join(format!("before-restore-{}.cwb", uuid::Uuid::new_v4()));
        let mut options = OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(path).map_err(|e| e.to_string())?;
        file.write_all(&recovery)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        // All owned content lives in this database: one transaction also rolls back images and feed associations.
        self.transaction(|store| {
            store
                .connection
                .execute_batch("DELETE FROM feed_items; DELETE FROM feeds; DELETE FROM assets;")
                .map_err(|e| e.to_string())?;
            store.replace_contents(core)?;
            for asset in &assets {
                store.put_asset(asset)?;
            }
            store.replace_library(library)
        })
    }

    pub fn export_article(&self, id: &str) -> Result<(Vec<u8>, bool), String> {
        let draft = self.get_draft(id)?;
        let assets = self.draft_assets(id)?;
        if assets.is_empty() {
            return Ok((draft.body.into_bytes(), false));
        }
        let mut files = Files::new();
        files.insert("article.md".into(), draft.body.into_bytes());
        for asset in assets {
            files.insert(format!("assets/{}", asset.name), asset.bytes);
        }
        Ok((archive::write_zip(&files)?, true))
    }
}

fn validate_files(files: &Files) -> Result<(Backup, Library, Vec<Asset>), String> {
    let json = std::str::from_utf8(files.get("core.json").ok_or("备份缺少正文资料。")?)
        .map_err(|_| "备份正文编码无效。")?;
    let core = validate_backup(json)?;
    let library: Library =
        serde_json::from_slice(files.get("library.json").ok_or("备份缺少阅读资料。")?)
            .map_err(|_| "备份阅读资料无效。")?;
    super::feeds::validate_library(&library, &core.readings)?;
    let mut assets = Vec::new();
    for (path, bytes) in files {
        if let Some(name) = path.strip_prefix("assets/") {
            let asset = Asset::from_bytes(bytes.clone())?;
            if asset.name != name {
                return Err("备份图片校验失败。".into());
            }
            assets.push(asset);
        }
    }
    if assets.len() > 512
        || assets.iter().map(|a| a.bytes.len()).sum::<usize>() > super::assets::MAX_ASSET_BYTES
    {
        return Err("备份图片资料过大。".into());
    }
    let names: HashSet<_> = assets.iter().map(|a| a.name.as_str()).collect();
    for body in core
        .drafts
        .iter()
        .map(|d| &d.body)
        .chain(core.revisions.iter().map(|r| &r.body))
    {
        for image in images(body) {
            if let Some(name) = managed_name(&image.destination) {
                if !names.contains(name) {
                    return Err("备份缺少文章或历史版本引用的图片。".into());
                }
            }
        }
    }
    Ok((core, library, assets))
}
