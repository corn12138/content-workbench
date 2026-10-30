use crate::{
    feed_parse::{self, ParsedFeed},
    store::feed_models::Feed,
};
use reqwest::{
    blocking::Client,
    header::{ETAG, LAST_MODIFIED, LOCATION},
    redirect::Policy,
    StatusCode,
};
use std::{
    io::Read,
    net::{IpAddr, SocketAddr, ToSocketAddrs},
    time::Duration,
};
use url::Url;

pub enum Fetched {
    NotModified,
    Content {
        parsed: ParsedFeed,
        etag: Option<String>,
        last_modified: Option<String>,
    },
}

pub fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, _, _] = ip.octets();
            !ip.is_private()
                && !ip.is_loopback()
                && !ip.is_link_local()
                && !ip.is_broadcast()
                && !ip.is_documentation()
                && a != 0
                && a < 224
                && !(a == 100 && (64..=127).contains(&b))
                && !(a == 198 && (18..=19).contains(&b))
                && !(a == 192 && b == 0)
        }
        IpAddr::V6(ip) => {
            let parts = ip.segments();
            (parts[0] & 0xe000) == 0x2000
                && parts[0] != 0x2002
                && !(parts[0] == 0x2001 && (parts[1] < 0x200 || parts[1] == 0xdb8))
        }
    }
}

pub fn feed_url(raw: &str) -> Result<Url, String> {
    let mut url = Url::parse(raw.trim()).map_err(|_| "请填写完整的 RSS 或 Atom 地址。")?;
    if raw.len() > 4096
        || !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || !matches!(url.port_or_known_default(), Some(80 | 443))
    {
        return Err("订阅需要不含账号密码的普通 http 或 https 地址。".into());
    }
    let host = url
        .host_str()
        .ok_or("订阅地址缺少网站名称。")?
        .trim_matches(['[', ']'])
        .to_ascii_lowercase();
    if host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".internal")
        || host.parse::<IpAddr>().is_ok_and(|ip| !public_ip(ip))
    {
        return Err("暂不支持本机或内网订阅地址。".into());
    }
    url.set_fragment(None);
    Ok(url)
}

pub(crate) fn addresses(url: &Url) -> Result<Vec<SocketAddr>, String> {
    let host = url
        .host_str()
        .unwrap_or_default()
        .trim_matches(['[', ']'])
        .to_owned();
    let port = url.port_or_known_default().unwrap_or(443);
    let (send, receive) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = send.send(
            (host.as_str(), port)
                .to_socket_addrs()
                .map(|values| values.take(16).collect::<Vec<_>>()),
        );
    });
    let addresses = receive
        .recv_timeout(Duration::from_secs(4))
        .map_err(|_| "网站地址解析超时，请稍后重试。")?
        .map_err(|_| "无法解析订阅网站。")?;
    if addresses.is_empty() || addresses.iter().any(|addr| !public_ip(addr.ip())) {
        return Err("订阅地址指向本机或内网，已停止读取。".into());
    }
    Ok(addresses)
}

fn header(
    response: &reqwest::blocking::Response,
    name: reqwest::header::HeaderName,
) -> Option<String> {
    response
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .filter(|value| value.len() <= 1024)
        .map(str::to_owned)
}

pub fn fetch(raw: &str, previous: Option<&Feed>) -> Result<Fetched, String> {
    let mut url = feed_url(raw)?;
    for redirect in 0..=3 {
        let addresses = addresses(&url)?;
        // Pin the validated addresses, including after redirects; a second DNS lookup could bypass the private-address check.
        let client = Client::builder()
            .no_proxy()
            .redirect(Policy::none())
            .timeout(Duration::from_secs(12))
            .connect_timeout(Duration::from_secs(5))
            .user_agent("ContentWorkbench/0.2 (+https://github.com/corn12138/content-workbench)")
            .resolve_to_addrs(url.host_str().unwrap_or_default(), &addresses)
            .build()
            .map_err(|_| "无法准备网络连接。")?;
        let mut request = client.get(url.clone());
        if redirect == 0 {
            if let Some(feed) = previous {
                if let Some(etag) = &feed.etag {
                    request = request.header("If-None-Match", etag);
                }
                if let Some(modified) = &feed.last_modified {
                    request = request.header("If-Modified-Since", modified);
                }
            }
        }
        let response = request.send().map_err(|error| {
            if error.is_timeout() {
                "订阅更新超时，请稍后重试。"
            } else {
                "无法连接订阅网站，请检查网络后重试。"
            }
        })?;
        if response.status() == StatusCode::NOT_MODIFIED && previous.is_some() {
            return Ok(Fetched::NotModified);
        }
        if response.status().is_redirection() {
            if redirect == 3 {
                return Err("订阅地址跳转过多。".into());
            }
            let next = response
                .headers()
                .get(LOCATION)
                .and_then(|s| s.to_str().ok())
                .ok_or("订阅跳转地址无效。")?;
            let next = url.join(next).map_err(|_| "订阅跳转地址无效。")?;
            if url.scheme() == "https" && next.scheme() != "https" {
                return Err("订阅跳转到了不安全的连接。".into());
            }
            url = feed_url(next.as_str())?;
            continue;
        }
        if !response.status().is_success() {
            return Err(format!(
                "订阅网站暂时无法读取（{}）。",
                response.status().as_u16()
            ));
        }
        if response
            .content_length()
            .is_some_and(|size| size > 4 * 1024 * 1024)
        {
            return Err("订阅内容过大。".into());
        }
        let etag = header(&response, ETAG);
        let last_modified = header(&response, LAST_MODIFIED);
        let mut bytes = Vec::new();
        response
            .take(4 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "订阅内容读取中断，请重试。")?;
        return Ok(Fetched::Content {
            parsed: feed_parse::parse(&bytes, &url)?,
            etag,
            last_modified,
        });
    }
    Err("订阅更新未完成。".into())
}
