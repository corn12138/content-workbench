//! Deleting drafts and subscriptions.
//!
//! A deleted draft first becomes a hidden tombstone so the short undo window can bring it back.
//! Drafts without publication records are erased the next time the library opens (and are left out
//! of backups right away). Drafts that were published keep their row and history, hidden, because
//! publication records and feedback point at the exact version that went online.
use super::{
    models::Draft,
    validation,
    workflow_models::{DraftSources, RemovedDraft},
    WorkbenchStore,
};
use rusqlite::{params, Connection};
use std::{fs, path::Path};

/// Drafts the user can see and edit.
pub(super) const LIVE_DRAFT: &str = "id NOT IN (SELECT draft_id FROM removed_drafts)";
/// Drafts that still belong in a backup: live ones, plus deleted ones that publication records need.
pub(super) const KEPT_DRAFT: &str = "id NOT IN (SELECT r.draft_id FROM removed_drafts r WHERE NOT EXISTS (SELECT 1 FROM publications p WHERE p.draft_id = r.draft_id))";

/// Schema 6 adds the tombstone table. Older binaries would show deleted drafts again, so they refuse
/// schema 6; a standalone copy of the schema-5 database is kept for rollback.
pub(super) fn upgrade(
    connection: &Connection,
    directory: &Path,
    original: i64,
) -> Result<(), String> {
    let current: i64 = connection
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if current >= 6 {
        return Ok(());
    }
    if original == 5 {
        let recovery = directory.join(format!(
            "before-delete-upgrade-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        connection
            .backup(rusqlite::MAIN_DB, &recovery, None)
            .map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&recovery, fs::Permissions::from_mode(0o600))
                .map_err(|e| e.to_string())?;
        }
        fs::File::open(recovery)
            .and_then(|f| f.sync_all())
            .map_err(|e| e.to_string())?;
    }
    connection
        .execute_batch(
            "BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS removed_drafts (draft_id TEXT PRIMARY KEY REFERENCES drafts(id) ON DELETE CASCADE, removed_at TEXT NOT NULL);
        PRAGMA user_version=6; COMMIT;",
        )
        .map_err(|e| {
            let _ = connection.execute_batch("ROLLBACK");
            e.to_string()
        })
}

impl WorkbenchStore {
    /// Hides the draft and drops its unfinished publishing preparation. Undo with `restore_removed_draft`.
    pub fn remove_draft(&mut self, id: &str) -> Result<(), String> {
        self.get_draft(id)?;
        self.transaction(|store| {
            store
                .connection
                .execute("DELETE FROM publish_preparations WHERE draft_id = ?", [id])
                .map_err(|e| e.to_string())?;
            store
                .connection
                .execute(
                    "INSERT INTO removed_drafts(draft_id, removed_at) VALUES(?, ?)",
                    params![id, validation::now()],
                )
                .map_err(|e| e.to_string())?;
            Ok(())
        })
    }

    pub fn restore_removed_draft(&mut self, id: &str) -> Result<Draft, String> {
        validation::assert_id(id)?;
        let changed = self
            .connection
            .execute("DELETE FROM removed_drafts WHERE draft_id = ?", [id])
            .map_err(|e| e.to_string())?;
        if changed == 0 {
            return Err("这篇稿件已无法撤销删除。".into());
        }
        self.get_draft(id)
    }

    /// Erases deleted drafts that no publication record needs, with their history and note sources.
    pub(super) fn purge_removed_drafts(&mut self) -> Result<usize, String> {
        self.transaction(|store| {
            let ids: Vec<String> = {
                let mut statement = store
                    .connection
                    .prepare("SELECT r.draft_id FROM removed_drafts r WHERE NOT EXISTS (SELECT 1 FROM publications p WHERE p.draft_id = r.draft_id)")
                    .map_err(|e| e.to_string())?;
                let rows = statement
                    .query_map([], |r| r.get::<_, String>(0))
                    .map_err(|e| e.to_string())?;
                rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?
            };
            for id in &ids {
                for sql in [
                    "DELETE FROM draft_sources WHERE draft_id = ?",
                    "DELETE FROM publish_preparations WHERE draft_id = ?",
                    "DELETE FROM revisions WHERE draft_id = ?",
                    "DELETE FROM removed_drafts WHERE draft_id = ?",
                    "DELETE FROM drafts WHERE id = ?",
                ] {
                    store
                        .connection
                        .execute(sql, [id])
                        .map_err(|e| e.to_string())?;
                }
            }
            Ok(ids.len())
        })
    }

    /// Deleted drafts that backups must carry because publication records still point at them.
    pub(super) fn removed_drafts(&self) -> Result<Vec<RemovedDraft>, String> {
        let mut statement = self
            .connection
            .prepare("SELECT draft_id, removed_at FROM removed_drafts r WHERE EXISTS (SELECT 1 FROM publications p WHERE p.draft_id = r.draft_id) ORDER BY draft_id")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |r| {
                Ok(RemovedDraft {
                    draft_id: r.get(0)?,
                    removed_at: r.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    pub(super) fn kept_sources(&self) -> Result<Vec<DraftSources>, String> {
        self.all(
            &format!(
                "SELECT payload FROM draft_sources WHERE draft_id IN (SELECT id FROM drafts WHERE {KEPT_DRAFT}) ORDER BY draft_id"
            ),
            [],
        )
    }

    /// Removes a subscription, its cached entries and the articles it brought in. Articles with a note
    /// are kept unless `with_notes` (they stay as a link plus the note); articles another subscription
    /// also lists are always kept.
    pub fn delete_feed(&mut self, id: &str, with_notes: bool) -> Result<(), String> {
        self.feed(id)?;
        self.transaction(|store| {
            let readings: Vec<String> = {
                let mut statement = store
                    .connection
                    .prepare("SELECT DISTINCT reading_id FROM feed_items WHERE feed_id = ?1 AND reading_id IS NOT NULL AND reading_id NOT IN (SELECT reading_id FROM feed_items WHERE feed_id <> ?1 AND reading_id IS NOT NULL)")
                    .map_err(|e| e.to_string())?;
                let rows = statement
                    .query_map([id], |r| r.get::<_, String>(0))
                    .map_err(|e| e.to_string())?;
                rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?
            };
            store
                .connection
                .execute("DELETE FROM feed_items WHERE feed_id = ?", [id])
                .map_err(|e| e.to_string())?;
            for reading in readings {
                let Ok(saved) = store.get_reading(&reading) else { continue };
                if with_notes || validation::trim(&saved.note).is_empty() {
                    store
                        .connection
                        .execute("DELETE FROM readings WHERE id = ?", [&reading])
                        .map_err(|e| e.to_string())?;
                }
            }
            store
                .connection
                .execute("DELETE FROM feeds WHERE id = ?", [id])
                .map_err(|e| e.to_string())?;
            Ok(())
        })
    }
}
