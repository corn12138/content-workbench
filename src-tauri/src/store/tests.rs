use super::{
    models::{Draft, DraftInput, ReadingInput},
    WorkbenchStore,
};
use tempfile::TempDir;

pub(super) fn fixture() -> (TempDir, WorkbenchStore) {
    let directory = tempfile::tempdir().unwrap();
    let store = WorkbenchStore::open(directory.path().into()).unwrap();
    (directory, store)
}

pub(super) fn draft(title: &str, body: &str) -> DraftInput {
    DraftInput {
        id: None,
        title: title.into(),
        body: body.into(),
        project: String::new(),
        expected_revision: None,
    }
}

pub(super) fn edit(previous: &Draft, title: &str, body: &str) -> DraftInput {
    DraftInput {
        id: Some(previous.id.clone()),
        expected_revision: Some(previous.revision),
        ..draft(title, body)
    }
}

pub(super) fn reading(url: &str, note: &str) -> ReadingInput {
    ReadingInput {
        id: None,
        url: url.into(),
        title: "参考资料".into(),
        note: note.into(),
        read: true,
    }
}

#[test]
fn content_and_immutable_revisions_survive_reopen() {
    let (directory, mut store) = fixture();
    let first = store.save_draft(draft("首篇文章", "# 内容")).unwrap();
    let second = store
        .save_draft(edit(&first, &first.title, "新的正文"))
        .unwrap();
    assert_eq!(second.revision, 2);
    drop(store);
    let mut store = WorkbenchStore::open(directory.path().into()).unwrap();
    assert_eq!(store.snapshot().unwrap().drafts, [second.clone()]);
    assert_eq!(store.revisions(&first.id).unwrap()[1].body, first.body);
    let restored = store.restore_revision(&first.id, 1, 2).unwrap();
    assert_eq!(restored.revision, 3);
    assert_eq!(restored.body, first.body);
    assert_eq!(store.revisions(&first.id).unwrap()[1].body, second.body);
}

#[test]
fn stale_saves_and_restores_preserve_newer_text() {
    let (_directory, mut store) = fixture();
    let first = store.save_draft(draft("", "第一版")).unwrap();
    let second = store
        .save_draft(edit(&first, &first.title, "第二版"))
        .unwrap();
    assert!(store
        .save_draft(edit(&first, "过期编辑", "旧内容"))
        .unwrap_err()
        .contains("稿件已发生变化"));
    let mut missing = edit(&first, "无版本", "");
    missing.expected_revision = None;
    assert!(store
        .save_draft(missing)
        .unwrap_err()
        .contains("稿件已发生变化"));
    assert!(store.restore_revision(&first.id, 1, 1).is_err());
    assert_eq!(store.snapshot().unwrap().drafts, [second]);
    assert_eq!(store.revisions(&first.id).unwrap().len(), 2);
}

#[test]
fn duplicate_import_reopens_archive_without_new_revision() {
    let (_directory, mut store) = fixture();
    let original = store
        .import_markdown("notes.md", "# 我的技术文章\n\n正文")
        .unwrap();
    assert_eq!(original.draft.title, "我的技术文章");
    store.archive_draft(&original.draft.id, true).unwrap();
    let repeated = store
        .import_markdown("different.md", &original.draft.body)
        .unwrap();
    assert!(repeated.duplicate);
    assert!(!repeated.draft.archived);
    assert_eq!(repeated.draft.id, original.draft.id);
    assert_eq!(store.revisions(&original.draft.id).unwrap().len(), 1);
    let changed = store
        .import_markdown("notes.md", "# 我的技术文章\n\n另一段正文")
        .unwrap();
    assert_ne!(changed.draft.id, original.draft.id);
}

#[test]
fn markdown_images_warn_without_blocking_text_import() {
    let (_directory, mut store) = fixture();
    for text in [
        "# 图\n![截图](./shot.png)",
        "<img src=\"./shot.png\">",
        "![参考图][asset]",
    ] {
        assert_eq!(
            store
                .import_markdown("image.md", text)
                .unwrap()
                .warnings
                .len(),
            1
        );
    }
    assert!(store
        .import_markdown("plain.md", "# 纯文字")
        .unwrap()
        .warnings
        .is_empty());
}

#[test]
fn unchanged_content_does_not_append_history() {
    let (_directory, mut store) = fixture();
    let value = store.save_draft(draft("文章", "同样的正文")).unwrap();
    assert_eq!(
        store
            .save_draft(edit(&value, " 文章 ", &value.body))
            .unwrap(),
        value
    );
    assert_eq!(store.revisions(&value.id).unwrap().len(), 1);
}

#[test]
fn publication_uses_historical_title_and_stable_post_identity() {
    let (_directory, mut store) = fixture();
    let first = store.save_draft(draft("发布前标题", "最初文章")).unwrap();
    store
        .save_draft(edit(&first, "修改后标题", "后续文章"))
        .unwrap();
    let publication = store
        .record_publication(
            &first.id,
            1,
            "https://juejin.cn/post/123456?utm_source=test#comment",
        )
        .unwrap();
    assert_eq!(publication.title, first.title);
    assert_eq!(publication.confirmation, "manual");
    assert_eq!(publication.url, "https://juejin.cn/post/123456");
    assert_eq!(
        store
            .record_publication(&first.id, 1, "https://juejin.cn/post/123456/")
            .unwrap(),
        publication
    );
    assert!(store
        .record_publication(&first.id, 2, &publication.url)
        .unwrap_err()
        .contains("已关联"));
    let x = store
        .record_publication(&first.id, 1, "https://x.com/first/status/9876")
        .unwrap();
    assert_eq!(
        store
            .record_publication(&first.id, 1, "https://x.com/renamed/status/9876")
            .unwrap(),
        x
    );
    assert!(store
        .record_publication(&first.id, 99, "https://x.com/test/status/12")
        .is_err());
}

#[test]
fn invalid_publication_urls_never_create_records() {
    let (_directory, mut store) = fixture();
    let value = store.save_draft(draft("文章", "内容")).unwrap();
    for url in [
        "https://juejin.cn.evil.example/post/123",
        "https://user:pw@juejin.cn/post/123",
        "http://juejin.cn/post/123",
        "https://juejin.cn/editor/drafts/new",
        "https://x.com/home",
        "https://juejin.cn:123/post/123",
        "javascript:alert(1)",
    ] {
        assert!(
            store.record_publication(&value.id, 1, url).is_err(),
            "accepted {url}"
        );
    }
    assert!(store.snapshot().unwrap().publications.is_empty());
}

#[test]
fn bookmark_duplicates_preserve_notes_and_read_status() {
    let (_directory, mut store) = fixture();
    let first = store
        .save_reading(reading(
            "https://Example.COM:443/docs?q=a#section",
            "保留这条结论",
        ))
        .unwrap();
    let mut repeated = reading("https://example.com/docs?q=a#section", "");
    repeated.read = false;
    assert_eq!(store.save_reading(repeated).unwrap(), first);
    assert_eq!(store.snapshot().unwrap().readings.len(), 1);
    assert!(store
        .save_reading(reading("file:///etc/passwd", ""))
        .is_err());
    let second = store
        .save_reading(reading("https://example.com/other", "其它"))
        .unwrap();
    let mut conflict = reading(&first.url, "不得覆盖");
    conflict.id = Some(second.id.clone());
    assert!(store.save_reading(conflict).is_err());
    store.delete_reading(&second.id).unwrap();
    assert_eq!(store.snapshot().unwrap().readings, [first]);
}

#[test]
fn reading_to_draft_keeps_attribution_and_deduplicates() {
    let (_directory, mut store) = fixture();
    let value = store
        .save_reading(reading("https://example.com/article", "这个实验值得尝试。"))
        .unwrap();
    let draft = store.reading_to_draft(&value.id).unwrap();
    assert_eq!(
        draft.body,
        "# 参考资料\n\n这个实验值得尝试。\n\n来源：https://example.com/article\n"
    );
    assert_eq!(store.reading_to_draft(&value.id).unwrap().id, draft.id);
    let empty = store
        .save_reading(reading("https://example.com/empty", " \u{feff}"))
        .unwrap();
    assert!(store
        .reading_to_draft(&empty.id)
        .unwrap_err()
        .contains("先写下一条收获"));
}

#[test]
fn input_validation_preserves_schema_scalars_explicit_utf16_limits_and_strict_dtos() {
    let (_directory, mut store) = fixture();
    assert!(store.save_draft(draft(&"😀".repeat(201), "")).is_err());
    assert!(store.save_draft(draft(&"😀".repeat(200), "")).is_ok());
    assert!(store
        .import_markdown("notes.md", &"😀".repeat(500_001))
        .is_err());
    assert!(store
        .save_reading(reading("https://example.com", &"😀".repeat(1_000_001)))
        .is_err());
    for json in [
        r#"{"title":"","body":"","project":"","extra":true}"#,
        r#"{"id":null,"title":"","body":"","project":""}"#,
        r#"{"expectedRevision":null,"title":"","body":"","project":""}"#,
    ] {
        assert!(serde_json::from_str::<DraftInput>(json).is_err());
    }
    assert!(store.revisions("not-a-uuid").is_err());
}

#[test]
fn future_database_is_rejected_without_changing_schema() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("workbench.sqlite");
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection.execute_batch("PRAGMA user_version=3; CREATE TABLE future_only(value TEXT); INSERT INTO future_only VALUES('保留');").unwrap();
    drop(connection);
    assert!(WorkbenchStore::open(directory.path().into()).is_err());
    let connection = rusqlite::Connection::open(path).unwrap();
    let version: i64 = connection
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    let value: String = connection
        .query_row("SELECT value FROM future_only", [], |r| r.get(0))
        .unwrap();
    assert_eq!(version, 3);
    assert_eq!(value, "保留");
}
