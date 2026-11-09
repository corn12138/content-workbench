use crate::{
    feed_fetch::{feed_url, public_ip},
    feed_parse::parse,
};
use url::Url;

#[test]
fn rss_and_atom_are_plain_text_and_deduplicated() {
    let rss = br#"<rss version="2.0"><channel><title>Technical notes</title><link>https://example.com</link><description>Test</description>
      <item><title>First &amp; useful</title><link>https://example.com/a#part</link><description><![CDATA[<p>Hello <b>world</b><script>steal()</script><img src="https://tracker.invalid/x"></p>]]></description></item>
      <item><title>Duplicate</title><link>https://example.com/a</link></item>
      <item><title>Bad</title><link>javascript:alert(1)</link></item>
    </channel></rss>"#;
    let source = Url::parse("https://example.com/feed.xml").unwrap();
    let feed = parse(rss, &source).unwrap();
    assert_eq!(feed.title, "Technical notes");
    assert_eq!(feed.items.len(), 1);
    assert_eq!(feed.items[0].url, "https://example.com/a");
    assert_eq!(feed.items[0].title, "First & useful");
    assert_eq!(feed.items[0].summary, "Hello world");
    let atom = br#"<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><id>urn:test</id><updated>2026-01-01T00:00:00Z</updated><entry><id>urn:a</id><title>Release</title><link href="/release"/><updated>2026-01-02T00:00:00Z</updated><content type="html">&lt;p&gt;New feature&lt;/p&gt;</content></entry></feed>"#;
    let atom = parse(atom, &source).unwrap();
    assert_eq!(atom.items[0].url, "https://example.com/release");
    assert_eq!(atom.items[0].summary, "New feature");
    assert!(atom.items[0].published_at.is_some());
    assert!(parse(b"<!DOCTYPE rss><rss/>", &source).is_err());
    assert!(parse(b"not rss", &source).is_err());
}

#[test]
fn feed_network_rejects_private_addresses_credentials_and_unexpected_ports() {
    for url in [
        "http://localhost/a",
        "http://127.1/a",
        "http://2130706433/a",
        "http://[::1]/",
        "http://[::ffff:127.0.0.1]/",
        "http://10.0.0.1/feed",
        "http://169.254.169.254/",
        "https://example.com:8443/rss",
        "https://user:password@example.com/feed",
        "file:///tmp/feed.xml",
    ] {
        assert!(feed_url(url).is_err(), "accepted {url}");
    }
    for ip in [
        "0.0.0.0",
        "127.0.0.1",
        "10.0.0.1",
        "172.16.0.1",
        "192.168.1.1",
        "100.64.0.1",
        "169.254.1.1",
        "224.0.0.1",
        "198.19.0.1",
        "::",
        "::1",
        "fe80::1",
        "fc00::1",
        "2001:db8::1",
        "2002:7f00:1::",
    ] {
        assert!(!public_ip(ip.parse().unwrap()), "accepted {ip}");
    }
    assert!(public_ip("8.8.8.8".parse().unwrap()));
    assert!(public_ip("2606:4700:4700::1111".parse().unwrap()));
    assert_eq!(
        feed_url("https://example.com/feed#section")
            .unwrap()
            .as_str(),
        "https://example.com/feed"
    );
}

#[test]
#[ignore = "explicit public-network verification only"]
fn official_rust_feed_can_be_fetched() {
    match crate::feed_fetch::fetch("https://blog.rust-lang.org/feed.xml", None).unwrap() {
        crate::feed_fetch::Fetched::Content { parsed, .. } => assert!(!parsed.items.is_empty()),
        _ => panic!("unexpected empty response"),
    }
}

#[test]
fn preview_prefers_full_content_preserves_paragraphs_and_never_executes_html() {
    let xml = br#"<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Example</title><link>https://example.com</link><description>Test</description><item><title>Post</title><link>https://example.com/post</link><description>Teaser</description><content:encoded><![CDATA[<p>First paragraph</p><p>Second paragraph</p><script>secret()</script><img src="https://example.com/tracker">]]></content:encoded></item></channel></rss>"#;
    let parsed =
        crate::feed_parse::parse(xml, &url::Url::parse("https://example.com/feed").unwrap())
            .unwrap();
    assert_eq!(
        parsed.items[0].summary,
        "First paragraph\n\nSecond paragraph"
    );
}

#[test]
fn structured_feeds_preserve_html_text_kind_and_bound_large_bodies() {
    use crate::store::feed_models::{ContentFormat, ContentKind};
    let xml = br#"<feed xmlns="http://www.w3.org/2005/Atom"><title>Feed</title><id>x</id><updated>2026-01-01T00:00:00Z</updated><entry><id>a</id><title>A</title><link href="https://example.com/a"/><content type="html">&lt;pre&gt;  indented
    code&lt;/pre&gt;</content></entry><entry><id>b</id><title>B</title><link href="https://example.com/b"/><summary type="text">Vec&lt;T&gt; **literal**</summary></entry></feed>"#;
    let parsed = parse(xml, &Url::parse("https://example.com/feed").unwrap()).unwrap();
    let html = parsed.items[0].content.as_ref().unwrap();
    assert_eq!(html.format, ContentFormat::Html);
    assert_eq!(html.kind, ContentKind::Body);
    assert!(html.value.contains("  indented\n    code"));
    let text = parsed.items[1].content.as_ref().unwrap();
    assert_eq!(text.format, ContentFormat::Text);
    assert_eq!(text.kind, ContentKind::Summary);
    assert_eq!(text.value, "Vec<T> **literal**");
    let large = format!(
        r#"<rss version="2.0"><channel><title>Feed</title><link>https://example.com</link><description>x</description><item><link>https://example.com/c</link><description>{}</description></item></channel></rss>"#,
        "字".repeat(100_001)
    );
    let parsed = parse(
        large.as_bytes(),
        &Url::parse("https://example.com/feed").unwrap(),
    )
    .unwrap();
    let content = parsed.items[0].content.as_ref().unwrap();
    assert!(content.truncated);
    assert_eq!(content.value.chars().count(), 100_000);
}

#[test]
fn full_articles_in_rss_description_are_body_but_short_summaries_stay_summaries() {
    use crate::store::feed_models::ContentKind;
    let item = |link: &str, description: &str| {
        format!(r#"<item><title>T</title><link>https://example.com/{link}</link><description><![CDATA[{description}]]></description></item>"#)
    };
    let xml = format!(
        r#"<rss version="2.0"><channel><title>Feed</title><link>https://example.com</link><description>x</description>{}{}{}{}{}</channel></rss>"#,
        item("structured", "<h2>为什么</h2><p>一段。</p><pre><code>BEGIN;</code></pre>"),
        item("paragraphs", "<p>一</p><p>二</p><p>三</p>"),
        item("long", &format!("<p>{}</p>", "字".repeat(600))),
        item("short", "<p>一句话摘要，<a href=\"https://example.com\">阅读全文</a></p>"),
        item("plain", "只有摘要的纯文字。"),
    );
    let parsed = parse(xml.as_bytes(), &Url::parse("https://example.com/feed").unwrap()).unwrap();
    let kinds: Vec<_> = parsed
        .items
        .iter()
        .map(|i| i.content.as_ref().unwrap().kind.clone())
        .collect();
    assert_eq!(
        kinds,
        vec![
            ContentKind::Body,
            ContentKind::Body,
            ContentKind::Body,
            ContentKind::Summary,
            ContentKind::Summary
        ]
    );
}
