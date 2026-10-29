use super::{
    backup_validation::validate_backup,
    drafts::hash_body,
    models::{Backup, Revision, StoredRevision},
    validation, WorkbenchStore,
};
use rusqlite::params;
use std::{fs::OpenOptions, io::Write};
use uuid::Uuid;

impl WorkbenchStore {
    pub fn export_backup(&self) -> Result<String, String> {
        let snapshot = self.snapshot()?;
        let mut statement = self
            .connection
            .prepare("SELECT draft_id, payload FROM revisions ORDER BY draft_id, revision")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        let revisions = rows
            .map(|row| {
                let (id, payload) = row.map_err(|e| e.to_string())?;
                let revision: Revision =
                    serde_json::from_str(&payload).map_err(|e| e.to_string())?;
                Ok(StoredRevision::from_revision(id, revision))
            })
            .collect::<Result<Vec<_>, String>>()?;
        let backup = Backup {
            format: "content-workbench".into(),
            version: 1,
            exported_at: validation::now(),
            drafts: snapshot.drafts,
            revisions,
            publications: snapshot.publications,
            readings: snapshot.readings,
        };
        let json = serde_json::to_string_pretty(&backup).map_err(|e| e.to_string())?;
        if json.len() > validation::MAX_BACKUP_BYTES {
            return Err(
                "资料超过当前 25 MB 内容备份上限，请先分别导出文章，暂不支持完整恢复。".into(),
            );
        }
        Ok(json)
    }

    pub fn restore_backup(&mut self, json: &str) -> Result<(), String> {
        let backup = validate_backup(json)?;
        // The recovery copy must be complete and durable before the transaction can replace user data.
        let recovery = self.export_backup()?;
        let filename = format!(
            "before-restore-{}-{}.json",
            validation::now().replace([':', '.'], "-"),
            Uuid::new_v4()
        );
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(self.directory.join(filename))
            .map_err(|e| e.to_string())?;
        file.write_all(recovery.as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        self.transaction(|store| store.replace_contents(backup))
    }

    fn replace_contents(&mut self, backup: Backup) -> Result<(), String> {
        self.connection.execute_batch("DELETE FROM publications; DELETE FROM revisions; DELETE FROM drafts; DELETE FROM readings;").map_err(|e| e.to_string())?;
        for draft in backup.drafts {
            self.connection
                .execute(
                    "INSERT INTO drafts(id, body_hash, payload) VALUES(?, ?, ?)",
                    params![
                        draft.id,
                        hash_body(&draft.body),
                        serde_json::to_string(&draft).map_err(|e| e.to_string())?
                    ],
                )
                .map_err(|e| e.to_string())?;
        }
        for stored in backup.revisions {
            let revision = stored.as_revision();
            self.connection
                .execute(
                    "INSERT INTO revisions(draft_id, revision, payload) VALUES(?, ?, ?)",
                    params![
                        stored.draft_id,
                        revision.revision,
                        serde_json::to_string(&revision).map_err(|e| e.to_string())?
                    ],
                )
                .map_err(|e| e.to_string())?;
        }
        for publication in backup.publications {
            let identity = validation::publication_url(&publication.url)?.identity;
            self.connection.execute("INSERT INTO publications(id, identity, draft_id, revision, payload) VALUES(?, ?, ?, ?, ?)",
                params![publication.id, identity, publication.draft_id, publication.draft_revision, serde_json::to_string(&publication).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
        }
        for reading in backup.readings {
            self.connection
                .execute(
                    "INSERT INTO readings(id, url, payload) VALUES(?, ?, ?)",
                    params![
                        reading.id,
                        reading.url,
                        serde_json::to_string(&reading).map_err(|e| e.to_string())?
                    ],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}
