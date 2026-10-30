use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};
use url::Url;

pub const CALLBACK: &str = "http://127.0.0.1:34187/oauth/x/callback";
pub const SCOPES: &str = "tweet.read tweet.write users.read offline.access";

pub fn random_secret() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}
pub fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}
pub fn authorize(client_id: &str, state: &str, verifier: &str) -> Result<Url, String> {
    if client_id.is_empty()
        || client_id.len() > 256
        || !client_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c))
    {
        return Err("请填写 Native App 的公开 Client ID，不是 Client Secret 或访问令牌。".into());
    }
    let mut url = Url::parse("https://x.com/i/oauth2/authorize").unwrap();
    url.query_pairs_mut().extend_pairs([
        ("response_type", "code"),
        ("client_id", client_id),
        ("redirect_uri", CALLBACK),
        ("scope", SCOPES),
        ("state", state),
        ("code_challenge", &challenge(verifier)),
        ("code_challenge_method", "S256"),
    ]);
    Ok(url)
}

fn callback(request: &str, expected: &str) -> Option<Result<String, String>> {
    let line = request.lines().next()?;
    let mut parts = line.split_whitespace();
    if parts.next()? != "GET" {
        return None;
    }
    let target = parts.next()?;
    if !target.starts_with("/oauth/x/callback?") {
        return None;
    }
    let host = request
        .lines()
        .skip(1)
        .filter_map(|l| l.split_once(':'))
        .filter(|(k, _)| k.eq_ignore_ascii_case("host"))
        .collect::<Vec<_>>();
    if host.len() != 1 || host[0].1.trim() != "127.0.0.1:34187" {
        return None;
    }
    let url = Url::parse(&format!("http://127.0.0.1:34187{target}")).ok()?;
    let pairs = url.query_pairs().collect::<Vec<_>>();
    let values = |name: &str| {
        pairs
            .iter()
            .filter(|(k, _)| k == name)
            .map(|(_, v)| v.as_ref())
            .collect::<Vec<_>>()
    };
    if values("state") != [expected] {
        return None;
    }
    if !values("error").is_empty() {
        return Some(Err("已取消 X 授权，未连接账号。".into()));
    }
    let code = values("code");
    if code.len() != 1 || code[0].is_empty() || code[0].len() > 2048 {
        return None;
    }
    Some(Ok(code[0].to_owned()))
}

fn receive(stream: &mut TcpStream) -> Option<String> {
    stream
        .set_read_timeout(Some(Duration::from_millis(250)))
        .ok()?;
    stream
        .set_write_timeout(Some(Duration::from_millis(250)))
        .ok()?;
    let start = Instant::now();
    let mut bytes = Vec::new();
    let mut buffer = [0; 1024];
    while bytes.len() < 8192 && start.elapsed() < Duration::from_secs(1) {
        let count = stream.read(&mut buffer).ok()?;
        if count == 0 {
            return None;
        }
        bytes.extend_from_slice(&buffer[..count]);
        if bytes.windows(4).any(|v| v == b"\r\n\r\n") {
            return String::from_utf8(bytes).ok();
        }
    }
    None
}

pub fn wait(
    listener: TcpListener,
    state: &str,
    epoch: &AtomicU64,
    generation: u64,
) -> Result<String, String> {
    listener
        .set_nonblocking(true)
        .map_err(|_| "无法等待授权回调。")?;
    let deadline = Instant::now() + Duration::from_secs(180);
    while Instant::now() < deadline {
        if epoch.load(Ordering::SeqCst) != generation {
            return Err("授权已取消。".into());
        }
        match listener.accept() {
            Ok((mut stream, peer)) if peer.ip().is_loopback() => {
                let result = receive(&mut stream).and_then(|request| callback(&request, state));
                // No callback parameters are echoed into HTML, logs or the renderer.
                let (status, body) = if result.is_some() {
                    (
                        "200 OK",
                        "Return to Content Workbench to view the authorization result.",
                    )
                } else {
                    ("400 Bad Request", "Invalid authorization callback.")
                };
                let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}", body.len());
                if let Some(result) = result {
                    return result;
                }
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(50))
            }
            Err(_) => return Err("授权回调连接中断，请重试。".into()),
        }
    }
    Err("等待授权超时，请重新连接 X。".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pkce_rfc_vector_and_no_verifier_in_url() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            challenge(verifier),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        let url = authorize("public-id", "nonce", verifier).unwrap();
        assert!(!url.as_str().contains(verifier));
        assert!(url.as_str().contains("code_challenge_method=S256"));
    }
    #[test]
    fn callback_checks_state_host_path_and_duplicate_parameters() {
        let req = |query: &str| {
            format!("GET /oauth/x/callback?{query} HTTP/1.1\r\nHost: 127.0.0.1:34187\r\n\r\n")
        };
        assert_eq!(
            callback(&req("state=nonce&code=example"), "nonce"),
            Some(Ok("example".into()))
        );
        for query in [
            "state=wrong&code=x",
            "state=nonce&state=nonce&code=x",
            "state=nonce&code=x&code=y",
        ] {
            assert!(callback(&req(query), "nonce").is_none());
        }
        assert!(callback(
            &req("state=nonce&code=x").replace("127.0.0.1", "evil.example"),
            "nonce"
        )
        .is_none());
        assert!(callback(&req("state=nonce&error=access_denied"), "nonce")
            .unwrap()
            .is_err());
    }
    #[test]
    fn cancelled_listener_returns_without_waiting_for_browser() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        assert!(wait(listener, "nonce", &AtomicU64::new(1), 0).is_err());
    }
}
