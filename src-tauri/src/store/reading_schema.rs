use rusqlite::Connection;
use std::{fs, path::Path};

pub(super) fn upgrade(
    connection: &Connection,
    directory: &Path,
    original: i64,
) -> Result<(), String> {
    if original >= 4 {
        return Ok(());
    }
    if original == 3 {
        // Older binaries reject the new payload fields; preserve a standalone schema-3 database for rollback.
        let recovery = directory.join(format!(
            "before-reading-upgrade-{}.sqlite",
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
        .execute_batch("PRAGMA user_version=4;")
        .map_err(|e| e.to_string())
}
