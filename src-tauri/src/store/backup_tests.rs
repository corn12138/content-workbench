use super::{
    tests::{draft, edit, fixture, reading},
    WorkbenchStore,
};
use serde_json::Value;
use std::fs;

fn recovery_files(directory: &std::path::Path) -> Vec<std::path::PathBuf> {
    fs::read_dir(directory)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| {
            path.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("before-restore-")
        })
        .collect()
}

#[test]
fn backup_roundtrip_preserves_history_publications_and_recovery() {
    let (directory, mut store) = fixture();
    let first = store.save_draft(draft("保留文章", "原文")).unwrap();
    store
        .save_draft(edit(&first, &first.title, "新版"))
        .unwrap();
    store
        .record_publication(&first.id, 1, "https://juejin.cn/post/778899")
        .unwrap();
    store.archive_draft(&first.id, true).unwrap();
    store
        .save_reading(reading("https://example.com/", "笔记"))
        .unwrap();
    let snapshot = store.snapshot().unwrap();
    let backup = store.export_backup().unwrap();
    store
        .save_draft(draft("恢复前新增", "需要被恢复前副本保护"))
        .unwrap();
    store.restore_backup(&backup).unwrap();
    assert_eq!(store.snapshot().unwrap(), snapshot);
    assert_eq!(store.revisions(&first.id).unwrap().len(), 2);
    let files = recovery_files(directory.path());
    assert_eq!(files.len(), 1);
    let saved: Value = serde_json::from_str(&fs::read_to_string(&files[0]).unwrap()).unwrap();
    assert_eq!(saved["drafts"].as_array().unwrap().len(), 2);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&files[0]).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    drop(store);
    assert_eq!(
        WorkbenchStore::open(directory.path().into())
            .unwrap()
            .snapshot()
            .unwrap(),
        snapshot
    );
}

#[test]
fn invalid_backups_do_not_mutate_or_write_recovery_copies() {
    let (directory, mut store) = fixture();
    let first = store.save_draft(draft("不能丢失", "重要内容")).unwrap();
    store
        .record_publication(&first.id, 1, "https://x.com/test/status/12345")
        .unwrap();
    let before = store.snapshot().unwrap();
    let baseline: Value = serde_json::from_str(&store.export_backup().unwrap()).unwrap();
    let changes: &[fn(&mut Value)] = &[
        |v| v["version"] = 2.into(),
        |v| v["extra"] = true.into(),
        |v| v["revisions"] = serde_json::json!([]),
        |v| v["revisions"][0]["revision"] = 2.into(),
        |v| v["drafts"][0]["body"] = "不一致".into(),
        |v| v["drafts"][0]["title"] = "😀".repeat(201).into(),
        |v| v["drafts"][0]["updatedAt"] = "2026-10-28T12:00:00+08:00".into(),
        |v| v["publications"][0]["title"] = "错误标题".into(),
        |v| v["publications"][0]["platform"] = "juejin".into(),
        |v| v["publications"][0]["draftRevision"] = 9.into(),
        |v| {
            let duplicate = v["publications"][0].clone();
            v["publications"].as_array_mut().unwrap().push(duplicate)
        },
        |v| v["drafts"][0]["revision"] = 9_007_199_254_740_992_i64.into(),
    ];
    for change in changes {
        let mut value = baseline.clone();
        change(&mut value);
        assert!(
            store.restore_backup(&value.to_string()).is_err(),
            "accepted {value}"
        );
        assert_eq!(store.snapshot().unwrap(), before);
    }
    assert!(store.restore_backup("not json").is_err());
    assert!(store
        .restore_backup(&" ".repeat(25 * 1024 * 1024 + 1))
        .is_err());
    assert!(recovery_files(directory.path()).is_empty());
}

#[test]
fn legacy_lone_surrogate_backup_is_rejected_before_mutation() {
    let (directory, mut store) = fixture();
    store.save_draft(draft("原有资料", "需要保留")).unwrap();
    let before = store.snapshot().unwrap();
    let backup = store
        .export_backup()
        .unwrap()
        .replace("原有资料", "\\ud83d");
    assert!(store.restore_backup(&backup).is_err());
    assert_eq!(store.snapshot().unwrap(), before);
    assert!(recovery_files(directory.path()).is_empty());
}

#[test]
fn failed_restore_rolls_back_all_tables_and_keeps_recovery() {
    let (directory, mut store) = fixture();
    let first = store.save_draft(draft("不能丢失", "旧资料")).unwrap();
    store
        .record_publication(&first.id, 1, "https://x.com/test/status/123")
        .unwrap();
    store
        .save_reading(reading("https://example.com", "旧笔记"))
        .unwrap();
    let before = store.snapshot().unwrap();
    let backup = store.export_backup().unwrap();
    // A database-side fault after deletion exercises transaction rollback, not just JSON rejection.
    store.connection.execute_batch("CREATE TRIGGER fail_restore BEFORE INSERT ON drafts BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END;").unwrap();
    assert!(store
        .restore_backup(&backup)
        .unwrap_err()
        .contains("simulated disk failure"));
    assert_eq!(store.snapshot().unwrap(), before);
    assert_eq!(store.revisions(&first.id).unwrap().len(), 1);
    assert_eq!(recovery_files(directory.path()).len(), 1);
}

#[test]
fn legacy_camel_case_fixture_roundtrips_without_schema_conversion() {
    let (_directory, mut store) = fixture();
    let fixture = r#"{
      "format":"content-workbench","version":1,"exportedAt":"2026-10-28T12:00:00.000Z",
      "drafts":[{"id":"00000000-0000-4000-8000-000000000001","title":"中文 😀","body":"正文","project":"编辑器","revision":1,"archived":true,"createdAt":"2026-10-28T12:00:00.000Z","updatedAt":"2026-10-28T12:00:00.000Z"}],
      "revisions":[{"draftId":"00000000-0000-4000-8000-000000000001","revision":1,"title":"中文 😀","body":"正文","project":"编辑器","savedAt":"2026-10-28T12:00:00.000Z"}],
      "publications":[{"id":"00000000-0000-4000-8000-000000000002","draftId":"00000000-0000-4000-8000-000000000001","draftRevision":1,"title":"中文 😀","platform":"x","url":"https://x.com/author/status/123?track=yes","confirmedAt":"2026-10-28T12:00:00.000Z","confirmation":"manual"}],
      "readings":[{"id":"00000000-0000-4000-8000-000000000003","url":"https://EXAMPLE.com:443/docs?q=a#section","title":"阅读","note":"笔记","read":true,"createdAt":"2026-10-28T12:00:00.000Z","updatedAt":"2026-10-28T12:00:00.000Z"}]
    }"#;
    store.restore_backup(fixture).unwrap();
    let value: Value = serde_json::from_str(&store.export_backup().unwrap()).unwrap();
    assert_eq!(value["version"], 1);
    assert_eq!(value["drafts"][0]["title"], "中文 😀");
    assert_eq!(value["publications"][0]["draftRevision"], 1);
    assert_eq!(
        value["publications"][0]["url"],
        "https://x.com/author/status/123"
    );
    assert_eq!(
        value["readings"][0]["url"],
        "https://example.com/docs?q=a#section"
    );
    assert!(value["revisions"][0].get("draft_id").is_none());
    assert!(store.import_markdown("same.md", "正文").unwrap().duplicate);
}
