use crate::store::feed_models::{ContentFormat, ContentKind, FeedContent};
use regex::Regex;
use sha2::{Digest, Sha256};
use std::{collections::HashSet, sync::LazyLock};
use url::Url;

pub struct ParsedEntry {
    pub key: String,
    pub url: String,
    pub title: String,
    pub summary: String,
    pub content: Option<FeedContent>,
    pub published_at: Option<String>,
}
pub struct ParsedFeed {
    pub title: String,
    pub items: Vec<ParsedEntry>,
}

/// Many RSS 2.0 feeds put the whole article in `<description>` (Atom: `<summary>`). Treat an HTML
/// summary as article text only when it clearly is one: long enough, or with article structure.
/// Short or plain-text summaries stay summaries. The reader still says this may not be the full page.
fn looks_like_article(html: &str, text: &str) -> bool {
    static BLOCKS: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)<(?:h[1-6]|pre|table|img|figure|blockquote)\b").unwrap()
    });
    static PARAGRAPHS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)<p\b").unwrap());
    text.chars().filter(|c| !c.is_whitespace()).count() >= 600
        || BLOCKS.is_match(html)
        || PARAGRAPHS.find_iter(html).count() >= 3
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
        // Keep feed HTML inert in storage; the renderer sanitizes it before constructing React nodes.
        // Atom text must stay text, even when it contains angle brackets or Markdown punctuation.
        let body = entry
            .content
            .and_then(|c| c.body.map(|body| (body, c.content_type.to_string())))
            .filter(|(body, _)| !body.trim().is_empty());
        let supplied = body
            .map(|(value, mime)| (value, mime, ContentKind::Body))
            .or_else(|| {
                entry
                    .summary
                    .map(|t| (t.content, t.content_type.to_string(), ContentKind::Summary))
            });
        let (summary, content) = match supplied {
            Some((value, mime, kind)) if !value.trim().is_empty() => {
                let format = if mime.contains("html") {
                    ContentFormat::Html
                } else {
                    ContentFormat::Text
                };
                let summary = if format == ContentFormat::Html {
                    plain(&value, 20_000)
                } else {
                    value.chars().take(20_000).collect()
                };
                let kind = if kind == ContentKind::Summary
                    && format == ContentFormat::Html
                    && looks_like_article(&value, &summary)
                {
                    ContentKind::Body
                } else {
                    kind
                };
                let truncated = value.chars().count() > 100_000;
                (
                    summary,
                    Some(FeedContent {
                        format,
                        kind,
                        truncated,
                        value: value.chars().take(100_000).collect(),
                    }),
                )
            }
            _ => (String::new(), None),
        };
        items.push(ParsedEntry {
            key: format!("{:x}", Sha256::digest(url.as_bytes())),
            title: entry
                .title
                .map(|title| plain(&title.content, 200))
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "未命名文章".into()),
            url,
            summary,
            content,
            published_at: entry
                .published
                .or(entry.updated)
                .map(|date| date.to_rfc3339()),
        });
    }
    Ok(ParsedFeed { title, items })
}
