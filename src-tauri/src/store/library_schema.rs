use rusqlite::Connection;
use std::{fs, path::Path};

pub(super) fn upgrade(
    connection: &Connection,
    directory: &Path,
    original_version: i64,
) -> Result<(), String> {
    if matches!(original_version, 2 | 3) {
        return Ok(());
    }
    if original_version == 1 {
        // The old application cannot understand media; retain an independent v1 database before upgrading.
        let recovery = directory.join(format!(
            "before-library-upgrade-{}.sqlite",
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
    connection.execute_batch("BEGIN IMMEDIATE;
        CREATE TABLE assets (name TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes BLOB NOT NULL);
        CREATE TABLE feeds (id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, payload TEXT NOT NULL);
        CREATE TABLE feed_items (feed_id TEXT NOT NULL REFERENCES feeds(id) ON DELETE CASCADE, item_key TEXT NOT NULL, reading_id TEXT, payload TEXT NOT NULL, PRIMARY KEY(feed_id, item_key));
        PRAGMA user_version=2; COMMIT;").map_err(|e| { let _ = connection.execute_batch("ROLLBACK"); e.to_string() })
}
