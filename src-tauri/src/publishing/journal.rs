use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::path::Path;

pub struct Journal(Connection);
pub enum Claim {
    New,
    Published(String),
    Uncertain,
}
impl Journal {
    pub fn open(directory: &Path) -> Result<Self, String> {
        let path = directory.join("publish-journal.sqlite");
        let connection = Connection::open(&path).map_err(|_| "无法保存发布记录，本次未发送。")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
                .map_err(|_| "无法保护发布记录，本次未发送。")?;
        }
        // A separate durable journal survives restoring an older article backup. It contains no tokens or article text.
        connection.execute_batch("PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS attempts (identity TEXT PRIMARY KEY, url TEXT);")
            .map_err(|_| "无法准备发布记录，本次未发送。")?;
        Ok(Self(connection))
    }
    pub fn identity(account: &str, draft: &str, text: &str) -> String {
        // Revision-only or whitespace changes must not cause the same content to be sent twice.
        format!(
            "{:x}",
            Sha256::digest(format!("{account}\n{draft}\n{}", text.trim()).as_bytes())
        )
    }
    pub fn claim(&self, id: &str) -> Result<Claim, String> {
        let inserted = self
            .0
            .execute(
                "INSERT OR IGNORE INTO attempts(identity,url) VALUES(?,NULL)",
                [id],
            )
            .map_err(|_| "无法记录发布请求，本次未发送。")?;
        if inserted == 1 {
            return Ok(Claim::New);
        }
        let url: Option<Option<String>> = self
            .0
            .query_row("SELECT url FROM attempts WHERE identity=?", [id], |r| {
                r.get(0)
            })
            .optional()
            .map_err(|_| "无法核实上次发布记录。")?;
        Ok(match url.flatten() {
            Some(url) => Claim::Published(url),
            None => Claim::Uncertain,
        })
    }
    pub fn finish(&self, id: &str, url: &str) -> Result<(), String> {
        self.0
            .execute(
                "UPDATE attempts SET url=? WHERE identity=?",
                params![url, id],
            )
            .map_err(|_| "发布已成功，但本机回执未保存。请保留作品链接。")?;
        Ok(())
    }
    pub fn rejected(&self, id: &str) -> Result<(), String> {
        self.0
            .execute(
                "DELETE FROM attempts WHERE identity=? AND url IS NULL",
                [id],
            )
            .map_err(|_| "无法更新发布状态，请先到 X 核实作品。")?;
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restart_and_success_never_resend_but_explicit_rejection_can_retry() {
        let dir = tempfile::tempdir().unwrap();
        let id = Journal::identity("account", "draft", "body");
        assert_eq!(id, Journal::identity("account", "draft", " body "));
        let journal = Journal::open(dir.path()).unwrap();
        assert!(matches!(journal.claim(&id).unwrap(), Claim::New));
        drop(journal);
        let journal = Journal::open(dir.path()).unwrap();
        assert!(matches!(journal.claim(&id).unwrap(), Claim::Uncertain));
        journal
            .finish(&id, "https://x.com/example/status/123")
            .unwrap();
        assert!(matches!(journal.claim(&id).unwrap(), Claim::Published(_)));
        journal.rejected(&id).unwrap();
        assert!(matches!(journal.claim(&id).unwrap(), Claim::Published(_)));
        assert!(matches!(journal.claim("rejected").unwrap(), Claim::New));
        journal.rejected("rejected").unwrap();
        assert!(matches!(journal.claim("rejected").unwrap(), Claim::New));
    }
}
