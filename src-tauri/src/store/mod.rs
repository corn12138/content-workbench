mod backup;
#[cfg(test)]
mod backup_tests;
mod backup_validation;
mod drafts;
pub mod models;
mod records;
#[cfg(test)]
mod tests;
mod validation;

use models::{Draft, Publication, Reading, Snapshot};
use rusqlite::{Connection, OptionalExtension, Params};
use serde::de::DeserializeOwned;
use std::{fs, path::PathBuf};

pub struct WorkbenchStore {
    connection: Connection,
    directory: PathBuf,
}

impl WorkbenchStore {
    pub fn open(directory: PathBuf) -> Result<Self, String> {
        if !directory.exists() {
            fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
                    .map_err(|e| e.to_string())?;
            }
        }
        let connection =
            Connection::open(directory.join("workbench.sqlite")).map_err(|e| e.to_string())?;
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if !matches!(version, 0 | 1) {
            return Err("资料来自更新版本的应用，请升级后打开。".into());
        }
        if version == 0 {
            let existing: i64 = connection.query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'", [], |r| r.get(0)).map_err(|e| e.to_string())?;
            if existing > 0 {
                return Err("资料格式无法识别，未修改原数据库。".into());
            }
            connection.execute_batch("BEGIN IMMEDIATE;
                CREATE TABLE drafts (id TEXT PRIMARY KEY, body_hash TEXT NOT NULL, payload TEXT NOT NULL);
                CREATE INDEX drafts_body_hash ON drafts(body_hash);
                CREATE TABLE revisions (draft_id TEXT NOT NULL REFERENCES drafts(id), revision INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(draft_id, revision));
                CREATE TABLE publications (id TEXT PRIMARY KEY, identity TEXT NOT NULL UNIQUE, draft_id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, FOREIGN KEY(draft_id, revision) REFERENCES revisions(draft_id, revision));
                CREATE TABLE readings (id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, payload TEXT NOT NULL);
                PRAGMA user_version=1; COMMIT;").map_err(|e| e.to_string())?;
        }
        // A current Electron database is opened as-is; schema changes require an explicit future migration.
        for sql in [
            "SELECT id,body_hash,payload FROM drafts LIMIT 0",
            "SELECT draft_id,revision,payload FROM revisions LIMIT 0",
            "SELECT id,identity,draft_id,revision,payload FROM publications LIMIT 0",
            "SELECT id,url,payload FROM readings LIMIT 0",
        ] {
            connection
                .prepare(sql)
                .map_err(|_| "本地资料结构不完整，未迁移。".to_string())?;
        }
        connection
            .execute_batch(
                "PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;",
            )
            .map_err(|e| e.to_string())?;
        Ok(Self {
            connection,
            directory,
        })
    }

    pub fn snapshot(&self) -> Result<Snapshot, String> {
        let mut drafts: Vec<Draft> = self.all("SELECT payload FROM drafts", [])?;
        let mut publications: Vec<Publication> =
            self.all("SELECT payload FROM publications", [])?;
        let mut readings: Vec<Reading> = self.all("SELECT payload FROM readings", [])?;
        drafts.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        publications.sort_by(|a, b| b.confirmed_at.cmp(&a.confirmed_at));
        readings.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(Snapshot {
            drafts,
            publications,
            readings,
        })
    }

    fn one<T: DeserializeOwned>(
        &self,
        sql: &str,
        params: impl Params,
    ) -> Result<Option<T>, String> {
        let value: Option<String> = self
            .connection
            .query_row(sql, params, |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        value
            .map(|s| serde_json::from_str(&s).map_err(|e| format!("本地资料格式无效：{e}")))
            .transpose()
    }

    fn all<T: DeserializeOwned>(&self, sql: &str, params: impl Params) -> Result<Vec<T>, String> {
        let mut statement = self.connection.prepare(sql).map_err(|e| e.to_string())?;
        let rows = statement
            .query_map(params, |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.map(|r| {
            let value = r.map_err(|e| e.to_string())?;
            serde_json::from_str(&value).map_err(|e| format!("本地资料格式无效：{e}"))
        })
        .collect()
    }

    fn transaction<T>(
        &mut self,
        operation: impl FnOnce(&mut Self) -> Result<T, String>,
    ) -> Result<T, String> {
        self.connection
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(|e| e.to_string())?;
        match operation(self) {
            Ok(value) => match self.connection.execute_batch("COMMIT") {
                Ok(()) => Ok(value),
                Err(error) => {
                    let _ = self.connection.execute_batch("ROLLBACK");
                    Err(error.to_string())
                }
            },
            Err(error) => {
                let _ = self.connection.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }
}
