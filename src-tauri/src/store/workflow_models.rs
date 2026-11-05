use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Per-image outcome of local image preparation. "ready" only means a local upload copy exists;
/// it never claims the platform received the image.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedImage {
    /// 1-based position of the image in the article body.
    pub position: i64,
    /// Display label: the remote address or "本地图片"; never a machine path.
    pub source: String,
    pub filename: Option<String>,
    pub status: String,
    pub error: Option<String>,
}

/// Unfinished publishing preparation for one draft and platform. It is bound to the draft revision
/// it was checked against; `content_hash` covers title and body, and because stored images are
/// content-addressed (`assets/<sha256>`), the body hash is also the resource fingerprint.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Preparation {
    pub draft_id: String,
    pub platform: String,
    pub revision: i64,
    pub content_hash: String,
    #[serde(default)]
    pub x_text: Option<String>,
    #[serde(default)]
    pub x_mode: Option<String>,
    #[serde(default)]
    pub pending_url: String,
    #[serde(default)]
    pub images: Vec<PreparedImage>,
    #[serde(default)]
    pub images_revision: Option<i64>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparationInput {
    pub draft_id: String,
    pub platform: String,
    pub revision: i64,
    #[serde(default)]
    pub x_text: Option<String>,
    #[serde(default)]
    pub x_mode: Option<String>,
    #[serde(default)]
    pub pending_url: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NoteSource {
    pub reading_id: String,
    pub title: String,
    pub url: String,
}

/// Links a draft composed from reading notes to the notes it came from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DraftSources {
    pub draft_id: String,
    pub compose_key: String,
    pub sources: Vec<NoteSource>,
    pub created_at: String,
}

/// One feedback observation for a publication. A missing or null metric is unknown; zero is only
/// stored when entered or returned explicitly. Field names follow each platform's own meaning.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Feedback {
    pub id: String,
    pub publication_id: String,
    pub platform: String,
    pub source: String,
    pub observed_at: String,
    pub metrics: BTreeMap<String, Option<i64>>,
    #[serde(default)]
    pub note: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeedbackInput {
    pub publication_id: String,
    pub observed_at: String,
    pub metrics: BTreeMap<String, Option<i64>>,
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Workflow {
    #[serde(default)]
    pub preparations: Vec<Preparation>,
    #[serde(default)]
    pub sources: Vec<DraftSources>,
    #[serde(default)]
    pub feedback: Vec<Feedback>,
}

pub fn metric_names(platform: &str) -> &'static [&'static str] {
    match platform {
        // Juejin article page counters as shown to authors.
        "juejin" => &["views", "likes", "comments", "collects"],
        // X public_metrics names; impressions are not the same measure as Juejin views.
        "x" => &[
            "impressions",
            "likes",
            "replies",
            "reposts",
            "quotes",
            "bookmarks",
        ],
        _ => &[],
    }
}
