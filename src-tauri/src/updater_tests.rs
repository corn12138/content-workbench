#![cfg(target_os = "macos")]
use crate::{
    store::{models::DraftInput, WorkbenchStore},
    update_backup,
};
use serde_json::json;
use std::{fs, path::Path, process::Command};
use tauri_plugin_updater::UpdaterExt;

fn cli(args: &[&str]) {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../node_modules/.bin/tauri");
    // The ephemeral private key never appears in test output, even when CLI execution fails.
    let output = Command::new(path)
        .args(args)
        .output()
        .expect("Install npm dependencies before updater tests");
    assert!(
        output.status.success(),
        "Updater test signing command failed (output withheld)"
    );
}

#[test]
#[ignore = "requires an explicitly selected signed release package"]
fn packaged_release_installs_and_preserves_rollback() {
    let root = std::path::PathBuf::from(
        std::env::var_os("WORKBENCH_UPDATER_PACKAGE_DIR")
            .expect("Select release package directory"),
    );
    let metadata: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("latest.json")).unwrap()).unwrap();
    let url = url::Url::parse(
        metadata["platforms"]["darwin-aarch64"]["url"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    let filename = url.path_segments().unwrap().next_back().unwrap();
    assert!(!filename.contains(['/', '\\']));
    let bytes = fs::read(root.join(filename)).unwrap();
    let temp = tempfile::tempdir().unwrap();
    let bundle = temp.path().join("Old.app");
    fs::create_dir_all(bundle.join("Contents/MacOS")).unwrap();
    fs::write(
        bundle.join("Contents/MacOS/test"),
        b"isolated previous version",
    )
    .unwrap();
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    context
        .config_mut()
        .plugins
        .0
        .insert("updater".into(), config["plugins"]["updater"].clone());
    let app = tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .unwrap();
    let update = app
        .updater_builder()
        .executable_path(bundle.join("Contents/MacOS/test"))
        .build()
        .unwrap()
        .restore_update(metadata.clone())
        .unwrap()
        .unwrap();
    update.verify(&bytes).unwrap();
    let data = temp.path().join("data");
    let store = WorkbenchStore::open(data.clone()).unwrap();
    let backup = update_backup::prepare(&data, &bundle, &store, "0.1.0").unwrap();
    update.install(bytes).unwrap();
    assert!(Command::new("/usr/bin/codesign")
        .args(["--verify", "--deep", "--strict"])
        .arg(&bundle)
        .output()
        .unwrap()
        .status
        .success());
    let installed = Command::new("/usr/libexec/PlistBuddy")
        .args(["-c", "Print :CFBundleShortVersionString"])
        .arg(bundle.join("Contents/Info.plist"))
        .output()
        .unwrap();
    assert_eq!(
        String::from_utf8(installed.stdout).unwrap().trim(),
        metadata["version"].as_str().unwrap()
    );
    assert_eq!(
        fs::read(backup.join("内容工作台.app/Contents/MacOS/test")).unwrap(),
        b"isolated previous version"
    );
    assert!(backup.join("资料.cwb").is_file());
}

#[test]
fn signed_upgrade_rejects_tampering_and_preserves_old_app_and_data() {
    let temp = tempfile::tempdir().unwrap();
    let key = temp.path().join("test.key");
    cli(&["signer", "generate", "--ci", "-w", key.to_str().unwrap()]);
    let bundle = temp.path().join("Current.app");
    fs::create_dir_all(bundle.join("Contents/MacOS")).unwrap();
    fs::write(bundle.join("Contents/MacOS/test"), b"old application").unwrap();
    let package = temp.path().join("new.app.tar.gz");
    {
        let encoder = flate2::write::GzEncoder::new(
            fs::File::create(&package).unwrap(),
            flate2::Compression::default(),
        );
        let mut archive = tar::Builder::new(encoder);
        let mut header = tar::Header::new_gnu();
        header.set_size(15);
        header.set_mode(0o755);
        header.set_cksum();
        archive
            .append_data(
                &mut header,
                "Next.app/Contents/MacOS/test",
                &b"new application"[..],
            )
            .unwrap();
        archive.into_inner().unwrap().finish().unwrap();
    }
    cli(&[
        "signer",
        "sign",
        "-f",
        key.to_str().unwrap(),
        "-p",
        "",
        "--app-version",
        "0.9.0",
        package.to_str().unwrap(),
    ]);
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().plugins.0.insert("updater".into(), json!({
        "pubkey": fs::read_to_string(temp.path().join("test.key.pub")).unwrap().trim(),
        "requireSignedVersion": true,
        "endpoints": ["https://github.com/corn12138/content-workbench/releases/latest/download/latest.json"]
    }));
    let app = tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .unwrap();
    let updater = app
        .updater_builder()
        .executable_path(bundle.join("Contents/MacOS/test"))
        .build()
        .unwrap();
    let manifest = json!({"version":"0.9.0", "url":"https://github.com/corn12138/content-workbench/releases/download/v0.9.0/test.app.tar.gz", "signature":fs::read_to_string(package.with_extension("gz.sig")).unwrap().trim()});
    let update = updater.restore_update(manifest.clone()).unwrap().unwrap();
    let bytes = fs::read(&package).unwrap();
    assert!(update.verify(&bytes).is_ok());
    let mut corrupted = bytes.clone();
    corrupted[0] ^= 1;
    assert!(update.install(&corrupted).is_err());
    assert_eq!(
        fs::read(bundle.join("Contents/MacOS/test")).unwrap(),
        b"old application"
    );
    let mut inflated = manifest.clone();
    inflated["version"] = json!("99.0.0");
    assert!(updater
        .restore_update(inflated)
        .unwrap()
        .unwrap()
        .verify(&bytes)
        .is_err());
    let mut older = manifest;
    older["version"] = json!("0.0.1");
    assert!(updater.restore_update(older).unwrap().is_none());

    let data = temp.path().join("data");
    let mut store = WorkbenchStore::open(data.clone()).unwrap();
    store
        .save_draft(DraftInput {
            id: None,
            title: "Preserved draft".into(),
            body: "Original".into(),
            project: String::new(),
            expected_revision: None,
        })
        .unwrap();
    let snapshot = store.snapshot().unwrap();
    let backup = update_backup::prepare(&data, &bundle, &store, "0.1.0").unwrap();
    update.install(&bytes).unwrap();
    assert_eq!(
        fs::read(bundle.join("Contents/MacOS/test")).unwrap(),
        b"new application"
    );
    assert_eq!(
        fs::read(backup.join("内容工作台.app/Contents/MacOS/test")).unwrap(),
        b"old application"
    );
    store
        .restore_full_backup(&fs::read(backup.join("资料.cwb")).unwrap())
        .unwrap();
    assert_eq!(store.snapshot().unwrap(), snapshot);
    // An unusable backup location must stop before the caller reaches installation.
    let blocked = temp.path().join("blocked");
    fs::write(&blocked, b"file").unwrap();
    assert!(update_backup::prepare(&blocked, &bundle, &store, "0.1.0").is_err());
    assert!(backup.exists());
}
