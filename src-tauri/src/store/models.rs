use serde::{Deserialize, Deserializer, Serialize};

fn present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Draft {
    pub id: String,
    pub title: String,
    pub body: String,
    pub project: String,
    pub revision: i64,
    pub archived: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DraftInput {
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub id: Option<String>,
    pub title: String,
    pub body: String,
    pub project: String,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub expected_revision: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Revision {
    pub revision: i64,
    pub title: String,
    pub body: String,
    pub project: String,
    pub saved_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Publication {
    pub id: String,
    pub draft_id: String,
    pub draft_revision: i64,
    pub title: String,
    pub platform: String,
    pub url: String,
    pub confirmed_at: String,
    pub confirmation: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Reading {
    pub id: String,
    pub url: String,
    pub title: String,
    pub note: String,
    pub read: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadingInput {
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub id: Option<String>,
    pub url: String,
    pub title: String,
    pub note: String,
    pub read: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub drafts: Vec<Draft>,
    pub publications: Vec<Publication>,
    pub readings: Vec<Reading>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportResult {
    pub draft: Draft,
    pub duplicate: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoredRevision {
    pub draft_id: String,
    pub revision: i64,
    pub title: String,
    pub body: String,
    pub project: String,
    pub saved_at: String,
}

impl StoredRevision {
    pub fn from_revision(draft_id: String, value: Revision) -> Self {
        Self {
            draft_id,
            revision: value.revision,
            title: value.title,
            body: value.body,
            project: value.project,
            saved_at: value.saved_at,
        }
    }

    pub fn as_revision(&self) -> Revision {
        Revision {
            revision: self.revision,
            title: self.title.clone(),
            body: self.body.clone(),
            project: self.project.clone(),
            saved_at: self.saved_at.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Backup {
    pub format: String,
    pub version: i64,
    pub exported_at: String,
    pub drafts: Vec<Draft>,
    pub revisions: Vec<StoredRevision>,
    pub publications: Vec<Publication>,
    pub readings: Vec<Reading>,
}
