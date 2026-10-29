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
