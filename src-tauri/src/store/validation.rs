use chrono::{DateTime, SecondsFormat, Utc};
use regex::Regex;
use std::sync::LazyLock;
use url::Url;

pub const MAX_BODY: usize = 1_000_000;
pub const MAX_BACKUP_BYTES: usize = 25 * 1024 * 1024;
pub const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
static UUID: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$").unwrap()
});
static DATE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]+)?Z$",
    )
    .unwrap()
});
static JUEJIN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^/post/([0-9]+)/?$").unwrap());
static X_POST: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^/([A-Za-z0-9_]{1,15})/status/([0-9]+)/?$").unwrap());

pub fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// Explicit JavaScript `.length` guards use UTF-16 units.
pub fn within(text: &str, limit: usize) -> bool {
    text.encode_utf16().take(limit + 1).count() <= limit
}

/// Installed Zod string limits count Unicode scalars; they differ from `.length` for emoji.
pub fn schema_within(text: &str, limit: usize) -> bool {
    text.chars().take(limit + 1).count() <= limit
}

pub fn trim(text: &str) -> &str {
    text.trim_matches(|c: char| matches!(c, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}'))
}

pub fn assert_id(id: &str) -> Result<(), String> {
    if UUID.is_match(id) {
        Ok(())
    } else {
        Err("这条记录无效，请重新选择。".into())
    }
}

pub fn positive(value: i64) -> bool {
    (1..=MAX_SAFE_INTEGER).contains(&value)
}

pub fn content(title: &str, body: &str, project: &str) -> bool {
    schema_within(title, 200) && schema_within(body, MAX_BODY) && schema_within(project, 80)
}

pub fn timestamp(value: &str) -> bool {
    if !DATE.is_match(value) {
        return false;
    }
    DateTime::parse_from_rfc3339(value).is_ok()
}

pub fn normalize_reading_url(raw: &str) -> Result<String, String> {
    if !within(raw, 4096) {
        return Err("链接过长，请检查后重试。".into());
    }
    let parsed =
        Url::parse(trim(raw)).map_err(|_| "请输入完整的 http 或 https 链接。".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some_and(|p| !p.is_empty())
    {
        return Err("只支持不含账号密码的 http 或 https 链接。".into());
    }
    Ok(parsed.into())
}

pub struct PublicationUrl {
    pub platform: String,
    pub url: String,
    pub identity: String,
}

/// Post IDs stay stable when a handle or tracking query changes.
pub fn publication_url(raw: &str) -> Result<PublicationUrl, String> {
    let normalized = normalize_reading_url(raw)?;
    let url = Url::parse(&normalized).map_err(|e| e.to_string())?;
    if url.scheme() != "https" || url.port().is_some() {
        return Err("请粘贴掘金或 X 的 https 文章链接。".into());
    }
    if url.host_str() == Some("juejin.cn") {
        if let Some(found) = JUEJIN.captures(url.path()) {
            return Ok(PublicationUrl {
                platform: "juejin".into(),
                url: format!("https://juejin.cn/post/{}", &found[1]),
                identity: format!("juejin:{}", &found[1]),
            });
        }
    }
    if url.host_str() == Some("x.com") {
        if let Some(found) = X_POST.captures(url.path()) {
            return Ok(PublicationUrl {
                platform: "x".into(),
                url: format!("https://x.com/{}/status/{}", &found[1], &found[2]),
                identity: format!("x:{}", &found[2]),
            });
        }
    }
    Err("请粘贴具体文章链接，例如 juejin.cn/post/… 或 x.com/用户名/status/…。".into())
}
