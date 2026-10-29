use super::{
    feed_models::{Feed, FeedItem, Library},
    models::{Reading, ReadingInput},
    validation, WorkbenchStore,
};
use rusqlite::params;
use std::collections::HashSet;

pub fn validate_library(library: &Library, readings: &[Reading]) -> Result<(), String> {
    if library.feeds.len() > 1000
        || library.feeds.iter().filter(|feed| feed.enabled).count() > 50
        || library.items.len() > 20_000
    {
        return Err("订阅资料超过当前支持范围。".into());
    }
    let mut ids = HashSet::new();
    let mut urls = HashSet::new();
    for feed in &library.feeds {
        if validation::assert_id(&feed.id).is_err()
            || !ids.insert(&feed.id)
            || !urls.insert(&feed.url)
            || crate::feed_fetch::feed_url(&feed.url).is_err()
            || feed.title.chars().count() > 200
            || [&feed.etag, &feed.last_modified, &feed.error]
                .iter()
                .any(|s| {
                    s.as_ref()
                        .is_some_and(|s| s.len() > 1024 || s.contains(['\r', '\n']))
                })
            || feed
                .checked_at
                .as_ref()
                .is_some_and(|s| chrono::DateTime::parse_from_rfc3339(s).is_err())
        {
            return Err("订阅设置无效。".into());
        }
    }
    let reading_ids: HashSet<_> = readings.iter().map(|r| &r.id).collect();
    let mut keys = HashSet::new();
    for item in &library.items {
        if !ids.contains(&item.feed_id)
            || !keys.insert((&item.feed_id, &item.key))
            || item.key.len() != 64
            || !item.key.bytes().all(|c| c.is_ascii_hexdigit())
            || item.title.chars().count() > 200
            || item.summary.chars().count() > 20_000
            || validation::normalize_reading_url(&item.url).is_err()
            || item
                .reading_id
                .as_ref()
                .is_some_and(|id| !reading_ids.contains(id))
            || item
                .published_at
                .as_ref()
                .is_some_and(|s| chrono::DateTime::parse_from_rfc3339(s).is_err())
        {
            return Err("订阅文章或关联记录无效。".into());
        }
    }
    Ok(())
}

impl WorkbenchStore {
    pub fn library(&self) -> Result<Library, String> {
        Ok(Library {
            feeds: self.all("SELECT payload FROM feeds ORDER BY url", [])?,
            items: self.all(
                "SELECT payload FROM feed_items ORDER BY feed_id,item_key",
                [],
            )?,
        })
    }

    pub fn feed(&self, id: &str) -> Result<Feed, String> {
        validation::assert_id(id)?;
        self.one("SELECT payload FROM feeds WHERE id=?", [id])?
            .ok_or_else(|| "订阅已取消。".into())
    }

    fn put_feed(&self, feed: &Feed) -> Result<(), String> {
        self.connection.execute("INSERT INTO feeds(id,url,payload) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET url=excluded.url,payload=excluded.payload", params![feed.id, feed.url, serde_json::to_string(feed).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn put_item(&self, item: &FeedItem) -> Result<(), String> {
        self.connection.execute("INSERT INTO feed_items(feed_id,item_key,reading_id,payload) VALUES(?,?,?,?) ON CONFLICT(feed_id,item_key) DO UPDATE SET reading_id=excluded.reading_id,payload=excluded.payload", params![item.feed_id, item.key, item.reading_id, serde_json::to_string(item).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub(super) fn replace_library(&self, library: Library) -> Result<(), String> {
        for feed in library.feeds {
            self.put_feed(&feed)?;
        }
        for item in library.items {
            self.put_item(&item)?;
        }
        Ok(())
    }

    pub fn unsubscribe(&mut self, id: &str) -> Result<(), String> {
        let mut feed = self.feed(id)?;
        // Keep the source and cached content so unsubscribing cannot erase offline reading or notes.
        feed.enabled = false;
        self.put_feed(&feed)
    }

    pub(super) fn detach_reading(&self, id: &str) -> Result<(), String> {
        let mut items: Vec<FeedItem> =
            self.all("SELECT payload FROM feed_items WHERE reading_id=?", [id])?;
        for item in &mut items {
            item.reading_id = None;
            self.put_item(item)?;
        }
        Ok(())
    }

    pub fn add_feed(
        &mut self,
        url: &str,
        parsed: crate::feed_parse::ParsedFeed,
    ) -> Result<Feed, String> {
        let library = self.library()?;
        if let Some(feed) = library
            .feeds
            .iter()
            .find(|feed| feed.url == url && feed.enabled)
        {
            return Ok(feed.clone());
        }
        if library.feeds.iter().filter(|feed| feed.enabled).count() >= 50 {
            return Err("当前最多同时订阅 50 个来源。".into());
        }
        if let Some(previous) = library.feeds.iter().find(|feed| feed.url == url) {
            let feed = Feed {
                enabled: true,
                ..previous.clone()
            };
            return self.transaction(|store| {
                store.put_feed(&feed)?;
                store.apply_feed(&feed, parsed, None, None)
            });
        }
        if library.feeds.len() >= 1000 {
            return Err("已保存的订阅来源达到上限，请先整理资料。".into());
        }
        let feed = Feed {
            id: uuid::Uuid::new_v4().to_string(),
            enabled: true,
            url: url.into(),
            title: parsed.title.clone(),
            checked_at: None,
            etag: None,
            last_modified: None,
            error: None,
        };
        self.transaction(|store| {
            store.put_feed(&feed)?;
            store.apply_feed(&feed, parsed, None, None)
        })
    }

    pub fn apply_feed(
        &mut self,
        previous: &Feed,
        parsed: crate::feed_parse::ParsedFeed,
        etag: Option<String>,
        last_modified: Option<String>,
    ) -> Result<Feed, String> {
        self.transaction(|store| {
            let current = store.feed(&previous.id)?;
            if !current.enabled {
                return Err("订阅已取消。".into());
            }
            // Concurrent refreshes and restore must not let an older response replace newer state.
            if current != *previous {
                return Ok(current);
            }
            for entry in parsed.items {
                let old: Option<FeedItem> = store.one(
                    "SELECT payload FROM feed_items WHERE feed_id=? AND item_key=?",
                    params![previous.id, entry.key],
                )?;
                let reading_id = if let Some(old) = old {
                    old.reading_id
                } else {
                    // URL deduplication keeps the user's existing notes and read status intact.
                    Some(
                        store
                            .save_reading(ReadingInput {
                                id: None,
                                url: entry.url.clone(),
                                title: entry.title.clone(),
                                note: String::new(),
                                read: false,
                            })?
                            .id,
                    )
                };
                store.put_item(&FeedItem {
                    feed_id: previous.id.clone(),
                    key: entry.key,
                    reading_id,
                    title: entry.title,
                    url: entry.url,
                    summary: entry.summary,
                    published_at: entry.published_at,
                })?;
            }
            let count: i64 = store
                .connection
                .query_row("SELECT COUNT(*) FROM readings", [], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            if count > 20_000 {
                return Err("阅读资料已达到当前上限，请先整理后再更新。".into());
            }
            let total: i64 = store
                .connection
                .query_row("SELECT COUNT(*) FROM feed_items", [], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            if total > 20_000 {
                return Err("订阅文章已达到当前上限。".into());
            }
            let feed = Feed {
                title: parsed.title,
                checked_at: Some(validation::now()),
                etag,
                last_modified,
                error: None,
                ..previous.clone()
            };
            store.put_feed(&feed)?;
            if serde_json::to_vec(&store.library()?)
                .map_err(|e| e.to_string())?
                .len()
                > super::archive::MAX_LIBRARY_BYTES
            {
                return Err(
                    "订阅内容已达到当前容量上限，本次更新未保存。请先备份现有资料。".into(),
                );
            }
            Ok(feed)
        })
    }

    pub fn feed_status(&mut self, previous: &Feed, error: Option<String>) -> Result<Feed, String> {
        let current = self.feed(&previous.id)?;
        if !current.enabled {
            return Err("订阅已取消。".into());
        }
        if current != *previous {
            return Ok(current);
        }
        let feed = Feed {
            checked_at: Some(validation::now()),
            error,
            ..previous.clone()
        };
        self.put_feed(&feed)?;
        Ok(feed)
    }
}
