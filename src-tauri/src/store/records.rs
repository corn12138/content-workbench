use super::{
    models::{Draft, Publication, Reading, ReadingInput, Revision},
    validation, WorkbenchStore,
};
use rusqlite::params;
use url::Url;
use uuid::Uuid;

impl WorkbenchStore {
    pub fn record_publication(
        &mut self,
        draft_id: &str,
        revision: i64,
        url: &str,
    ) -> Result<Publication, String> {
        self.get_draft(draft_id)?;
        if !validation::positive(revision) {
            return Err("请选择有效的稿件版本。".into());
        }
        let source: Revision = self
            .one(
                "SELECT payload FROM revisions WHERE draft_id = ? AND revision = ?",
                params![draft_id, revision],
            )?
            .ok_or_else(|| "无法找到发布时的稿件版本，请重新准备发布。".to_string())?;
        let parsed = validation::publication_url(url)?;
        let previous: Option<Publication> = self.one(
            "SELECT payload FROM publications WHERE identity = ?",
            [&parsed.identity],
        )?;
        if let Some(previous) = previous {
            if previous.draft_id != draft_id || previous.draft_revision != revision {
                return Err(
                    "这篇线上作品已关联其他稿件或版本，请检查链接，不会覆盖原记录。".into(),
                );
            }
            return Ok(previous);
        }
        let publication = Publication {
            id: Uuid::new_v4().to_string(),
            draft_id: draft_id.into(),
            draft_revision: revision,
            title: source.title,
            platform: parsed.platform,
            url: parsed.url,
            confirmed_at: validation::now(),
            confirmation: "manual".into(),
        };
        // Manual recording cannot establish platform publication success or account ownership.
        self.connection.execute("INSERT INTO publications(id, identity, draft_id, revision, payload) VALUES(?, ?, ?, ?, ?)",
            params![publication.id, parsed.identity, draft_id, revision, serde_json::to_string(&publication).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
        Ok(publication)
    }

    pub fn record_api_publication(
        &mut self,
        draft_id: &str,
        revision: i64,
        url: &str,
    ) -> Result<Publication, String> {
        self.transaction(|store| {
            let mut publication = store.record_publication(draft_id, revision, url)?;
            publication.confirmation = "api".into();
            store
                .connection
                .execute(
                    "UPDATE publications SET payload=? WHERE id=?",
                    params![
                        serde_json::to_string(&publication).map_err(|e| e.to_string())?,
                        publication.id
                    ],
                )
                .map_err(|e| e.to_string())?;
            Ok(publication)
        })
    }

    pub fn save_reading(&mut self, input: ReadingInput) -> Result<Reading, String> {
        if !validation::schema_within(&input.url, 4096)
            || !validation::schema_within(&input.title, 200)
            || !validation::schema_within(&input.note, validation::MAX_BODY)
            || input
                .id
                .as_ref()
                .is_some_and(|id| validation::assert_id(id).is_err())
        {
            return Err("阅读资料内容无效或过长，请检查后重试。".into());
        }
        let url = validation::normalize_reading_url(&input.url)?;
        let existing = input
            .id
            .as_deref()
            .map(|id| self.get_reading(id))
            .transpose()?;
        let duplicate: Option<Reading> =
            self.one("SELECT payload FROM readings WHERE url = ?", [&url])?;
        if let Some(duplicate) = duplicate {
            if existing.as_ref().is_none_or(|old| old.id != duplicate.id) {
                if existing.is_some() {
                    return Err("这个链接已经收藏，请打开已有记录。".into());
                }
                // Re-adding a URL must preserve notes and reading status already saved by the user.
                return Ok(duplicate);
            }
        }
        let now = validation::now();
        let title = validation::trim(&input.title);
        let title = if title.is_empty() {
            Url::parse(&url)
                .map_err(|e| e.to_string())?
                .host_str()
                .unwrap_or_default()
                .to_owned()
        } else {
            title.to_owned()
        };
        let reading = Reading {
            id: existing
                .as_ref()
                .map(|r| r.id.clone())
                .unwrap_or_else(|| Uuid::new_v4().to_string()),
            url,
            title,
            note: input.note,
            read: input.read,
            created_at: existing
                .as_ref()
                .map(|r| r.created_at.clone())
                .unwrap_or_else(|| now.clone()),
            updated_at: now,
        };
        self.connection.execute("INSERT INTO readings(id, url, payload) VALUES(?, ?, ?) ON CONFLICT(id) DO UPDATE SET url=excluded.url, payload=excluded.payload", params![reading.id, reading.url, serde_json::to_string(&reading).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
        Ok(reading)
    }

    fn get_reading(&self, id: &str) -> Result<Reading, String> {
        validation::assert_id(id)?;
        self.one("SELECT payload FROM readings WHERE id = ?", [id])?
            .ok_or_else(|| "这条阅读资料不存在，请返回列表重新选择。".into())
    }

    pub fn delete_reading(&mut self, id: &str) -> Result<(), String> {
        self.get_reading(id)?;
        self.transaction(|store| {
            store.detach_reading(id)?;
            store
                .connection
                .execute("DELETE FROM readings WHERE id = ?", [id])
                .map_err(|e| e.to_string())?;
            Ok(())
        })
    }

    pub fn reading_to_draft(&mut self, id: &str) -> Result<Draft, String> {
        let reading = self.get_reading(id)?;
        if validation::trim(&reading.note).is_empty() {
            return Err("先写下一条收获，再把它整理成草稿。".into());
        }
        let body = format!(
            "# {}\n\n{}\n\n来源：{}\n",
            reading.title, reading.note, reading.url
        );
        Ok(self
            .import_markdown(&format!("{}.md", reading.title), &body)?
            .draft)
    }
}
