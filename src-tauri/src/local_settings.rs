//! Machine-specific settings kept beside the database but never inside portable content backups:
//! the last backup location and the public X Client ID. Neither is a secret.
use crate::files::atomic_write;
use serde::{Deserialize, Serialize};
use std::{fs, io::Read, path::Path};

const FILE: &str = "local-settings.json";

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRecord {
    pub path: String,
    pub filename: String,
    pub size: u64,
    pub saved_at: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSettings {
    #[serde(default)]
    pub last_backup: Option<BackupRecord>,
    #[serde(default)]
    pub x_client_id: Option<String>,
}

pub fn read(directory: &Path) -> LocalSettings {
    let mut bytes = Vec::new();
    // A missing or damaged file only loses these conveniences; it never blocks the app.
    if fs::File::open(directory.join(FILE))
        .and_then(|f| f.take(64 * 1024).read_to_end(&mut bytes))
        .is_err()
    {
        return LocalSettings::default();
    }
    serde_json::from_slice(&bytes).unwrap_or_default()
}

pub fn update(
    directory: &Path,
    change: impl FnOnce(&mut LocalSettings),
) -> Result<LocalSettings, String> {
    let mut settings = read(directory);
    change(&mut settings);
    atomic_write(
        &directory.join(FILE),
        &serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?,
    )?;
    Ok(settings)
}

#[cfg(test)]
mod tests {
    #[test]
    fn damaged_settings_fall_back_and_updates_persist() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(super::FILE), b"{broken").unwrap();
        assert_eq!(super::read(dir.path()), super::LocalSettings::default());
        super::update(dir.path(), |s| s.x_client_id = Some("public".into())).unwrap();
        assert_eq!(
            super::read(dir.path()).x_client_id.as_deref(),
            Some("public")
        );
    }
}
