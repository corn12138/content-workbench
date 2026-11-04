use super::{
    full_backup::ExportInput,
    tests::{draft, edit, fixture, reading},
    workflow_models::{FeedbackInput, PreparationInput, PreparedImage},
    WorkbenchStore,
};
use std::{collections::BTreeMap, io::Cursor};

fn png(seed: u8) -> Vec<u8> {
    let mut output = Cursor::new(Vec::new());
    let mut image = image::RgbImage::new(2, 2);
    image.put_pixel(0, 0, image::Rgb([seed, 0, 0]));
    image::DynamicImage::ImageRgb8(image)
        .write_to(&mut output, image::ImageFormat::Png)
        .unwrap();
    output.into_inner()
}

fn prep(draft_id: &str, platform: &str, revision: i64, text: Option<&str>) -> PreparationInput {
    PreparationInput {
        draft_id: draft_id.into(),
        platform: platform.into(),
        revision,
        x_text: text.map(String::from),
        x_mode: text.map(|_| "web".into()),
        pending_url: String::new(),
    }
}

fn metrics(pairs: &[(&str, Option<i64>)]) -> BTreeMap<String, Option<i64>> {
    pairs.iter().map(|(k, v)| (k.to_string(), *v)).collect()
}

#[test]
fn preparation_is_bound_to_revision_and_survives_reopen_and_edits() {
    let (dir, mut store) = fixture();
    let first = store.save_draft(draft("标题", "第一版正文")).unwrap();
    let saved = store
        .save_preparation(prep(&first.id, "x", first.revision, Some("我改过的短帖")))
        .unwrap();
    assert_eq!(saved.revision, 1);
    // A revision that does not exist yet, a bad platform or mode is refused.
    assert!(store
        .save_preparation(prep(&first.id, "x", 2, Some("x")))
        .is_err());
    assert!(store
        .save_preparation(prep(&first.id, "weibo", 1, None))
        .is_err());
    let mut bad = prep(&first.id, "x", 1, Some("x"));
    bad.x_mode = Some("auto".into());
    assert!(store.save_preparation(bad).is_err());
    drop(store);
    let mut store = WorkbenchStore::open(dir.path().into()).unwrap();
    let restored = store.workflow().unwrap().preparations;
    assert_eq!(restored, vec![saved.clone()]);
    // Editing the draft keeps the user's text; the stored revision now differs from the draft.
    let second = store
        .save_draft(edit(&first, "标题", "第二版正文"))
        .unwrap();
    let kept = &store.workflow().unwrap().preparations[0];
    assert_eq!(kept.x_text.as_deref(), Some("我改过的短帖"));
    assert_eq!(kept.revision, 1);
    assert_ne!(kept.revision, second.revision);
    // Confirming after a re-check rebinds to the new revision and content hash.
    let rebound = store
        .save_preparation(prep(&first.id, "x", second.revision, Some("我改过的短帖")))
        .unwrap();
    assert_eq!(rebound.revision, 2);
    assert_ne!(rebound.content_hash, saved.content_hash);
    store.clear_preparation(&first.id, "x").unwrap();
    assert!(store.workflow().unwrap().preparations.is_empty());
}

#[test]
fn image_results_keep_their_revision_and_pending_url() {
    let (_dir, mut store) = fixture();
    let d = store
        .save_draft(draft("图", "![a](https://example.com/a.png)"))
        .unwrap();
    let mut input = prep(&d.id, "juejin", 1, None);
    input.pending_url = "https://juejin.cn/post/1".into();
    store.save_preparation(input).unwrap();
    let images = vec![PreparedImage {
        position: 1,
        source: "example.com/a.png".into(),
        filename: None,
        status: "failed".into(),
        error: Some("网络错误".into()),
    }];
    let saved = store.save_image_results(&d, images.clone()).unwrap();
    assert_eq!(saved.images, images);
    assert_eq!(saved.images_revision, Some(1));
    assert_eq!(saved.pending_url, "https://juejin.cn/post/1");
    // A revision produced by image preparation carries the X preparation along.
    store
        .save_preparation(prep(&d.id, "x", 1, Some("短帖")))
        .unwrap();
    let swapped = store.save_draft(edit(&d, "图", "![a](assets/x)")).unwrap();
    store.follow_image_revision(1, &swapped).unwrap();
    let x = store
        .workflow()
        .unwrap()
        .preparations
        .into_iter()
        .find(|p| p.platform == "x")
        .unwrap();
    assert_eq!(x.revision, swapped.revision);
    let d = swapped;
    let mut bad = images.clone();
    bad[0].filename = Some("../escape.png".into());
    assert!(store.save_image_results(&d, bad).is_err());
    let next = store.save_draft(edit(&d, "图", "改了")).unwrap();
    assert!(store.save_image_results(&d, images).is_err());
    // Saving text for the new revision does not relabel the old image results.
    let rebound = store
        .save_preparation(prep(&d.id, "juejin", next.revision, None))
        .unwrap();
    assert_eq!(rebound.images_revision, Some(1));
}

#[test]
fn manual_records_can_be_corrected_or_removed_but_receipts_keep_provenance() {
    let (_dir, mut store) = fixture();
    let d = store.save_draft(draft("作品", "正文")).unwrap();
    let manual = store
        .record_publication(&d.id, 1, "https://juejin.cn/post/111")
        .unwrap();
    let api = store
        .record_api_publication(&d.id, 1, "https://x.com/someone/status/222")
        .unwrap();
    let corrected = store
        .update_publication(&manual.id, "https://juejin.cn/post/333")
        .unwrap();
    assert_eq!(corrected.url, "https://juejin.cn/post/333");
    assert_eq!(corrected.confirmation, "manual");
    assert!(corrected.corrected_at.is_some());
    // The old identity is free again, the new one is taken.
    store
        .record_publication(&d.id, 1, "https://juejin.cn/post/111")
        .unwrap();
    assert!(store
        .update_publication(&manual.id, "https://juejin.cn/post/111")
        .is_err());
    assert!(store
        .update_publication(&manual.id, "https://x.com/a/status/5")
        .is_err());
    assert!(store
        .update_publication(&api.id, "https://x.com/someone/status/999")
        .unwrap_err()
        .contains("平台回执"));
    store
        .save_feedback(FeedbackInput {
            publication_id: api.id.clone(),
            observed_at: super::validation::now(),
            metrics: metrics(&[("likes", Some(1))]),
            note: String::new(),
        })
        .unwrap();
    store.remove_publication(&api.id).unwrap();
    let workflow = store.workflow().unwrap();
    assert!(workflow.feedback.is_empty());
    assert!(store
        .snapshot()
        .unwrap()
        .publications
        .iter()
        .all(|p| p.id != api.id));
    // Backups carry the correction and reject a corrected API receipt.
    let backup = store.export_full_backup().unwrap();
    let (_other, mut fresh) = fixture();
    fresh.restore_full_backup(&backup).unwrap();
    assert!(fresh
        .snapshot()
        .unwrap()
        .publications
        .iter()
        .any(|p| p.corrected_at.is_some() && p.url.ends_with("/333")));
}

#[test]
fn feedback_distinguishes_unknown_from_zero_and_platform_fields() {
    let (_dir, mut store) = fixture();
    let d = store.save_draft(draft("作品", "正文")).unwrap();
    let juejin = store
        .record_publication(&d.id, 1, "https://juejin.cn/post/1")
        .unwrap();
    let input = |m: BTreeMap<String, Option<i64>>, note: &str| FeedbackInput {
        publication_id: juejin.id.clone(),
        observed_at: "2026-11-01T08:00:00.000Z".into(),
        metrics: m,
        note: note.into(),
    };
    let saved = store
        .save_feedback(input(metrics(&[("views", Some(0)), ("likes", None)]), ""))
        .unwrap();
    assert_eq!(saved.metrics["views"], Some(0));
    assert_eq!(saved.metrics["likes"], None);
    assert_eq!(saved.source, "manual");
    // X-only names, negative numbers and empty observations are refused.
    assert!(store
        .save_feedback(input(metrics(&[("impressions", Some(5))]), ""))
        .is_err());
    assert!(store
        .save_feedback(input(metrics(&[("views", Some(-1))]), ""))
        .is_err());
    assert!(store
        .save_feedback(input(metrics(&[("views", None)]), " "))
        .is_err());
    assert!(store
        .save_feedback(input(
            metrics(&[("views", None)]),
            "读者在评论区追问部署步骤"
        ))
        .is_ok());
    let mut future = input(metrics(&[("views", Some(1))]), "");
    future.observed_at = "2099-01-01T00:00:00.000Z".into();
    assert!(store.save_feedback(future).is_err());
    assert_eq!(store.workflow().unwrap().feedback.len(), 2);
    store.delete_feedback(&saved.id).unwrap();
    assert_eq!(store.workflow().unwrap().feedback.len(), 1);
    let api = store
        .save_api_feedback(
            &juejin.id,
            "https://juejin.cn/post/999",
            metrics(&[("views", Some(3))]),
        )
        .unwrap_err();
    assert!(api.contains("已变化"));
}

#[test]
fn composing_notes_keeps_order_sources_and_is_idempotent() {
    let (dir, mut store) = fixture();
    let a = store
        .save_reading(reading("https://example.com/a", "第一条笔记"))
        .unwrap();
    let b = store
        .save_reading(reading("https://example.org/b", "  second note\n"))
        .unwrap();
    let empty = store
        .save_reading(reading("https://example.net/c", ""))
        .unwrap();
    assert!(store
        .compose_notes(&[a.id.clone(), empty.id.clone()])
        .unwrap_err()
        .contains("还没有笔记"));
    assert!(store.compose_notes(&[a.id.clone(), a.id.clone()]).is_err());
    assert!(store.compose_notes(&[]).is_err());
    let (draft, duplicate) = store.compose_notes(&[b.id.clone(), a.id.clone()]).unwrap();
    assert!(!duplicate);
    let second_pos = draft.body.find("second note").unwrap();
    let first_pos = draft.body.find("第一条笔记").unwrap();
    assert!(second_pos < first_pos, "visible order is preserved");
    assert!(draft.body.contains("来源：<https://example.com/a>"));
    assert!(draft.title.contains("等 2 篇"));
    let (again, duplicate) = store.compose_notes(&[b.id.clone(), a.id.clone()]).unwrap();
    assert!(duplicate);
    assert_eq!(again.id, draft.id);
    assert_eq!(store.snapshot().unwrap().drafts.len(), 1);
    // Notes are not deleted; editing a note makes a new composition.
    assert_eq!(store.snapshot().unwrap().readings.len(), 3);
    let mut changed = b.clone();
    changed.note = "edited".into();
    store
        .save_reading(super::models::ReadingInput {
            id: Some(changed.id.clone()),
            url: changed.url.clone(),
            title: changed.title.clone(),
            note: changed.note.clone(),
            read: changed.read,
        })
        .unwrap();
    let (other, duplicate) = store.compose_notes(&[b.id.clone(), a.id.clone()]).unwrap();
    assert!(!duplicate);
    assert_ne!(other.id, draft.id);
    let sources = store.workflow().unwrap().sources;
    assert_eq!(sources.len(), 2);
    assert_eq!(
        sources
            .iter()
            .find(|s| s.draft_id == draft.id)
            .unwrap()
            .sources[0]
            .reading_id,
        b.id
    );
    drop(store);
    let store = WorkbenchStore::open(dir.path().into()).unwrap();
    assert_eq!(store.workflow().unwrap().sources.len(), 2);
}

#[test]
fn full_backup_round_trips_workflow_and_old_backups_get_defaults() {
    let (_dir, mut store) = fixture();
    let d = store.save_draft(draft("作品", "正文")).unwrap();
    store
        .save_preparation(prep(&d.id, "x", 1, Some("短帖")))
        .unwrap();
    let p = store
        .record_publication(&d.id, 1, "https://x.com/me/status/1")
        .unwrap();
    store
        .save_feedback(FeedbackInput {
            publication_id: p.id.clone(),
            observed_at: "2026-11-02T00:00:00.000Z".into(),
            metrics: metrics(&[
                ("impressions", Some(10)),
                ("likes", Some(0)),
                ("replies", None),
            ]),
            note: "跟进".into(),
        })
        .unwrap();
    let r = store
        .save_reading(reading("https://example.com/a", "笔记"))
        .unwrap();
    store.compose_notes(&[r.id]).unwrap();
    let before = store.workflow().unwrap();
    let backup = store.export_full_backup().unwrap();
    let summary = WorkbenchStore::inspect_backup(&backup).unwrap().summary;
    assert_eq!(
        (
            summary.drafts,
            summary.preparations,
            summary.feedback,
            summary.compositions,
            summary.notes
        ),
        (2, 1, 1, 1, 1)
    );
    assert!(summary.format.contains("含发布准备"));
    let (other_dir, mut fresh) = fixture();
    fresh.restore_full_backup(&backup).unwrap();
    assert_eq!(fresh.workflow().unwrap(), before);
    assert_eq!(fresh.snapshot().unwrap(), store.snapshot().unwrap());
    drop(fresh);
    let reopened = WorkbenchStore::open(other_dir.path().into()).unwrap();
    assert_eq!(reopened.workflow().unwrap(), before);

    // A schema-4 era backup (manifest without workflow.json) restores with empty workflow data.
    let mut files = super::archive::unpack(&backup).unwrap();
    files.remove("workflow.json");
    let old = super::archive::pack(files).unwrap();
    let summary = WorkbenchStore::inspect_backup(&old).unwrap().summary;
    assert!(summary.format.contains("较早版本"));
    store.restore_full_backup(&old).unwrap();
    assert_eq!(store.workflow().unwrap(), Default::default());

    // Inconsistent workflow data is rejected before anything changes.
    let mut files = super::archive::unpack(&backup).unwrap();
    let mut workflow: serde_json::Value = serde_json::from_slice(&files["workflow.json"]).unwrap();
    workflow["preparations"][0]["contentHash"] = "0".repeat(64).into();
    files.insert(
        "workflow.json".into(),
        serde_json::to_vec(&workflow).unwrap(),
    );
    let tampered = super::archive::pack(files).unwrap();
    let current = store.snapshot().unwrap();
    assert!(store.restore_full_backup(&tampered).is_err());
    assert_eq!(store.snapshot().unwrap(), current);
}

#[test]
fn schema_four_upgrade_keeps_standalone_copy_once() {
    let (dir, store) = fixture();
    store
        .connection
        .execute_batch("DROP TABLE feedback; DROP TABLE draft_sources; DROP TABLE publish_preparations; PRAGMA user_version=4")
        .unwrap();
    drop(store);
    let store = WorkbenchStore::open(dir.path().into()).unwrap();
    assert!(store.workflow().unwrap().preparations.is_empty());
    drop(store);
    let _again = WorkbenchStore::open(dir.path().into()).unwrap();
    let copies: Vec<_> = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|p| p.unwrap().path())
        .filter(|p| {
            p.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("before-workflow-upgrade-")
        })
        .collect();
    assert_eq!(copies.len(), 1);
    let old = rusqlite::Connection::open(&copies[0]).unwrap();
    assert_eq!(
        old.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        4
    );
}

#[test]
fn export_current_uses_editor_input_and_bundles_only_library_images() {
    let (_dir, mut store) = fixture();
    let asset = super::assets::Asset::from_bytes(png(7)).unwrap();
    store.put_asset(&asset).unwrap();
    let saved = store.save_draft(draft("旧", "数据库里的旧正文")).unwrap();
    let input = ExportInput {
        title: "新标题".into(),
        body: format!(
            "尚未保存的新输入\n\n![a](assets/{0})\n![again](assets/{0})\n![gone](assets/{1}.png)\n![web](https://example.com/x.png)\n![local](/etc/passwd)\n",
            asset.name,
            "f".repeat(64)
        ),
        project: String::new(),
    };
    let exported = store.export_current(&input).unwrap();
    assert!(exported.bundled);
    assert_eq!(
        (exported.images, exported.missing, exported.remote),
        (1, 2, 1)
    );
    let files = super::archive::read_article_zip(&exported.bytes).unwrap();
    assert_eq!(files["article.md"], input.body.as_bytes());
    assert_eq!(files.len(), 2);
    // The database copy is untouched.
    assert_eq!(store.get_draft(&saved.id).unwrap(), saved);
    let text = store
        .export_current(&ExportInput {
            title: "t".into(),
            body: "纯文字".into(),
            project: String::new(),
        })
        .unwrap();
    assert!(!text.bundled);
    assert_eq!(text.bytes, "纯文字".as_bytes());
    assert!(store
        .export_current(&ExportInput {
            title: "t".repeat(201),
            body: String::new(),
            project: String::new(),
        })
        .is_err());

    // The bundle re-imports into an independent library with identical text and images.
    let (_other, mut fresh) = fixture();
    let imported = fresh.import_bundle("新标题.zip", &exported.bytes).unwrap();
    assert_eq!(imported.draft.body, input.body);
    assert_eq!(fresh.asset(&asset.name).unwrap().bytes, asset.bytes);
    assert!(imported.warnings.iter().any(|w| w.contains("缺少部分图片")));
    assert!(imported.warnings.iter().any(|w| w.contains("外链")));
}

#[test]
fn article_bundles_reject_unsafe_entries_and_tampered_images() {
    let (_dir, mut store) = fixture();
    let asset = super::assets::Asset::from_bytes(png(1)).unwrap();
    let mut files = super::archive::Files::new();
    files.insert(
        "article.md".into(),
        format!("![x](assets/{})", asset.name).into_bytes(),
    );
    files.insert("../evil.md".into(), b"x".to_vec());
    assert!(store
        .import_bundle("a.zip", &super::archive::write_zip(&files).unwrap())
        .is_err());
    let mut files = super::archive::Files::new();
    files.insert(
        "article.md".into(),
        format!("![x](assets/{})", asset.name).into_bytes(),
    );
    files.insert(format!("assets/{}", asset.name), png(2));
    assert!(store
        .import_bundle("a.zip", &super::archive::write_zip(&files).unwrap())
        .unwrap_err()
        .contains("校验失败"));
    assert!(store.snapshot().unwrap().drafts.is_empty());
    let mut files = super::archive::Files::new();
    files.insert("notes.txt".into(), b"x".to_vec());
    assert!(store
        .import_bundle("a.zip", &super::archive::write_zip(&files).unwrap())
        .is_err());
}
