use regex::Regex;
use sha2::{Digest, Sha256};
use std::{collections::HashSet, sync::LazyLock};
use url::Url;

pub struct ParsedEntry {
    pub key: String,
    pub url: String,
    pub title: String,
    pub summary: String,
    pub published_at: Option<String>,
}
pub struct ParsedFeed {
    pub title: String,
    pub items: Vec<ParsedEntry>,
}

fn plain(value: &str, limit: usize) -> String {
    static ACTIVE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?is)<script\b[^>]*>.*?</script\s*>|<style\b[^>]*>.*?</style\s*>").unwrap()
    });
    static TAGS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<[^>]*>").unwrap());
    let inactive = ACTIVE.replace_all(value, " ");
    static BREAKS: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)</?(?:p|div|h[1-6]|li|ul|ol|pre|blockquote|section)\b[^>]*>|<br\b[^>]*>")
            .unwrap()
    });
    let lines = BREAKS.replace_all(&inactive, "\n");
    let text = TAGS.replace_all(&lines, " ");
    html_escape::decode_html_entities(&text)
        .lines()
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
        .chars()
        .take(limit)
        .collect()
}

pub fn parse(bytes: &[u8], source: &Url) -> Result<ParsedFeed, String> {
    if bytes.len() > 4 * 1024 * 1024 {
        return Err("订阅内容过大。".into());
    }
    let lower = String::from_utf8_lossy(bytes).to_ascii_lowercase();
    if lower.contains("<!doctype") || lower.contains("<!entity") {
        return Err("订阅含有不支持的 XML 声明。".into());
    }
    let feed =
        feed_rs::parser::parse(bytes).map_err(|_| "这个地址不是可读取的 RSS 或 Atom 订阅。")?;
    let title = feed
        .title
        .map(|title| plain(&title.content, 200))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| source.host_str().unwrap_or("订阅").into());
    let mut items = Vec::new();
    let mut seen = HashSet::new();
    for entry in feed.entries.into_iter().take(200) {
        let link = entry
            .links
            .iter()
            .find(|link| link.rel.as_deref().is_none_or(|rel| rel == "alternate"))
            .map(|link| link.href.as_str());
        let Some(mut url) = link.and_then(|link| source.join(link).ok()) else {
            continue;
        };
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.as_str().len() > 4096
        {
            continue;
        }
        url.set_fragment(None);
        let url = url.to_string();
        if !seen.insert(url.clone()) {
            continue;
        }
        // Feeds often supply a short teaser alongside full content; prefer the supplied body for offline preview.
        let summary = entry
            .content
            .and_then(|content| content.body)
            .filter(|body| !plain(body, 1).is_empty())
            .or_else(|| entry.summary.map(|text| text.content))
            .unwrap_or_default();
        items.push(ParsedEntry {
            key: format!("{:x}", Sha256::digest(url.as_bytes())),
            title: entry
                .title
                .map(|title| plain(&title.content, 200))
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "未命名文章".into()),
            url,
            summary: plain(&summary, 20_000),
            published_at: entry
                .published
                .or(entry.updated)
                .map(|date| date.to_rfc3339()),
        });
    }
    Ok(ParsedFeed { title, items })
}
