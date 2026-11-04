use rusqlite::Connection;
use std::{fs, path::Path};

/// Schema 5 adds publishing preparation, note-composition sources and manual/API feedback snapshots.
/// The new tables live in the same database so a single transaction covers drafts and their workflow state.
pub(super) fn upgrade(
    connection: &Connection,
    directory: &Path,
    original: i64,
) -> Result<(), String> {
    let current: i64 = connection
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if current >= 5 {
        return Ok(());
    }
    if original == 4 {
        // Schema-4 binaries would ignore the new tables and could restore backups that silently drop them;
        // keep a standalone copy for rollback before the version number changes.
        let recovery = directory.join(format!(
            "before-workflow-upgrade-{}.sqlite",
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
        CREATE TABLE IF NOT EXISTS publish_preparations (draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE, platform TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(draft_id, platform));
        CREATE TABLE IF NOT EXISTS draft_sources (draft_id TEXT PRIMARY KEY REFERENCES drafts(id) ON DELETE CASCADE, compose_key TEXT NOT NULL UNIQUE, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE, payload TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS feedback_publication ON feedback(publication_id);
        PRAGMA user_version=5; COMMIT;",
        )
        .map_err(|e| {
            let _ = connection.execute_batch("ROLLBACK");
            e.to_string()
        })
}
