use super::{
    archive::{self, Files},
    assets::Asset,
    media,
    tests::{draft, edit, fixture, reading},
    WorkbenchStore,
};
use std::{fs, io::Cursor};

fn png() -> Vec<u8> {
    let mut output = Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(2, 2)
        .write_to(&mut output, image::ImageFormat::Png)
        .unwrap();
    output.into_inner()
}

#[test]
fn imported_images_survive_original_deletion_history_and_complete_restore() {
    let (directory, mut store) = fixture();
    let source = tempfile::tempdir().unwrap();
    fs::write(source.path().join("image.png"), png()).unwrap();
    let imported = store
        .import_article(
            &source.path().join("article.md"),
            "# 图文\n\n![图片](image.png)\n",
        )
        .unwrap();
    assert!(imported.warnings.is_empty());
    let name = Asset::from_bytes(png()).unwrap().name;
    assert!(imported.draft.body.contains(&format!("assets/{name}")));
    drop(source);
    let (article, bundled) = store.export_article(&imported.draft.id).unwrap();
    assert!(bundled);
    let mut zipped = zip::ZipArchive::new(Cursor::new(article)).unwrap();
    assert_eq!(
        zipped.by_name(&format!("assets/{name}")).unwrap().size(),
        png().len() as u64
    );
    store
        .save_draft(edit(&imported.draft, "去掉正文图片", "新内容"))
        .unwrap();
    store
        .record_publication(&imported.draft.id, 1, "https://juejin.cn/post/778899")
        .unwrap();
    let snapshot = store.snapshot().unwrap();
    let backup = store.export_full_backup().unwrap();
    store.save_draft(draft("恢复前", "不能丢")).unwrap();
    let pre_restore = store.snapshot().unwrap();
    store.restore_full_backup(&backup).unwrap();
    assert_eq!(store.snapshot().unwrap(), snapshot);
    assert_eq!(store.asset(&name).unwrap().bytes, png());
    let recovery = fs::read_dir(directory.path())
        .unwrap()
        .map(|p| p.unwrap().path())
        .find(|p| p.extension().is_some_and(|x| x == "cwb"))
        .unwrap();
    let (_recovered_directory, mut recovered) = fixture();
    recovered
        .restore_full_backup(&fs::read(recovery).unwrap())
        .unwrap();
    assert_eq!(recovered.snapshot().unwrap(), pre_restore);
    assert_eq!(recovered.asset(&name).unwrap().bytes, png());
    drop(store);
    let mut reopened = WorkbenchStore::open(directory.path().into()).unwrap();
    let restored = reopened.restore_revision(&imported.draft.id, 1, 2).unwrap();
    assert!(restored.body.contains(&name));
    assert!(reopened
        .asset_data_url(&name)
        .unwrap()
        .starts_with("data:image/png;base64,"));
}

#[test]
fn import_handles_reference_images_and_ignores_code_and_outside_paths() {
    let (_directory, mut store) = fixture();
    let root = tempfile::tempdir().unwrap();
    fs::write(root.path().join("my image.png"), png()).unwrap();
    let body = "![a][pic]\n\n[pic]: <my image.png>\n\n`![code](my%20image.png)`\n\n![again](my%20image.png)\n\n![outside](../secret.png)\n![remote](https://example.com/a.png)";
    let imported = store
        .import_article(&root.path().join("article.md"), body)
        .unwrap();
    assert_eq!(store.all_assets().unwrap().len(), 1);
    assert_eq!(imported.draft.body.matches("](assets/").count(), 2);
    assert!(imported.draft.body.contains("`![code](my%20image.png)`"));
    assert_eq!(imported.warnings.len(), 2);
    assert!(media::relative_image(root.path(), "%2e%2e/secret.png").is_err());
    assert!(media::relative_image(root.path(), "file:///tmp/private.png").is_err());
    assert!(media::relative_image(root.path(), "/tmp/private.png").is_err());
    let nested = media::images("![outer ![inner](inner.png)](my%20image.png)");
    assert_eq!(nested.len(), 1);
    assert_eq!(nested[0].destination, "my%20image.png");
    #[cfg(unix)]
    {
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret.png"), png()).unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("secret.png"),
            root.path().join("link.png"),
        )
        .unwrap();
        assert!(media::relative_image(root.path(), "link.png").is_err());
    }
}

#[test]
fn corrupt_missing_and_unsafe_backup_entries_leave_current_data_untouched() {
    let (_directory, mut store) = fixture();
    let asset = Asset::from_bytes(png()).unwrap();
    store.put_asset(&asset).unwrap();
    let first = store
        .save_draft(draft("图片历史", &format!("![](assets/{})", asset.name)))
        .unwrap();
    store.save_draft(edit(&first, "现在无图", "文字")).unwrap();
    let backup = store.export_full_backup().unwrap();
    let before = store.snapshot().unwrap();
    let files = archive::unpack(&backup).unwrap();
    let mut missing = files.clone();
    missing.remove(&format!("assets/{}", asset.name));
    assert!(store
        .restore_full_backup(&archive::pack(missing).unwrap())
        .is_err());
    let mut corrupt = files.clone();
    corrupt.insert(format!("assets/{}", asset.name), b"not image".to_vec());
    assert!(store
        .restore_full_backup(&archive::pack(corrupt).unwrap())
        .is_err());
    let mut unsafe_files = Files::new();
    unsafe_files.insert("../../outside".into(), b"bad".to_vec());
    assert!(archive::unpack(&archive::write_zip(&unsafe_files).unwrap()).is_err());
    assert!(archive::pack(unsafe_files).is_err());
    let mut wrong_manifest = files;
    wrong_manifest.insert(
        "manifest.json".into(),
        b"{\"format\":\"content-workbench\",\"version\":2,\"entries\":{}}".to_vec(),
    );
    assert!(store
        .restore_full_backup(&archive::write_zip(&wrong_manifest).unwrap())
        .is_err());
    assert!(store.asset("../../anything").is_err());
    assert_eq!(store.snapshot().unwrap(), before);
    assert_eq!(store.asset(&asset.name).unwrap().bytes, png());
}

#[test]
fn failed_import_rolls_back_its_images() {
    let (_directory, mut store) = fixture();
    let root = tempfile::tempdir().unwrap();
    fs::write(root.path().join("test.png"), png()).unwrap();
    store.connection.execute_batch("CREATE TRIGGER fail_draft BEFORE INSERT ON drafts BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
    assert!(store
        .import_article(&root.path().join("test.md"), "![image](test.png)")
        .is_err());
    assert!(store.all_assets().unwrap().is_empty());
    assert!(store.snapshot().unwrap().drafts.is_empty());
}

#[test]
fn legacy_json_restore_keeps_complete_recovery_and_clears_library() {
    let (directory, mut store) = fixture();
    let legacy = store.export_backup().unwrap();
    store.put_asset(&Asset::from_bytes(png()).unwrap()).unwrap();
    store
        .save_reading(reading("https://example.com", "当前笔记"))
        .unwrap();
    store.restore_full_backup(legacy.as_bytes()).unwrap();
    assert!(store.all_assets().unwrap().is_empty());
    assert!(store.snapshot().unwrap().readings.is_empty());
    let recovery = fs::read_dir(directory.path())
        .unwrap()
        .map(|p| p.unwrap().path())
        .find(|p| p.extension().is_some_and(|x| x == "cwb"))
        .unwrap();
    let files = archive::unpack(&fs::read(recovery).unwrap()).unwrap();
    assert!(files.keys().any(|k| k.starts_with("assets/")));
}

#[test]
fn schema_upgrade_keeps_independent_v1_database_and_rejects_broken_v2() {
    let (directory, store) = fixture();
    store
        .connection
        .execute_batch(
            "DROP TABLE feed_items; DROP TABLE feeds; DROP TABLE assets; PRAGMA user_version=1;",
        )
        .unwrap();
    drop(store);
    let upgraded = WorkbenchStore::open(directory.path().into()).unwrap();
    let recovery = fs::read_dir(directory.path())
        .unwrap()
        .map(|p| p.unwrap().path())
        .find(|p| {
            p.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("before-library-upgrade-")
        })
        .unwrap();
    let old = rusqlite::Connection::open(recovery).unwrap();
    assert_eq!(
        old.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        1
    );
    upgraded
        .connection
        .execute_batch("DROP TABLE assets;")
        .unwrap();
    drop(upgraded);
    assert!(WorkbenchStore::open(directory.path().into()).is_err());
}
