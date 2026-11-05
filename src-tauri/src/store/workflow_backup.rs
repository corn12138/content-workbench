use super::{
    models::Backup,
    validation,
    workflow::{content_hash, valid_images, valid_metrics, MAX_COMPOSE, MAX_NOTE, MAX_X_TEXT},
    workflow_models::Workflow,
    WorkbenchStore,
};
use rusqlite::params;
use std::collections::{HashMap, HashSet};

pub const MAX_WORKFLOW_BYTES: usize = 32 * 1024 * 1024;

/// Validates workflow data against the restored core content. Backups made before schema 5 have no
/// workflow file; they restore with no preparations, compositions or feedback.
pub(super) fn validate_workflow(workflow: &Workflow, core: &Backup) -> Result<(), String> {
    if workflow.preparations.len() > 20_000
        || workflow.sources.len() > 10_000
        || workflow.feedback.len() > 100_000
    {
        return Err("备份中的发布准备或反馈超过支持范围。".into());
    }
    let revisions: HashMap<_, _> = core
        .revisions
        .iter()
        .map(|r| ((r.draft_id.as_str(), r.revision), r))
        .collect();
    let drafts: HashSet<_> = core.drafts.iter().map(|d| d.id.as_str()).collect();
    let mut preparation_keys = HashSet::new();
    for p in &workflow.preparations {
        let revision = revisions.get(&(p.draft_id.as_str(), p.revision));
        if !preparation_keys.insert((p.draft_id.as_str(), p.platform.as_str()))
            || !matches!(p.platform.as_str(), "juejin" | "x")
            || revision.is_none_or(|r| content_hash(&r.title, &r.body) != p.content_hash)
            || p.x_text
                .as_ref()
                .is_some_and(|t| !validation::schema_within(t, MAX_X_TEXT))
            || p.x_mode
                .as_ref()
                .is_some_and(|m| !matches!(m.as_str(), "web" | "api"))
            || !validation::schema_within(&p.pending_url, 4096)
            || !valid_images(&p.images)
            || p.images_revision
                .is_some_and(|n| !revisions.contains_key(&(p.draft_id.as_str(), n)))
            || !validation::timestamp(&p.updated_at)
        {
            return Err("备份中的发布准备与稿件版本不一致，未恢复。".into());
        }
    }
    let mut source_drafts = HashSet::new();
    let mut keys = HashSet::new();
    for s in &workflow.sources {
        if !drafts.contains(s.draft_id.as_str())
            || !source_drafts.insert(s.draft_id.as_str())
            || !keys.insert(s.compose_key.as_str())
            || s.compose_key.len() != 64
            || s.sources.is_empty()
            || s.sources.len() > MAX_COMPOSE
            // Source notes may later be deleted by the user; title and link remain as attribution.
            || !validation::timestamp(&s.created_at)
            || s.sources.iter().any(|n| {
                validation::assert_id(&n.reading_id).is_err()
                    || !validation::schema_within(&n.title, 200)
                    || validation::normalize_reading_url(&n.url).is_err()
            })
        {
            return Err("备份中的笔记整理来源无效，未恢复。".into());
        }
    }
    let mut removed = HashSet::new();
    for r in &workflow.removed_drafts {
        if !drafts.contains(r.draft_id.as_str())
            || !removed.insert(r.draft_id.as_str())
            || !validation::timestamp(&r.removed_at)
        {
            return Err("备份中的已删除稿件记录无效，未恢复。".into());
        }
    }
    let publications: HashMap<_, _> = core
        .publications
        .iter()
        .map(|p| (p.id.as_str(), p.platform.as_str()))
        .collect();
    let mut ids = HashSet::new();
    for f in &workflow.feedback {
        if validation::assert_id(&f.id).is_err()
            || !ids.insert(f.id.as_str())
            || publications.get(f.publication_id.as_str()) != Some(&f.platform.as_str())
            || !matches!(f.source.as_str(), "manual" | "api")
            || !valid_metrics(&f.platform, &f.metrics)
            || !validation::timestamp(&f.observed_at)
            || !validation::timestamp(&f.created_at)
            || !validation::schema_within(&f.note, MAX_NOTE)
        {
            return Err("备份中的反馈记录无效，未恢复。".into());
        }
    }
    Ok(())
}

impl WorkbenchStore {
    pub(super) fn replace_workflow(&self, workflow: Workflow) -> Result<(), String> {
        self.connection
            .execute_batch(
                "DELETE FROM feedback; DELETE FROM draft_sources; DELETE FROM publish_preparations;",
            )
            .map_err(|e| e.to_string())?;
        for preparation in &workflow.preparations {
            self.put_preparation(preparation)?;
        }
        for sources in &workflow.sources {
            self.connection
                .execute(
                    "INSERT INTO draft_sources(draft_id, compose_key, payload) VALUES(?, ?, ?)",
                    params![
                        sources.draft_id,
                        sources.compose_key,
                        serde_json::to_string(sources).map_err(|e| e.to_string())?
                    ],
                )
                .map_err(|e| e.to_string())?;
        }
        for removed in &workflow.removed_drafts {
            self.connection
                .execute(
                    "INSERT INTO removed_drafts(draft_id, removed_at) VALUES(?, ?)",
                    params![removed.draft_id, removed.removed_at],
                )
                .map_err(|e| e.to_string())?;
        }
        for feedback in &workflow.feedback {
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
        }
        Ok(())
    }
}
