use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Feed {
    pub id: String,
    pub enabled: bool,
    pub url: String,
    pub title: String,
    pub checked_at: Option<String>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeedItem {
    pub feed_id: String,
    pub key: String,
    pub reading_id: Option<String>,
    pub title: String,
    pub url: String,
    pub summary: String,
    pub published_at: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Library {
    pub feeds: Vec<Feed>,
    pub items: Vec<FeedItem>,
}
