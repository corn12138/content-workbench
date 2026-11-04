//! Synthetic sample data for local previews. Run explicitly:
//! `WORKBENCH_PREVIEW_DATA_DIR=/absolute/empty/dir cargo test --lib seed_preview_data -- --ignored`
//! It refuses non-empty directories and uses only made-up content and the repository's test feed.
use super::{
    models::{DraftInput, ReadingInput},
    workflow_models::{FeedbackInput, PreparationInput},
    WorkbenchStore,
};
use std::{collections::BTreeMap, io::Cursor};

const FEED: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>示例技术周刊（合成数据）</title><link>https://example.com/</link>
<item><title>用 SQLite 事务保护本地资料</title><link>https://example.com/posts/sqlite-transactions</link>
<pubDate>Mon, 02 Nov 2026 08:00:00 GMT</pubDate>
<description><![CDATA[<h2>为什么要事务</h2><p>一次保存可能同时写入正文、历史版本和图片索引。</p><pre><code>BEGIN IMMEDIATE;
  INSERT INTO drafts ...;
COMMIT;</code></pre><table><tr><th>场景</th><th>做法</th></tr><tr><td>恢复备份</td><td>先保存副本再替换</td></tr></table>]]></description></item>
<item><title>Designing quiet desktop tools</title><link>https://example.com/posts/quiet-tools</link>
<pubDate>Sun, 01 Nov 2026 08:00:00 GMT</pubDate>
<description><![CDATA[<p>Quiet tools show the next step and the real result, nothing more.</p><ul><li>One primary action per region</li><li>Honest states</li></ul>]]></description></item>
<item><title>RSS 只提供摘要的来源</title><link>https://example.com/posts/summary-only</link>
<pubDate>Sat, 31 Oct 2026 08:00:00 GMT</pubDate>
<description>这是一条只有摘要的合成文章，完整内容需要打开原文。</description></item>
</channel></rss>"#;

fn png() -> Vec<u8> {
    let mut image = image::RgbImage::new(64, 40);
    for (x, y, pixel) in image.enumerate_pixels_mut() {
        *pixel = image::Rgb([61 + (x as u8 % 40), 107, 84 + (y as u8 % 60)]);
    }
    let mut output = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(image)
        .write_to(&mut output, image::ImageFormat::Png)
        .unwrap();
    output.into_inner()
}

#[test]
#[ignore]
fn seed_preview_data() {
    let Some(directory) = std::env::var_os("WORKBENCH_PREVIEW_DATA_DIR") else {
        panic!("Set WORKBENCH_PREVIEW_DATA_DIR to an empty directory");
    };
    let directory = std::path::PathBuf::from(directory);
    assert!(directory.is_absolute(), "Use an absolute path");
    if directory.exists() {
        assert!(
            std::fs::read_dir(&directory).unwrap().next().is_none(),
            "Refusing to seed a non-empty directory"
        );
    }
    let mut store = WorkbenchStore::open(directory).unwrap();
    let asset = super::assets::Asset::from_bytes(png()).unwrap();
    store.put_asset(&asset).unwrap();

    let first = store
        .save_draft(DraftInput {
            id: None,
            title: "本地优先应用的备份设计".into(),
            body: format!("# 本地优先应用的备份设计\n\n资料保存在自己的电脑上，备份要能完整带走。\n\n![结构示意](assets/{})\n\n## 原则\n\n- 恢复前先保存当前资料\n- 旧备份缺字段时给出明确默认值\n\n```rust\nstore.restore_validated(backup)?;\n```\n", asset.name),
            project: "示例项目".into(),
            expected_revision: None,
        })
        .unwrap();
    let edited = store
        .save_draft(DraftInput {
            id: Some(first.id.clone()),
            title: first.title.clone(),
            body: format!("{}\n发布后补充：恢复确认前会显示备份内容摘要。\n", first.body),
            project: first.project.clone(),
            expected_revision: Some(first.revision),
        })
        .unwrap();
    let publication = store
        .record_publication(&first.id, first.revision, "https://juejin.cn/post/7000000000000000001")
        .unwrap();
    store
        .save_feedback(FeedbackInput {
            publication_id: publication.id.clone(),
            observed_at: "2026-11-02T10:00:00.000Z".into(),
            metrics: BTreeMap::from([
                ("views".into(), Some(128)),
                ("likes".into(), Some(0)),
                ("comments".into(), None),
                ("collects".into(), Some(3)),
            ]),
            note: "示例：读者问到旧备份能否恢复，计划补一节兼容说明。".into(),
        })
        .unwrap();
    store
        .save_feedback(FeedbackInput {
            publication_id: publication.id,
            observed_at: "2026-11-03T10:00:00.000Z".into(),
            metrics: BTreeMap::from([("views".into(), Some(342)), ("likes".into(), Some(9))]),
            note: String::new(),
        })
        .unwrap();

    let second = store
        .save_draft(DraftInput {
            id: None,
            title: "一条短帖的发布准备".into(),
            body: "把长文要点压缩成一条短帖，先在工作台里改好，再决定用网页还是官方 API 发布。\n".into(),
            project: String::new(),
            expected_revision: None,
        })
        .unwrap();
    store
        .save_preparation(PreparationInput {
            draft_id: second.id.clone(),
            platform: "x".into(),
            revision: second.revision,
            x_text: Some("本地优先的写作工具：资料在自己电脑上，发布前先核对，发布后记得备份。#示例".into()),
            x_mode: Some("web".into()),
            pending_url: String::new(),
        })
        .unwrap();
    let _ = edited;

    let source = url::Url::parse("https://example.com/feed.xml").unwrap();
    let parsed = crate::feed_parse::parse(FEED.as_bytes(), &source).unwrap();
    store.add_feed(source.as_str(), parsed).unwrap();
    let readings = store.snapshot().unwrap().readings;
    for (title, note) in [
        ("用 SQLite 事务保护本地资料", "收获：恢复前先写好完整副本，再在一个事务里替换。"),
        ("Designing quiet desktop tools", "每个区域只保留一个主要操作；状态要说真话。"),
    ] {
        let reading = readings.iter().find(|r| r.title == title).unwrap();
        store
            .save_reading(ReadingInput {
                id: Some(reading.id.clone()),
                url: reading.url.clone(),
                title: reading.title.clone(),
                note: note.into(),
                read: true,
            })
            .unwrap();
    }
    store
        .save_reading(ReadingInput {
            id: None,
            url: "https://example.org/articles/offline-first".into(),
            title: "收藏的链接：离线优先的取舍（合成）".into(),
            note: String::new(),
            read: false,
        })
        .unwrap();
}
