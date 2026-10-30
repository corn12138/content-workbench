use rusqlite::Connection;
use std::{fs, path::Path};

pub(super) fn upgrade(
    connection: &Connection,
    directory: &Path,
    original: i64,
) -> Result<(), String> {
    if original == 3 {
        return Ok(());
    }
    if original == 2 {
        // Version 0.2 rejects API-confirmed publications in backups. Keep its database intact and prevent it opening the new store.
        let recovery = directory.join(format!(
            "before-publishing-upgrade-{}.sqlite",
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
        .execute_batch("PRAGMA user_version=3;")
        .map_err(|e| e.to_string())
}
