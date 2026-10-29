use crate::store::WorkbenchStore;
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use std::{fs, path::Path};

pub fn prepare(source: &Path, destination: &Path) -> Result<bool, String> {
    if destination.join("workbench.sqlite").exists() || !source.join("workbench.sqlite").exists() {
        return Ok(false);
    }
    let parent = destination.parent().ok_or("资料目录无效。")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let staging = parent.join(format!(".workbench-migration-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&staging).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&staging, fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
    }
    let result = migrate(source, destination, &staging);
    let _ = fs::remove_dir_all(&staging);
    result.map_err(|error| {
        format!(
            "旧资料尚未迁移，原版资料未修改。请继续使用 Electron 版或从原版导出备份。原因：{error}"
        )
    })
}

fn migrate(source: &Path, destination: &Path, staging: &Path) -> Result<bool, String> {
    let copied = staging.join("copy");
    fs::create_dir(&copied).map_err(|e| e.to_string())?;
    // Online backup includes committed WAL pages without changing the source database.
    let original = Connection::open_with_flags(
        source.join("workbench.sqlite"),
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| e.to_string())?;
    original
        .backup(rusqlite::MAIN_DB, copied.join("workbench.sqlite"), None)
        .map_err(|e| e.to_string())?;
    drop(original);
    let old = WorkbenchStore::open(copied.clone())?;
    let backup = old.export_backup()?;
    let snapshot = old.snapshot()?;
    let mut validation = WorkbenchStore::open(staging.join("validation"))?;
    validation.restore_backup(&backup)?;
    let mut before: Value = serde_json::from_str(&backup).map_err(|e| e.to_string())?;
    let mut after: Value =
        serde_json::from_str(&validation.export_backup()?).map_err(|e| e.to_string())?;
    before.as_object_mut().unwrap().remove("exportedAt");
    after.as_object_mut().unwrap().remove("exportedAt");
    if before != after || snapshot != validation.snapshot()? {
        return Err("资料往返校验不一致。".into());
    }
    drop(validation);
    drop(old);
    let new_directory = !destination.exists();
    fs::create_dir_all(destination).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if new_directory {
            fs::set_permissions(destination, fs::Permissions::from_mode(0o700))
                .map_err(|e| e.to_string())?;
        }
    }
    let report = serde_json::json!({ "source":source, "migratedAt":chrono::Utc::now().to_rfc3339(),
        "drafts":snapshot.drafts.len(), "publications":snapshot.publications.len(), "readings":snapshot.readings.len(),
        "originalPreserved":true, "roundTripVerified":true });
    fs::write(
        copied.join("migration.json"),
        serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    // Hard-link creation fails if a destination appeared; it never overwrites existing local work.
    fs::rename(
        copied.join("migration.json"),
        destination.join("migration.json"),
    )
    .map_err(|e| e.to_string())?;
    fs::hard_link(
        copied.join("workbench.sqlite"),
        destination.join("workbench.sqlite"),
    )
    .map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::models::DraftInput;
    #[test]
    fn source_wal_snapshot_migrates_once_without_overwriting() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("old");
        let destination = temp.path().join("new");
        let mut old = WorkbenchStore::open(source.clone()).unwrap();
        let draft = old
            .save_draft(DraftInput {
                id: None,
                title: "已有稿件 🚀".into(),
                body: "原始内容".into(),
                project: "".into(),
                expected_revision: None,
            })
            .unwrap();
        let before = old.export_backup().unwrap();
        assert!(prepare(&source, &destination).unwrap());
        let mut new = WorkbenchStore::open(destination.clone()).unwrap();
        assert_eq!(old.snapshot().unwrap(), new.snapshot().unwrap());
        new.save_draft(DraftInput {
            id: Some(draft.id),
            title: draft.title,
            body: "迁移后编辑".into(),
            project: "".into(),
            expected_revision: Some(1),
        })
        .unwrap();
        assert!(!prepare(&source, &destination).unwrap());
        assert_eq!(old.snapshot().unwrap().drafts[0].body, "原始内容");
        let mut previous: Value = serde_json::from_str(&before).unwrap();
        let mut current: Value = serde_json::from_str(&old.export_backup().unwrap()).unwrap();
        previous.as_object_mut().unwrap().remove("exportedAt");
        current.as_object_mut().unwrap().remove("exportedAt");
        assert_eq!(previous, current);
    }
    #[test]
    fn malformed_legacy_payload_never_creates_destination_database() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("old");
        let destination = temp.path().join("new");
        drop(WorkbenchStore::open(source.clone()).unwrap());
        let db = Connection::open(source.join("workbench.sqlite")).unwrap();
        db.execute(
            "INSERT INTO drafts VALUES('broken','hash','{\"title\":\"\\ud83d\"}')",
            [],
        )
        .unwrap();
        assert!(prepare(&source, &destination).is_err());
        assert!(!destination.join("workbench.sqlite").exists());
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM drafts", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
}
