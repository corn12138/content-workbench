use super::{
    models::{Draft, DraftInput, Publication, Reading, Revision},
    validation,
    workflow_models::*,
    WorkbenchStore,
};
use rusqlite::params;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};

pub fn content_hash(title: &str, body: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(title.as_bytes());
    digest.update([0]);
    digest.update(body.as_bytes());
    format!("{:x}", digest.finalize())
}

pub const MAX_X_TEXT: usize = 10_000;
pub const MAX_NOTE: usize = 4_000;
pub const MAX_COMPOSE: usize = 50;

pub(super) fn valid_metrics(platform: &str, metrics: &BTreeMap<String, Option<i64>>) -> bool {
    let names = metric_names(platform);
    !metrics.is_empty()
        && metrics.len() <= names.len()
        && metrics.iter().all(|(key, value)| {
            names.contains(&key.as_str())
                && value.is_none_or(|n| (0..=validation::MAX_SAFE_INTEGER).contains(&n))
        })
}

pub(super) fn valid_images(images: &[PreparedImage]) -> bool {
    images.len() <= 32
        && images.iter().all(|image| {
            (1..=32).contains(&image.position)
                && validation::schema_within(&image.source, 300)
                && image
                    .filename
                    .as_ref()
                    .is_none_or(|f| validation::schema_within(f, 80) && !f.contains(['/', '\\']))
                && matches!(image.status.as_str(), "ready" | "failed")
                && image
                    .error
                    .as_ref()
                    .is_none_or(|e| validation::schema_within(e, 300))
        })
}

impl WorkbenchStore {
    pub fn workflow(&self) -> Result<Workflow, String> {
        let mut preparations: Vec<Preparation> =
            self.all("SELECT payload FROM publish_preparations", [])?;
        preparations.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        let sources = self.all("SELECT payload FROM draft_sources ORDER BY draft_id", [])?;
        let mut feedback: Vec<Feedback> = self.all("SELECT payload FROM feedback", [])?;
        feedback.sort_by(|a, b| {
            b.observed_at
                .cmp(&a.observed_at)
                .then(b.created_at.cmp(&a.created_at))
        });
        Ok(Workflow {
            preparations,
            sources,
            feedback,
        })
    }

    fn revision_of(&self, draft_id: &str, revision: i64) -> Result<Revision, String> {
        if !validation::positive(revision) {
            return Err("请选择有效的稿件版本。".into());
        }
        self.one(
            "SELECT payload FROM revisions WHERE draft_id = ? AND revision = ?",
            params![draft_id, revision],
        )?
        .ok_or_else(|| "找不到对应的稿件版本，请重新打开发布准备。".to_string())
    }

    pub(super) fn preparation(
        &self,
        draft_id: &str,
        platform: &str,
    ) -> Result<Option<Preparation>, String> {
        self.one(
            "SELECT payload FROM publish_preparations WHERE draft_id = ? AND platform = ?",
            params![draft_id, platform],
        )
    }

    pub(super) fn put_preparation(&self, preparation: &Preparation) -> Result<(), String> {
        self.connection
            .execute(
                "INSERT INTO publish_preparations(draft_id, platform, payload) VALUES(?, ?, ?) ON CONFLICT(draft_id, platform) DO UPDATE SET payload=excluded.payload",
                params![
                    preparation.draft_id,
                    preparation.platform,
                    serde_json::to_string(preparation).map_err(|e| e.to_string())?
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Saves user-entered preparation text bound to an existing revision. Image results are owned by
    /// image preparation and are carried over untouched, so an older result stays marked with its revision.
    pub fn save_preparation(&mut self, input: PreparationInput) -> Result<Preparation, String> {
        let draft = self.get_draft(&input.draft_id)?;
        if !matches!(input.platform.as_str(), "juejin" | "x")
            || input
                .x_text
                .as_ref()
                .is_some_and(|t| !validation::schema_within(t, MAX_X_TEXT))
            || input
                .x_mode
                .as_ref()
                .is_some_and(|m| !matches!(m.as_str(), "web" | "api"))
            || !validation::schema_within(&input.pending_url, 4096)
            || input.revision > draft.revision
        {
            return Err("发布准备内容无效或过长。".into());
        }
        let revision = self.revision_of(&draft.id, input.revision)?;
        self.transaction(|store| {
            let previous = store.preparation(&draft.id, &input.platform)?;
            let preparation = Preparation {
                draft_id: draft.id.clone(),
                platform: input.platform.clone(),
                revision: input.revision,
                content_hash: content_hash(&revision.title, &revision.body),
                x_text: input.x_text.clone(),
                x_mode: input.x_mode.clone(),
                pending_url: input.pending_url.clone(),
                images: previous
                    .as_ref()
                    .map(|p| p.images.clone())
                    .unwrap_or_default(),
                images_revision: previous.as_ref().and_then(|p| p.images_revision),
                updated_at: validation::now(),
            };
            store.put_preparation(&preparation)?;
            Ok(preparation)
        })
    }

    /// Records per-image results for the revision they were produced from.
    pub fn save_image_results(
        &mut self,
        draft: &Draft,
        images: Vec<PreparedImage>,
    ) -> Result<Preparation, String> {
        if !valid_images(&images) {
            return Err("图片准备结果无效。".into());
        }
        self.transaction(|store| {
            let current = store.get_draft(&draft.id)?;
            if current.revision != draft.revision {
                return Err("稿件已变化，请重新准备图片。".into());
            }
            let previous = store.preparation(&draft.id, "juejin")?;
            let preparation = Preparation {
                draft_id: draft.id.clone(),
                platform: "juejin".into(),
                revision: draft.revision,
                content_hash: content_hash(&draft.title, &draft.body),
                x_text: None,
                x_mode: None,
                pending_url: previous
                    .as_ref()
                    .map(|p| p.pending_url.clone())
                    .unwrap_or_default(),
                images,
                images_revision: Some(draft.revision),
                updated_at: validation::now(),
            };
            store.put_preparation(&preparation)?;
            Ok(preparation)
        })
    }

    /// Image preparation only swaps remote image addresses for stored copies of the same images, so a
    /// preparation that was bound to the revision just before it follows to the new revision.
    pub fn follow_image_revision(&mut self, previous: i64, draft: &Draft) -> Result<(), String> {
        for platform in ["x", "juejin"] {
            if let Some(mut preparation) = self.preparation(&draft.id, platform)? {
                if preparation.revision == previous {
                    preparation.revision = draft.revision;
                    preparation.content_hash = content_hash(&draft.title, &draft.body);
                    preparation.updated_at = validation::now();
                    self.put_preparation(&preparation)?;
                }
            }
        }
        Ok(())
    }

    pub fn clear_preparation(&mut self, draft_id: &str, platform: &str) -> Result<(), String> {
        validation::assert_id(draft_id)?;
        self.connection
            .execute(
                "DELETE FROM publish_preparations WHERE draft_id = ? AND platform = ?",
                params![draft_id, platform],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn publication(&self, id: &str) -> Result<Publication, String> {
        validation::assert_id(id)?;
        self.one("SELECT payload FROM publications WHERE id = ?", [id])?
            .ok_or_else(|| "这条发布记录已不存在。".into())
    }

    /// Corrects a manually recorded link. Platform receipts keep their provenance and cannot be edited.
    pub fn update_publication(&mut self, id: &str, url: &str) -> Result<Publication, String> {
        let mut publication = self.publication(id)?;
        if publication.confirmation != "manual" {
            return Err("平台回执记录不能修改链接；如记录有误，可以移除本地记录。".into());
        }
        let parsed = validation::publication_url(url)?;
        if parsed.platform != publication.platform {
            return Err("更正后的链接需要属于同一平台。".into());
        }
        self.transaction(|store| {
            let other: Option<Publication> = store.one(
                "SELECT payload FROM publications WHERE identity = ? AND id <> ?",
                params![parsed.identity, publication.id],
            )?;
            if other.is_some() {
                return Err("这个链接已经记录在另一条发布记录中。".into());
            }
            if publication.url == parsed.url {
                return Ok(publication.clone());
            }
            publication.url = parsed.url.clone();
            publication.corrected_at = Some(validation::now());
            store
                .connection
                .execute(
                    "UPDATE publications SET identity = ?, payload = ? WHERE id = ?",
                    params![
                        parsed.identity,
                        serde_json::to_string(&publication).map_err(|e| e.to_string())?,
                        publication.id
                    ],
                )
                .map_err(|e| e.to_string())?;
            Ok(publication.clone())
        })
    }

    /// Removes the local record and its feedback snapshots only; nothing is deleted on the platform.
    pub fn remove_publication(&mut self, id: &str) -> Result<(), String> {
        self.publication(id)?;
        self.transaction(|store| {
            store
                .connection
                .execute("DELETE FROM feedback WHERE publication_id = ?", [id])
                .map_err(|e| e.to_string())?;
            store
                .connection
                .execute("DELETE FROM publications WHERE id = ?", [id])
                .map_err(|e| e.to_string())?;
            Ok(())
        })
    }

    fn put_feedback(&self, feedback: &Feedback) -> Result<(), String> {
        self.connection
            .execute(
                "INSERT INTO feedback(id, publication_id, payload) VALUES(?, ?, ?)",
                params![
                    feedback.id,
                    feedback.publication_id,
                    serde_json::to_string(feedback).map_err(|e| e.to_string())?
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn save_feedback(&mut self, input: FeedbackInput) -> Result<Feedback, String> {
        let publication = self.publication(&input.publication_id)?;
        let all_unknown = input.metrics.values().all(Option::is_none);
        if !valid_metrics(&publication.platform, &input.metrics)
            || !validation::timestamp(&input.observed_at)
            || !validation::schema_within(&input.note, MAX_NOTE)
            || (all_unknown && validation::trim(&input.note).is_empty())
        {
            return Err("请至少填写一项数据或跟进笔记；数字需为 0 或正整数。".into());
        }
        if chrono::DateTime::parse_from_rfc3339(&input.observed_at)
            .map_err(|e| e.to_string())?
            .timestamp()
            > chrono::Utc::now().timestamp() + 300
        {
            return Err("观察时间不能晚于现在。".into());
        }
        let feedback = Feedback {
            id: uuid::Uuid::new_v4().to_string(),
            publication_id: publication.id,
            platform: publication.platform,
            source: "manual".into(),
            observed_at: input.observed_at,
            metrics: input.metrics,
            note: input.note,
            created_at: validation::now(),
        };
        self.put_feedback(&feedback)?;
        Ok(feedback)
    }

    /// Stores platform-returned metrics. The caller has already fetched them for this publication.
    pub fn save_api_feedback(
        &mut self,
        publication_id: &str,
        expected_url: &str,
        metrics: BTreeMap<String, Option<i64>>,
    ) -> Result<Feedback, String> {
        let publication = self.publication(publication_id)?;
        if publication.url != expected_url || !valid_metrics(&publication.platform, &metrics) {
            return Err("发布记录已变化，本次数据未保存。".into());
        }
        let now = validation::now();
        let feedback = Feedback {
            id: uuid::Uuid::new_v4().to_string(),
            publication_id: publication.id,
            platform: publication.platform,
            source: "api".into(),
            observed_at: now.clone(),
            metrics,
            note: String::new(),
            created_at: now,
        };
        self.put_feedback(&feedback)?;
        Ok(feedback)
    }

    pub fn delete_feedback(&mut self, id: &str) -> Result<(), String> {
        validation::assert_id(id)?;
        let feedback: Feedback = self
            .one("SELECT payload FROM feedback WHERE id = ?", [id])?
            .ok_or("这条反馈已不存在。")?;
        if feedback.source != "manual" {
            return Err("平台返回的数据不能删除。".into());
        }
        self.connection
            .execute("DELETE FROM feedback WHERE id = ?", [id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Builds one draft from several notes in the given (visible) order. Content is the user's own notes
    /// plus titles and source links; repeated requests for the same notes return the existing draft.
    pub fn compose_notes(&mut self, ids: &[String]) -> Result<(Draft, bool), String> {
        if ids.is_empty() || ids.len() > MAX_COMPOSE {
            return Err(format!("请选择 1 至 {MAX_COMPOSE} 篇有笔记的文章。"));
        }
        let mut seen = HashSet::new();
        let mut readings: Vec<Reading> = Vec::new();
        for id in ids {
            validation::assert_id(id)?;
            if !seen.insert(id) {
                return Err("选择中有重复的文章。".into());
            }
            let reading: Reading = self
                .one("SELECT payload FROM readings WHERE id = ?", [id])?
                .ok_or("有文章已不存在，请刷新后重新选择。")?;
            if validation::trim(&reading.note).is_empty() {
                return Err(format!(
                    "《{}》还没有笔记，请取消选择或先写笔记。",
                    reading.title
                ));
            }
            readings.push(reading);
        }
        let mut digest = Sha256::new();
        for reading in &readings {
            for part in [&reading.id, &reading.title, &reading.url, &reading.note] {
                digest.update(part.as_bytes());
                digest.update([0]);
            }
        }
        let key = format!("{:x}", digest.finalize());
        let existing: Option<DraftSources> = self.one(
            "SELECT payload FROM draft_sources WHERE compose_key = ?",
            [&key],
        )?;
        if let Some(existing) = existing {
            let mut draft = self.get_draft(&existing.draft_id)?;
            if draft.archived {
                self.archive_draft(&draft.id, false)?;
                draft = self.get_draft(&draft.id)?;
            }
            return Ok((draft, true));
        }
        let first = readings[0].title.replace(['\r', '\n'], " ");
        let mut title = if readings.len() > 1 {
            format!("阅读笔记：{} 等 {} 篇", first, readings.len())
        } else {
            format!("阅读笔记：{first}")
        };
        if title.chars().count() > 200 {
            title = title.chars().take(199).collect::<String>() + "…";
        }
        let mut body = format!("# {title}\n\n");
        for (index, reading) in readings.iter().enumerate() {
            body.push_str(&format!(
                "## {}. {}\n\n{}\n\n来源：<{}>\n\n",
                index + 1,
                reading.title.replace(['\r', '\n'], " "),
                reading.note.trim_end(),
                reading.url
            ));
        }
        if !validation::schema_within(&body, validation::MAX_BODY) {
            return Err("所选笔记总长度超过单篇稿件上限，请减少选择。".into());
        }
        self.transaction(|store| {
            let draft = store.save_draft(DraftInput {
                id: None,
                title: title.clone(),
                body: body.clone(),
                project: String::new(),
                expected_revision: None,
            })?;
            let sources = DraftSources {
                draft_id: draft.id.clone(),
                compose_key: key.clone(),
                sources: readings
                    .iter()
                    .map(|r| NoteSource {
                        reading_id: r.id.clone(),
                        title: r.title.clone(),
                        url: r.url.clone(),
                    })
                    .collect(),
                created_at: validation::now(),
            };
            store
                .connection
                .execute(
                    "INSERT INTO draft_sources(draft_id, compose_key, payload) VALUES(?, ?, ?)",
                    params![
                        draft.id,
                        key,
                        serde_json::to_string(&sources).map_err(|e| e.to_string())?
                    ],
                )
                .map_err(|e| e.to_string())?;
            Ok((draft, false))
        })
    }
}
