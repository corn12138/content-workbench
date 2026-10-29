use super::{
    models::ReadingInput,
    tests::{fixture, reading},
};
use crate::feed_parse::{ParsedEntry, ParsedFeed};
use sha2::{Digest, Sha256};

fn parsed(summary: &str) -> ParsedFeed {
    let url = "https://example.com/article";
    ParsedFeed {
        title: "Test feed".into(),
        items: vec![ParsedEntry {
            key: format!("{:x}", Sha256::digest(url.as_bytes())),
            url: url.into(),
            title: "Source title".into(),
            summary: summary.into(),
            published_at: None,
        }],
    }
}

#[test]
fn refresh_preserves_notes_and_read_status_and_deleted_articles_stay_deleted() {
    let (_directory, mut store) = fixture();
    let original = store
        .save_reading(reading("https://example.com/article", "我的笔记"))
        .unwrap();
    let feed = store
        .add_feed("https://example.com/feed.xml", parsed("first"))
        .unwrap();
    assert_eq!(store.snapshot().unwrap().readings, [original.clone()]);
    let feed = store
        .apply_feed(&feed, parsed("new summary"), Some("etag".into()), None)
        .unwrap();
    assert_eq!(store.library().unwrap().items[0].summary, "new summary");
    assert_eq!(store.snapshot().unwrap().readings, [original.clone()]);
    store.delete_reading(&original.id).unwrap();
    store
        .apply_feed(&feed, parsed("should not recreate"), None, None)
        .unwrap();
    assert!(store.snapshot().unwrap().readings.is_empty());
    assert!(store.library().unwrap().items[0].reading_id.is_none());
    let backup = store.export_full_backup().unwrap();
    store.restore_full_backup(&backup).unwrap();
    assert!(store.library().unwrap().items[0].reading_id.is_none());
}

#[test]
fn subscriptions_summaries_and_notes_roundtrip_and_unsubscribe_preserves_reading() {
    let (_directory, mut store) = fixture();
    let feed = store
        .add_feed("https://example.com/feed.xml", parsed("source content"))
        .unwrap();
    let reading = store.snapshot().unwrap().readings[0].clone();
    store
        .save_reading(ReadingInput {
            id: Some(reading.id),
            url: reading.url,
            title: "我的标题".into(),
            note: "自己的想法".into(),
            read: true,
        })
        .unwrap();
    let expected = store.snapshot().unwrap();
    let library = store.library().unwrap();
    let backup = store.export_full_backup().unwrap();
    store.unsubscribe(&feed.id).unwrap();
    assert!(!store.library().unwrap().feeds[0].enabled);
    assert_eq!(store.library().unwrap().items[0].summary, "source content");
    assert_eq!(store.snapshot().unwrap(), expected);
    assert!(store
        .apply_feed(&feed, parsed("stale refresh"), None, None)
        .is_err());
    store.restore_full_backup(&backup).unwrap();
    assert_eq!(store.snapshot().unwrap(), expected);
    assert_eq!(store.library().unwrap(), library);
}

#[test]
fn stale_refresh_and_failed_restore_do_not_replace_newer_library() {
    let (_directory, mut store) = fixture();
    let original = store
        .add_feed("https://example.com/feed.xml", parsed("old"))
        .unwrap();
    let current = store
        .apply_feed(&original, parsed("latest"), Some("new".into()), None)
        .unwrap();
    assert_eq!(
        store
            .apply_feed(&original, parsed("stale"), None, None)
            .unwrap(),
        current
    );
    assert_eq!(store.library().unwrap().items[0].summary, "latest");
    let backup = store.export_full_backup().unwrap();
    let before = store.library().unwrap();
    store.connection.execute_batch("CREATE TRIGGER fail_restore BEFORE INSERT ON feeds BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
    assert!(store.restore_full_backup(&backup).is_err());
    assert_eq!(store.library().unwrap(), before);
    assert_eq!(store.snapshot().unwrap().readings.len(), 1);
}
