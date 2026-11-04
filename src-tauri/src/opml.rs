use crate::{feed_fetch::feed_url, store::feed_models::Feed};
use quick_xml::{events::Event, Reader, XmlVersion};
use serde::Serialize;
use std::collections::HashSet;

pub const MAX_OPML_BYTES: u64 = 1024 * 1024;
pub const MAX_OUTLINES: usize = 500;
pub const MAX_ENABLED_FEEDS: usize = 50;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpmlEntry {
    pub url: String,
    pub title: String,
    /// "new", "resubscribe", "duplicate", "invalid", "blocked" or "overLimit".
    pub status: String,
    pub reason: Option<String>,
}

/// Extracts `(xmlUrl, title)` pairs. Documents with a DOCTYPE are rejected outright, so no entity
/// (internal or external) is ever declared or expanded.
pub fn parse(bytes: &[u8]) -> Result<Vec<(String, String)>, String> {
    if bytes.len() as u64 > MAX_OPML_BYTES {
        return Err("订阅列表文件超过 1 MB。".into());
    }
    let mut reader = Reader::from_reader(bytes);
    reader.config_mut().trim_text(true);
    let mut buffer = Vec::new();
    let mut found = Vec::new();
    let mut saw_opml = false;
    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::DocType(_)) => {
                return Err("订阅列表包含文档类型声明，为安全起见未读取。".into())
            }
            Ok(Event::Start(element)) | Ok(Event::Empty(element)) => {
                let name = element.local_name();
                if name.as_ref().eq_ignore_ascii_case("opml") {
                    saw_opml = true;
                }
                if name.as_ref().eq_ignore_ascii_case("outline") {
                    let mut url = None;
                    let mut title = None;
                    let mut text = None;
                    for attribute in element.attributes().with_checks(false) {
                        let attribute = attribute.map_err(|_| "订阅列表格式无效。")?;
                        let value = attribute
                            .normalized_value(XmlVersion::Implicit1_0)
                            .map_err(|_| "订阅列表含有无法识别的字符。")?
                            .trim()
                            .to_string();
                        match attribute.key.local_name().as_ref() {
                            "xmlUrl" | "xmlurl" => url = Some(value),
                            "title" => title = Some(value),
                            "text" => text = Some(value),
                            _ => {}
                        }
                    }
                    if let Some(url) = url.filter(|u| !u.is_empty()) {
                        if found.len() >= MAX_OUTLINES {
                            return Err(format!(
                                "订阅列表超过 {MAX_OUTLINES} 个来源，请拆分后导入。"
                            ));
                        }
                        let title: String = title
                            .filter(|t| !t.is_empty())
                            .or(text)
                            .unwrap_or_default()
                            .chars()
                            .take(200)
                            .collect();
                        found.push((url.chars().take(4097).collect(), title));
                    }
                }
            }
            Ok(Event::Eof) => break,
            Ok(_) => {}
            Err(_) => return Err("订阅列表不是有效的 OPML 文件。".into()),
        }
        buffer.clear();
    }
    if !saw_opml {
        return Err("请选择 OPML 格式的订阅列表。".into());
    }
    Ok(found)
}

/// Classifies entries against current subscriptions without any network access.
pub fn preview(found: Vec<(String, String)>, feeds: &[Feed]) -> Vec<OpmlEntry> {
    let mut enabled = feeds.iter().filter(|f| f.enabled).count();
    let mut seen = HashSet::new();
    found
        .into_iter()
        .map(|(raw, title)| {
            let parsed = match feed_url(&raw) {
                Ok(url) => url.to_string(),
                Err(reason) => {
                    let blocked = reason.contains("内网");
                    return OpmlEntry {
                        url: raw,
                        title,
                        status: if blocked { "blocked" } else { "invalid" }.into(),
                        reason: Some(reason),
                    };
                }
            };
            let entry = |status: &str, reason: Option<&str>| OpmlEntry {
                url: parsed.clone(),
                title: title.clone(),
                status: status.into(),
                reason: reason.map(String::from),
            };
            if !seen.insert(parsed.clone()) {
                return entry("duplicate", Some("列表中重复出现"));
            }
            let existing = feeds.iter().find(|f| f.url == parsed);
            if existing.is_some_and(|f| f.enabled) {
                return entry("duplicate", Some("已经订阅"));
            }
            if enabled >= MAX_ENABLED_FEEDS {
                return entry("overLimit", Some("超过同时订阅 50 个来源的上限"));
            }
            enabled += 1;
            if existing.is_some() {
                entry("resubscribe", Some("曾取消订阅，已有文章与笔记会保留"))
            } else {
                entry("new", None)
            }
        })
        .collect()
}

fn escape(value: &str) -> String {
    html_escape::encode_double_quoted_attribute(value)
        .replace(['\r', '\n', '\t'], " ")
        .chars()
        .filter(|c| !c.is_control())
        .collect()
}

pub fn export(feeds: &[Feed], created: &str) -> String {
    let mut out = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<opml version=\"2.0\">\n  <head>\n    <title>内容工作台订阅</title>\n");
    out.push_str(&format!(
        "    <dateCreated>{}</dateCreated>\n  </head>\n  <body>\n",
        escape(created)
    ));
    for feed in feeds.iter().filter(|f| f.enabled) {
        out.push_str(&format!(
            "    <outline type=\"rss\" text=\"{0}\" title=\"{0}\" xmlUrl=\"{1}\"/>\n",
            escape(&feed.title),
            escape(&feed.url)
        ));
    }
    out.push_str("  </body>\n</opml>\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(url: &str, enabled: bool) -> Feed {
        Feed {
            id: uuid::Uuid::new_v4().to_string(),
            enabled,
            url: url.into(),
            title: "示例".into(),
            checked_at: None,
            etag: None,
            last_modified: None,
            error: None,
        }
    }

    #[test]
    fn classifies_duplicates_private_invalid_and_capacity() {
        let xml = r#"<?xml version="1.0"?><opml version="2.0"><body>
            <outline text="分类"><outline text="中文源" xmlUrl="https://example.com/feed.xml"/></outline>
            <outline title="Again" xmlUrl="https://example.com/feed.xml"/>
            <outline title="Existing" xmlUrl="https://existing.example/rss"/>
            <outline title="Old" xmlUrl="https://old.example/rss"/>
            <outline title="Private" xmlUrl="http://192.168.1.2/rss"/>
            <outline title="Local" xmlUrl="http://localhost/rss"/>
            <outline title="Bad" xmlUrl="ftp://example.com/rss"/>
            <outline title="Amp &amp; co" xmlUrl="https://amp.example/rss?a=1&amp;b=2"/>
        </body></opml>"#;
        let found = parse(xml.as_bytes()).unwrap();
        assert_eq!(found.len(), 8);
        assert_eq!(found[0].1, "中文源");
        assert_eq!(
            found[7],
            ("https://amp.example/rss?a=1&b=2".into(), "Amp & co".into())
        );
        let feeds = vec![
            feed("https://existing.example/rss", true),
            feed("https://old.example/rss", false),
        ];
        let statuses: Vec<_> = preview(found.clone(), &feeds)
            .into_iter()
            .map(|e| e.status)
            .collect();
        assert_eq!(
            statuses,
            [
                "new",
                "duplicate",
                "duplicate",
                "resubscribe",
                "blocked",
                "blocked",
                "invalid",
                "new"
            ]
        );
        let full: Vec<Feed> = (0..50)
            .map(|i| feed(&format!("https://f{i}.example/rss"), true))
            .collect();
        assert!(preview(found, &full)
            .iter()
            .filter(|e| e.status != "duplicate" && e.status != "blocked" && e.status != "invalid")
            .all(|e| e.status == "overLimit"));
    }

    #[test]
    fn rejects_entities_doctype_and_non_opml() {
        let xxe = r#"<?xml version="1.0"?><!DOCTYPE opml [<!ENTITY x SYSTEM "file:///etc/passwd">]><opml><body><outline xmlUrl="https://e.com/&x;"/></body></opml>"#;
        assert!(parse(xxe.as_bytes()).unwrap_err().contains("文档类型"));
        assert!(parse(b"<rss><channel/></rss>").is_err());
        assert!(parse(b"not xml <<<").is_err());
        let many = format!(
            "<opml><body>{}</body></opml>",
            (0..=MAX_OUTLINES)
                .map(|i| format!("<outline xmlUrl=\"https://e{i}.example/rss\"/>"))
                .collect::<String>()
        );
        assert!(parse(many.as_bytes()).is_err());
        assert!(parse(&vec![b' '; MAX_OPML_BYTES as usize + 1]).is_err());
    }

    #[test]
    fn export_round_trips_and_escapes() {
        let mut f = feed("https://amp.example/rss?a=1&b=2", true);
        f.title = "A \"quoted\" <title>".into();
        let off = feed("https://off.example/rss", false);
        let xml = export(&[f.clone(), off], "2026-11-04T00:00:00Z");
        let found = parse(xml.as_bytes()).unwrap();
        assert_eq!(found, vec![(f.url.clone(), f.title.clone())]);
    }
}
