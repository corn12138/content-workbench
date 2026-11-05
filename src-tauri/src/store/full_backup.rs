use super::{
    archive::{self, Files},
    assets::Asset,
    backup_validation::validate_backup,
    feed_models::Library,
    media::{images, managed_name},
    models::Backup,
    validation,
    workflow_backup::validate_workflow,
    workflow_models::Workflow,
    WorkbenchStore,
};
use serde::Serialize;
use std::{
    collections::{BTreeMap, HashSet},
    fs::OpenOptions,
    io::Write,
};

/// Read-only summary shown before the user confirms a restore.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupSummary {
    pub format: String,
    pub exported_at: String,
    pub drafts: usize,
    pub archived_drafts: usize,
    pub revisions: usize,
    pub publications: usize,
    pub readings: usize,
    pub notes: usize,
    pub feeds: usize,
    pub feed_items: usize,
    pub images: usize,
    pub preparations: usize,
    pub compositions: usize,
    pub feedback: usize,
}

/// Current editor content to export without touching the database copy.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExportInput {
    pub title: String,
    pub body: String,
    pub project: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ExportedArticle {
    pub bytes: Vec<u8>,
    pub bundled: bool,
    pub images: usize,
    pub missing: usize,
    pub remote: usize,
}

pub struct ValidatedBackup {
    core: Backup,
    library: Library,
    assets: Vec<Asset>,
    workflow: Workflow,
    pub summary: BackupSummary,
}

impl WorkbenchStore {
    pub fn export_full_backup(&self) -> Result<Vec<u8>, String> {
        let mut files = Files::new();
        files.insert("core.json".into(), self.export_backup()?.into_bytes());
        files.insert(
            "library.json".into(),
            serde_json::to_vec(&self.library()?).map_err(|e| e.to_string())?,
        );
        files.insert(
            "workflow.json".into(),
            serde_json::to_vec(&self.workflow()?).map_err(|e| e.to_string())?,
        );
        for asset in self.all_assets()? {
            files.insert(format!("assets/{}", asset.name), asset.bytes);
        }
        // Validate exports as well as imports so a missing historical image cannot be called a complete backup.
        validate_files(&files, "")?;
        archive::pack(files)
    }

    /// Parses and fully validates a backup without modifying anything.
    pub fn inspect_backup(bytes: &[u8]) -> Result<ValidatedBackup, String> {
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
        let kind = if !bytes.starts_with(b"PK") {
            "文字备份（旧版 JSON，不含图片与订阅）"
        } else if files.contains_key("workflow.json") {
            "完整备份（含发布准备与反馈）"
        } else {
            "完整备份（较早版本，不含发布准备与反馈）"
        };
        validate_files(&files, kind)
    }

    pub fn restore_full_backup(&mut self, bytes: &[u8]) -> Result<(), String> {
        let validated = Self::inspect_backup(bytes)?;
        self.restore_validated(validated)
    }

    pub fn restore_validated(&mut self, validated: ValidatedBackup) -> Result<(), String> {
        let ValidatedBackup {
            core,
            library,
            assets,
            workflow,
            ..
        } = validated;
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
                .execute_batch("DELETE FROM feedback; DELETE FROM draft_sources; DELETE FROM publish_preparations; DELETE FROM feed_items; DELETE FROM feeds; DELETE FROM assets;")
                .map_err(|e| e.to_string())?;
            store.replace_contents(core)?;
            for asset in &assets {
                store.put_asset(asset)?;
            }
            store.replace_library(library)?;
            store.replace_workflow(workflow)
        })
    }

    /// Bundles exactly the given editor content. Only images already stored in this library are read;
    /// arbitrary local paths are never accepted, and missing or remote images are reported, not fetched.
    pub fn export_current(&self, input: &ExportInput) -> Result<ExportedArticle, String> {
        if !validation::content(&input.title, &input.body, &input.project) {
            return Err("稿件内容无效或过长，无法导出。".into());
        }
        let mut assets = BTreeMap::new();
        let mut missing = 0;
        let mut remote = 0;
        for image in images(&input.body) {
            if let Some(name) = managed_name(&image.destination) {
                if assets.contains_key(name) {
                    continue;
                }
                match self.asset(name) {
                    Ok(asset) => {
                        assets.insert(name.to_owned(), asset);
                    }
                    Err(_) => missing += 1,
                }
            } else if url::Url::parse(&image.destination).is_ok() {
                remote += 1;
            } else {
                missing += 1;
            }
        }
        if assets.values().map(|a| a.bytes.len()).sum::<usize>() > super::assets::MAX_ASSET_BYTES {
            return Err("图片总量过大，无法一起导出。".into());
        }
        let count = assets.len();
        if assets.is_empty() {
            return Ok(ExportedArticle {
                bytes: input.body.clone().into_bytes(),
                bundled: false,
                images: 0,
                missing,
                remote,
            });
        }
        let mut files = Files::new();
        files.insert("article.md".into(), input.body.clone().into_bytes());
        for (name, asset) in assets {
            files.insert(format!("assets/{name}"), asset.bytes);
        }
        Ok(ExportedArticle {
            bytes: archive::write_zip(&files)?,
            bundled: true,
            images: count,
            missing,
            remote,
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

fn validate_files(files: &Files, kind: &str) -> Result<ValidatedBackup, String> {
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
    let workflow: Workflow = match files.get("workflow.json") {
        Some(bytes) => serde_json::from_slice(bytes).map_err(|_| "备份中的发布准备与反馈资料无效。")?,
        None => Workflow::default(),
    };
    validate_workflow(&workflow, &core)?;
    let summary = BackupSummary {
        format: kind.into(),
        exported_at: core.exported_at.clone(),
        // Deleted drafts kept for publication records are not counted as drafts the user will see.
        drafts: core.drafts.len() - workflow.removed_drafts.len(),
        archived_drafts: core
            .drafts
            .iter()
            .filter(|d| d.archived && !workflow.removed_drafts.iter().any(|r| r.draft_id == d.id))
            .count(),
        revisions: core.revisions.len(),
        publications: core.publications.len(),
        readings: core.readings.len(),
        notes: core.readings.iter().filter(|r| !validation::trim(&r.note).is_empty()).count(),
        feeds: library.feeds.len(),
        feed_items: library.items.len(),
        images: assets.len(),
        preparations: workflow.preparations.len(),
        compositions: workflow.sources.len(),
        feedback: workflow.feedback.len(),
    };
    Ok(ValidatedBackup {
        core,
        library,
        assets,
        workflow,
        summary,
    })
}
