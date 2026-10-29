use super::{
    models::{Draft, DraftInput, ImportResult, Revision},
    validation, WorkbenchStore,
};
use regex::Regex;
use rusqlite::params;
use sha2::{Digest, Sha256};
use std::{path::Path, sync::LazyLock};
use uuid::Uuid;

static IMAGE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)!\[[\s\S]*?\]\s*(?:\(|\[)|<img\b").unwrap());
static HEADING: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^#\s+([^\r\n\u{2028}\u{2029}]+)\r?$").unwrap());
static EXTENSION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\.(?:md|markdown|txt)$").unwrap());

pub(super) fn hash_body(body: &str) -> String {
    format!("{:x}", Sha256::digest(body.as_bytes()))
}

impl WorkbenchStore {
    pub(super) fn get_draft(&self, id: &str) -> Result<Draft, String> {
        validation::assert_id(id)?;
        self.one("SELECT payload FROM drafts WHERE id = ?", [id])?
            .ok_or_else(|| "这篇稿件不存在，请返回列表重新选择。".into())
    }

    pub fn save_draft(&mut self, input: DraftInput) -> Result<Draft, String> {
        if !validation::content(&input.title, &input.body, &input.project)
            || input
                .id
                .as_ref()
                .is_some_and(|id| validation::assert_id(id).is_err())
            || input
                .expected_revision
                .is_some_and(|n| !validation::positive(n))
        {
            return Err("稿件内容无效或过长，请检查后重试。".into());
        }
        self.transaction(|store| {
            let previous = input.id.as_deref().map(|id| store.get_draft(id)).transpose()?;
            if previous.as_ref().is_some_and(|draft| input.expected_revision != Some(draft.revision)) {
                return Err("稿件已发生变化。请重新打开最新内容后再保存。".into());
            }
            let title = match validation::trim(&input.title) { "" => "未命名稿件", value => value }.to_owned();
            let project = validation::trim(&input.project).to_owned();
            if let Some(old) = &previous {
                if old.title == title && old.body == input.body && old.project == project { return Ok(old.clone()); }
            }
            let now = validation::now();
            let draft = Draft {
                id: previous.as_ref().map(|d| d.id.clone()).unwrap_or_else(|| Uuid::new_v4().to_string()),
                title, body: input.body, project,
                revision: previous.as_ref().map_or(1, |d| d.revision + 1),
                archived: previous.as_ref().is_some_and(|d| d.archived),
                created_at: previous.as_ref().map(|d| d.created_at.clone()).unwrap_or_else(|| now.clone()),
                updated_at: now.clone(),
            };
            store.connection.execute("INSERT INTO drafts(id, body_hash, payload) VALUES(?, ?, ?) ON CONFLICT(id) DO UPDATE SET body_hash=excluded.body_hash, payload=excluded.payload",
                params![draft.id, hash_body(&draft.body), serde_json::to_string(&draft).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
            let revision = Revision { revision: draft.revision, title: draft.title.clone(), body: draft.body.clone(), project: draft.project.clone(), saved_at: now };
            // Appending history preserves publication references when an older version is restored.
            store.connection.execute("INSERT INTO revisions(draft_id, revision, payload) VALUES(?, ?, ?)",
                params![draft.id, draft.revision, serde_json::to_string(&revision).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
            Ok(draft)
        })
    }

    pub fn import_markdown(&mut self, filename: &str, text: &str) -> Result<ImportResult, String> {
        if !validation::within(filename, 4096) || !validation::within(text, validation::MAX_BODY) {
            return Err("文章过大或格式无效，请选择 100 万字符以内的 Markdown 文本。".into());
        }
        let warnings = if IMAGE.is_match(text) {
            vec!["当前版本只导入文字，图片仍需在发布平台添加。".into()]
        } else {
            vec![]
        };
        let existing: Option<Draft> = self.one(
            "SELECT payload FROM drafts WHERE body_hash = ?",
            [hash_body(text)],
        )?;
        if let Some(existing) = existing.filter(|d| d.body == text) {
            if existing.archived {
                self.archive_draft(&existing.id, false)?;
            }
            return Ok(ImportResult {
                draft: self.get_draft(&existing.id)?,
                duplicate: true,
                warnings,
            });
        }
        let heading = HEADING
            .captures(text)
            .and_then(|c| c.get(1))
            .map(|v| validation::trim(v.as_str()));
        let basename = Path::new(filename)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        let fallback = EXTENSION.replace(basename, "");
        let title = heading.filter(|s| !s.is_empty()).unwrap_or(&fallback);
        let title = if title.is_empty() {
            "未命名稿件"
        } else {
            title
        };
        // Bound the title using the frontend's UTF-16 budget while keeping valid Rust UTF-8.
        let mut remaining = 200;
        let title: String = title
            .chars()
            .take_while(|c| {
                let size = c.len_utf16();
                if remaining < size {
                    false
                } else {
                    remaining -= size;
                    true
                }
            })
            .collect();
        let draft = self.save_draft(DraftInput {
            id: None,
            title,
            body: text.into(),
            project: String::new(),
            expected_revision: None,
        })?;
        Ok(ImportResult {
            draft,
            duplicate: false,
            warnings,
        })
    }

    pub fn archive_draft(&mut self, id: &str, archived: bool) -> Result<(), String> {
        let mut draft = self.get_draft(id)?;
        draft.archived = archived;
        draft.updated_at = validation::now();
        self.connection
            .execute(
                "UPDATE drafts SET payload = ? WHERE id = ?",
                params![
                    serde_json::to_string(&draft).map_err(|e| e.to_string())?,
                    id
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn revisions(&self, id: &str) -> Result<Vec<Revision>, String> {
        self.get_draft(id)?;
        self.all(
            "SELECT payload FROM revisions WHERE draft_id = ? ORDER BY revision DESC",
            [id],
        )
    }

    pub fn restore_revision(
        &mut self,
        id: &str,
        revision: i64,
        expected_revision: i64,
    ) -> Result<Draft, String> {
        self.get_draft(id)?;
        if !validation::positive(revision) {
            return Err("请选择有效的历史版本。".into());
        }
        let old: Revision = self
            .one(
                "SELECT payload FROM revisions WHERE draft_id = ? AND revision = ?",
                params![id, revision],
            )?
            .ok_or_else(|| "这个历史版本不存在，请重新选择。".to_string())?;
        self.save_draft(DraftInput {
            id: Some(id.into()),
            title: old.title,
            body: old.body,
            project: old.project,
            expected_revision: Some(expected_revision),
        })
    }
}
