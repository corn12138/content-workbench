use reqwest::blocking::{Client, Response};
use serde_json::Value;
use std::{io::Read, time::Duration};

pub fn client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(25))
        .connect_timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法建立 X 连接。".into())
}
pub fn json(response: Response) -> Result<Value, String> {
    let mut bytes = Vec::new();
    response
        .take(128 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "X 响应未完整接收。")?;
    if bytes.len() > 128 * 1024 {
        return Err("X 响应过大。".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "X 响应格式无法识别。".into())
}
pub fn error(status: u16) -> String {
    // Provider responses can echo credentials and submitted text; only fixed local messages cross IPC.
    match status {
        401 => "X 授权已失效，请重新连接账号。",
        402 => "X API 额度不足，请在开发者控制台检查费用与余额。",
        403 => "X 拒绝访问，请检查应用写入权限、账号和 API 额度。",
        429 => "X 请求过于频繁，请稍后再试。",
        400 | 422 => "X 未接受请求，请检查应用配置或发布内容。",
        _ => "X 服务暂时不可用，请稍后重试。",
    }
    .into()
}
pub fn form(path: &str, fields: &[(&str, &str)]) -> Result<Value, String> {
    let body = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(fields.iter().copied())
        .finish();
    let response = client()?
        .post(format!("https://api.x.com/2/oauth2/{path}"))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .map_err(|_| "X 授权请求未完成，请重新连接。")?;
    if !response.status().is_success() {
        return Err(error(response.status().as_u16()));
    }
    json(response)
}
pub fn profile(token: &str) -> Result<(String, String), String> {
    let response = client()?
        .get("https://api.x.com/2/users/me")
        .bearer_auth(token)
        .send()
        .map_err(|_| "无法确认 X 账号，请重新连接。")?;
    if !response.status().is_success() {
        return Err(error(response.status().as_u16()));
    }
    let value = json(response)?;
    let id = value["data"]["id"]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 30 && s.bytes().all(|b| b.is_ascii_digit()))
        .ok_or("X 未返回有效账号。")?;
    let username = value["data"]["username"]
        .as_str()
        .filter(|s| {
            !s.is_empty()
                && s.len() <= 15
                && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
        })
        .ok_or("X 未返回有效账号名。")?;
    Ok((id.into(), username.into()))
}

/// Maps X `public_metrics` to stored metric names. A counter X does not return stays unknown (None);
/// only numbers present in the response become values, including an explicit 0.
pub fn public_metrics(
    value: &Value,
    expected_id: &str,
) -> Result<std::collections::BTreeMap<String, Option<i64>>, String> {
    if value["data"]["id"].as_str() != Some(expected_id) {
        return Err("X 返回的作品与记录不一致，本次数据未保存。".into());
    }
    let metrics = value["data"]["public_metrics"]
        .as_object()
        .ok_or("X 没有返回这条作品的公开数据。")?;
    let read = |key: &str| {
        metrics
            .get(key)
            .and_then(Value::as_i64)
            .filter(|n| (0..=9_007_199_254_740_991).contains(n))
    };
    Ok([
        ("impressions", "impression_count"),
        ("likes", "like_count"),
        ("replies", "reply_count"),
        ("reposts", "retweet_count"),
        ("quotes", "quote_count"),
        ("bookmarks", "bookmark_count"),
    ]
    .into_iter()
    .map(|(name, key)| (name.to_string(), read(key)))
    .collect())
}

pub fn metrics_error(status: u16) -> String {
    match status {
        401 => "X 授权已失效，请重新连接账号后再刷新。",
        402 => "X API 额度不足，读取数据需要可用的 API 额度。",
        403 => "当前授权没有读取这条作品数据的权限。",
        404 => "X 上找不到这条作品，可能已删除或不可见。",
        429 => "X 请求过于频繁，请稍后再刷新。",
        _ => "X 服务暂时不可用，请稍后再刷新。",
    }
    .into()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn metrics_keep_unknown_and_zero_apart_and_check_identity() {
        let sample = serde_json::json!({"data":{"id":"123","text":"ignored","public_metrics":{"impression_count":0,"like_count":5,"reply_count":2,"retweet_count":1,"quote_count":0}}});
        let metrics = public_metrics(&sample, "123").unwrap();
        assert_eq!(metrics["impressions"], Some(0));
        assert_eq!(metrics["likes"], Some(5));
        assert_eq!(metrics["bookmarks"], None);
        assert!(public_metrics(&sample, "999").is_err());
        assert!(public_metrics(&serde_json::json!({"data":{"id":"123"}}), "123").is_err());
        let negative = serde_json::json!({"data":{"id":"1","public_metrics":{"like_count":-1}}});
        assert_eq!(public_metrics(&negative, "1").unwrap()["likes"], None);
        assert!(metrics_error(403).contains("权限"));
    }
}
