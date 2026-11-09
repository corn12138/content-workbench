use super::{
    tests::{draft, fixture, reading},
    WorkbenchStore,
};
use crate::feed_parse::{ParsedEntry, ParsedFeed};
use sha2::{Digest, Sha256};

fn count(store: &WorkbenchStore, sql: &str) -> i64 {
    store.connection.query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
fn deleted_draft_hides_and_undo_brings_it_back() {
    let (_dir, mut store) = fixture();
    let d = store.save_draft(draft("草稿", "正文")).unwrap();
    store.remove_draft(&d.id).unwrap();
    assert!(store.snapshot().unwrap().drafts.is_empty());
    assert!(store.get_draft(&d.id).is_err());
    assert!(store.archive_draft(&d.id, true).is_err());
    assert!(store.remove_draft(&d.id).is_err());
    let back = store.restore_removed_draft(&d.id).unwrap();
    assert_eq!(back, d);
    assert!(store.restore_removed_draft(&d.id).is_err());
    assert_eq!(store.snapshot().unwrap().drafts, vec![d]);
}

#[test]
fn unpublished_draft_is_erased_on_reopen_and_left_out_of_backups() {
    let (dir, mut store) = fixture();
    let keep = store.save_draft(draft("保留", "留下")).unwrap();
    let d = store.save_draft(draft("删除", "第一版")).unwrap();
    store
        .save_draft(super::tests::edit(&d, "删除", "第二版"))
        .unwrap();
    store.remove_draft(&d.id).unwrap();
    // Backups taken during the undo window already leave it out.
    let backup = store.export_full_backup().unwrap();
    let summary = WorkbenchStore::inspect_backup(&backup).unwrap().summary;
    assert_eq!((summary.drafts, summary.revisions), (1, 1));
    // Importing the same text again creates a fresh draft rather than reviving the deleted one.
    drop(store);
    let store = WorkbenchStore::open(dir.path().into()).unwrap();
    assert_eq!(count(&store, "SELECT count(*) FROM drafts"), 1);
    assert_eq!(count(&store, "SELECT count(*) FROM revisions"), 1);
    assert_eq!(count(&store, "SELECT count(*) FROM removed_drafts"), 0);
    assert_eq!(store.snapshot().unwrap().drafts, vec![keep]);
}

#[test]
fn published_draft_keeps_records_and_version_after_delete_and_backup() {
    let (dir, mut store) = fixture();
    let d = store.save_draft(draft("作品", "发布的正文")).unwrap();
    let p = store
        .record_publication(&d.id, 1, "https://juejin.cn/post/42")
        .unwrap();
    store.remove_draft(&d.id).unwrap();
    drop(store);
    let mut store = WorkbenchStore::open(dir.path().into()).unwrap();
    let snapshot = store.snapshot().unwrap();
    assert!(snapshot.drafts.is_empty());
    assert_eq!(snapshot.publications, vec![p.clone()]);
    assert_eq!(store.workflow().unwrap().removed_drafts.len(), 1);
    assert_eq!(store.revisions(&d.id).unwrap()[0].body, "发布的正文");

    let backup = store.export_full_backup().unwrap();
    let summary = WorkbenchStore::inspect_backup(&backup).unwrap().summary;
    assert_eq!((summary.drafts, summary.publications), (0, 1));
    let (_other, mut fresh) = fixture();
    fresh.restore_full_backup(&backup).unwrap();
    assert!(fresh.snapshot().unwrap().drafts.is_empty());
    assert_eq!(fresh.snapshot().unwrap().publications, vec![p.clone()]);
    assert_eq!(fresh.workflow().unwrap(), store.workflow().unwrap());

    // Removing the last record lets the hidden draft be erased at the next open.
    store.remove_publication(&p.id).unwrap();
    drop(store);
    let store = WorkbenchStore::open(dir.path().into()).unwrap();
    assert_eq!(count(&store, "SELECT count(*) FROM drafts"), 0);
}

#[test]
fn backups_without_deletions_keep_the_0_5_workflow_shape() {
    let (_dir, mut store) = fixture();
    store.save_draft(draft("作品", "正文")).unwrap();
    let json = serde_json::to_string(&store.workflow().unwrap()).unwrap();
    assert!(!json.contains("removedDrafts"));
}

#[test]
fn composing_the_same_notes_after_deleting_the_result_makes_a_new_draft() {
    let (_dir, mut store) = fixture();
    let r = store
        .save_reading(reading("https://example.com/a", "笔记"))
        .unwrap();
    let (first, _) = store.compose_notes(&[r.id.clone()]).unwrap();
    store.remove_draft(&first.id).unwrap();
    let (second, duplicate) = store.compose_notes(&[r.id]).unwrap();
    assert!(!duplicate);
    assert_ne!(second.id, first.id);
}

#[test]
fn schema_five_upgrade_keeps_a_standalone_copy() {
    let (dir, store) = fixture();
    store
        .connection
        .execute_batch("DROP TABLE removed_drafts; PRAGMA user_version=5")
        .unwrap();
    drop(store);
    WorkbenchStore::open(dir.path().into()).unwrap();
    let copies: Vec<_> = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|p| p.unwrap().path())
        .filter(|p| {
            p.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("before-delete-upgrade-")
        })
        .collect();
    assert_eq!(copies.len(), 1);
    let old = rusqlite::Connection::open(&copies[0]).unwrap();
    assert_eq!(
        old.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        5
    );
}

fn feed(urls: &[&str]) -> ParsedFeed {
    ParsedFeed {
        title: "Feed".into(),
        items: urls
            .iter()
            .map(|url| ParsedEntry {
                key: format!("{:x}", Sha256::digest(url.as_bytes())),
                url: (*url).into(),
                title: "Article".into(),
                summary: "summary".into(),
                content: None,
                published_at: None,
            })
            .collect(),
    }
}

#[test]
fn deleting_a_feed_removes_its_articles_but_keeps_notes_and_shared_ones() {
    let (_dir, mut store) = fixture();
    let noted = "https://example.com/noted";
    let plain = "https://example.com/plain";
    let shared = "https://example.com/shared";
    store.save_reading(reading(noted, "我的笔记")).unwrap();
    let f = store
        .add_feed("https://example.com/a.xml", feed(&[noted, plain, shared]))
        .unwrap();
    store
        .add_feed("https://example.com/b.xml", feed(&[shared]))
        .unwrap();
    store.delete_feed(&f.id, false).unwrap();
    let mut urls: Vec<_> = store
        .snapshot()
        .unwrap()
        .readings
        .into_iter()
        .map(|r| r.url)
        .collect();
    urls.sort();
    assert_eq!(urls, vec![noted.to_string(), shared.to_string()]);
    let library = store.library().unwrap();
    assert_eq!(library.feeds.len(), 1);
    assert!(library.items.iter().all(|i| i.feed_id != f.id));
    assert!(store.delete_feed(&f.id, false).is_err());

    let f = store
        .add_feed("https://example.com/a.xml", feed(&[noted]))
        .unwrap();
    store.delete_feed(&f.id, true).unwrap();
    assert!(store
        .snapshot()
        .unwrap()
        .readings
        .iter()
        .all(|r| r.url != noted));
}
