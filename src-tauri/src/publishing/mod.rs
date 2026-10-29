mod http;
mod journal;
mod oauth;
mod vault;

use crate::state::{trusted, AppState};
use serde::{Deserialize, Serialize};
use std::{
    net::TcpListener,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

#[derive(Default)]
pub struct PublishingState {
    operation: Mutex<()>,
    epoch: AtomicU64,
}
#[derive(Serialize, Deserialize)]
pub(super) struct Credentials {
    client_id: String,
    access_token: String,
    refresh_token: Option<String>,
    expires_at: i64,
    user_id: String,
    username: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
    connected: bool,
    username: Option<String>,
    client_id: String,
    callback: &'static str,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublishInput {
    draft_id: String,
    revision: i64,
    text: String,
    acknowledged: bool,
    expected_username: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    url: String,
    recorded: bool,
    warning: Option<String>,
}

fn status(credentials: Option<&Credentials>) -> AccountStatus {
    AccountStatus {
        connected: credentials.is_some(),
        username: credentials.map(|c| c.username.clone()),
        client_id: credentials.map(|c| c.client_id.clone()).unwrap_or_else(|| {
            option_env!("WORKBENCH_X_CLIENT_ID")
                .unwrap_or_default()
                .into()
        }),
        callback: oauth::CALLBACK,
    }
}
fn apply_token(
    value: serde_json::Value,
    previous: Option<&Credentials>,
    client_id: String,
) -> Result<Credentials, String> {
    let token = value["access_token"]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 8192)
        .ok_or("X 未返回有效授权，请重新连接。")?;
    if value["token_type"]
        .as_str()
        .is_none_or(|s| !s.eq_ignore_ascii_case("bearer"))
    {
        return Err("X 返回了不支持的授权类型。".into());
    }
    if let Some(scope) = value["scope"].as_str() {
        if ["tweet.read", "tweet.write", "users.read"]
            .iter()
            .any(|s| !scope.split_whitespace().any(|p| p == *s))
        {
            return Err("授权未包含发布权限，请重新连接并允许读写权限。".into());
        }
    } else if previous.is_none() {
        return Err("无法确认 X 授权范围，请重新连接。".into());
    }
    let lifetime = value["expires_in"]
        .as_i64()
        .filter(|v| *v > 0 && *v <= 31_536_000)
        .ok_or("X 授权有效期无法识别。")?;
    let refresh = value["refresh_token"]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 8192)
        .map(String::from)
        .or_else(|| previous.and_then(|c| c.refresh_token.clone()));
    Ok(Credentials {
        client_id,
        access_token: token.into(),
        refresh_token: refresh,
        expires_at: chrono::Utc::now().timestamp() + lifetime,
        user_id: previous.map(|c| c.user_id.clone()).unwrap_or_default(),
        username: previous.map(|c| c.username.clone()).unwrap_or_default(),
    })
}
fn usable(directory: &std::path::Path) -> Result<Credentials, String> {
    let mut credentials = vault::read(directory)?.ok_or("请先连接 X 账号。")?;
    if credentials.expires_at <= chrono::Utc::now().timestamp() + 60 {
        let refresh = credentials
            .refresh_token
            .as_deref()
            .ok_or("授权已过期，请重新连接 X。")?;
        let value = http::form(
            "token",
            &[
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh),
                ("client_id", &credentials.client_id),
            ],
        )?;
        credentials = apply_token(value, Some(&credentials), credentials.client_id.clone())?;
        // Rotation must be durable before any write request; otherwise a restart would lose the new refresh token.
        vault::save(directory, &credentials)?;
    }
    Ok(credentials)
}

#[tauri::command]
pub async fn x_account(window: WebviewWindow, app: AppHandle) -> Result<AccountStatus, String> {
    trusted(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<PublishingState>();
        let _guard = state
            .operation
            .try_lock()
            .map_err(|_| "平台操作正在进行，请稍后。")?;
        Ok(status(
            vault::read(&app.state::<AppState>().directory)?.as_ref(),
        ))
    })
    .await
    .map_err(|_| "无法读取账号连接状态。".to_string())?
}
#[tauri::command]
pub fn x_cancel(window: WebviewWindow, state: State<PublishingState>) -> Result<(), String> {
    trusted(&window)?;
    state.epoch.fetch_add(1, Ordering::SeqCst);
    Ok(())
}
#[tauri::command]
pub async fn x_connect(
    window: WebviewWindow,
    app: AppHandle,
    client_id: String,
) -> Result<AccountStatus, String> {
    trusted(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<PublishingState>();
        let _guard = state
            .operation
            .try_lock()
            .map_err(|_| "平台操作正在进行，请稍后。")?;
        let generation = state.epoch.load(Ordering::SeqCst);
        let verifier = oauth::random_secret();
        let nonce = oauth::random_secret();
        let client_id = client_id.trim().to_string();
        let url = oauth::authorize(&client_id, &nonce, &verifier)?;
        // X requires an exact registered callback; bind only loopback, before opening the browser.
        let listener = TcpListener::bind("127.0.0.1:34187")
            .map_err(|_| "授权端口被占用，请关闭其他授权窗口后重试。")?;
        app.opener()
            .open_url(url.as_str(), None::<&str>)
            .map_err(|_| "无法打开系统浏览器。")?;
        let code = oauth::wait(listener, &nonce, &state.epoch, generation)?;
        let token = http::form(
            "token",
            &[
                ("grant_type", "authorization_code"),
                ("code", &code),
                ("redirect_uri", oauth::CALLBACK),
                ("client_id", &client_id),
                ("code_verifier", &verifier),
            ],
        )?;
        let mut credentials = apply_token(token, None, client_id)?;
        (credentials.user_id, credentials.username) = http::profile(&credentials.access_token)?;
        if state.epoch.load(Ordering::SeqCst) != generation {
            return Err("授权已取消，未保存本机凭证；如需撤销，请前往 X 的已连接应用。".into());
        }
        vault::save(&app.state::<AppState>().directory, &credentials)?;
        Ok(status(Some(&credentials)))
    })
    .await
    .map_err(|_| "X 授权未完成，请重新连接。".to_string())?
}
#[tauri::command]
pub async fn x_disconnect(window: WebviewWindow, app: AppHandle) -> Result<String, String> {
    trusted(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<PublishingState>();
        let _guard = state
            .operation
            .try_lock()
            .map_err(|_| "请先取消正在进行的授权，或等待发布完成。")?;
        let directory = &app.state::<AppState>().directory;
        let credentials = vault::read(directory)?;
        // Local disconnect must remain possible offline. Remote revocation status is reported separately.
        vault::delete(directory)?;
        let mut revoked = true;
        if let Some(c) = credentials {
            for token in std::iter::once(c.access_token.as_str()).chain(c.refresh_token.as_deref())
            {
                revoked &=
                    http::form("revoke", &[("token", token), ("client_id", &c.client_id)]).is_ok();
            }
        }
        Ok(if revoked {
            "已断开 X，并请求撤销平台令牌。"
        } else {
            "本机凭证已移除。平台撤销未确认，请到 X 设置 → 已连接的应用中撤销。"
        }
        .into())
    })
    .await
    .map_err(|_| "断开账号未完成。".to_string())?
}

fn validate_text(text: &str, acknowledged: bool) -> Result<(), String> {
    if text.trim().is_empty() || text.len() > 10_000 {
        return Err("请填写有效的 X 发布内容。".into());
    }
    if text.contains("assets/")
        || text.contains("file://")
        || text.contains("/Users/")
        || text.contains("/private/var/")
    {
        return Err("发布内容包含本机资源路径，请移除后再发布。".into());
    }
    let sensitive = regex::Regex::new(r#"(?i)(sk-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_-]?key|password|token)\s*[:=]\s*["'][^"']{8,}["'])"#).unwrap();
    if sensitive.is_match(text) && !acknowledged {
        return Err("内容可能包含密钥或密码，请先核对公开范围。".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn x_publish(
    window: WebviewWindow,
    app: AppHandle,
    input: PublishInput,
) -> Result<Receipt, String> {
    trusted(&window)?;
    validate_text(&input.text, input.acknowledged)?;
    tauri::async_runtime::spawn_blocking(move || {
        let publishing = app.state::<PublishingState>();
        let _guard = publishing.operation.try_lock().map_err(|_| "平台操作正在进行，请勿重复点击。")?;
        let state = app.state::<AppState>();
        let epoch = state.library_epoch.load(Ordering::SeqCst);
        let draft = state.lock()?.get_draft(&input.draft_id)?;
        if draft.revision != input.revision || draft.archived { return Err("稿件已变化，请重新打开发布预览。".into()); }
        let credentials = usable(&state.directory)?;
        if credentials.username != input.expected_username {
            return Err("账号已变化，请重新打开预览并确认发布账号。".into());
        }
        let client = http::client()?;
        let journal = journal::Journal::open(&state.directory)?;
        let identity = journal::Journal::identity(&credentials.user_id, &input.draft_id, &input.text);
        let url = match journal.claim(&identity)? {
            journal::Claim::Published(url) => url,
            journal::Claim::Uncertain => return Err("上次请求的结果尚未确认，已阻止重复发送。请打开 X 个人主页核实；若已发布，可粘贴链接记录。".into()),
            journal::Claim::New => {
                let response = client.post("https://api.x.com/2/tweets").bearer_auth(&credentials.access_token)
                    .header("Content-Type", "application/json").body(serde_json::json!({"text":input.text.trim()}).to_string()).send()
                    .map_err(|_| "发布结果尚未确认，请到 X 核实；不要重复发送。")?;
                let status = response.status();
                if !status.is_success() {
                    // Only definite provider rejections permit retry. Timeouts, redirects and server errors remain uncertain.
                    if status.is_client_error() && status.as_u16() != 408 { journal.rejected(&identity)?; return Err(http::error(status.as_u16())); }
                    return Err("X 未返回明确发布结果，请到个人主页核实；不要重复发送。".into());
                }
                let value = http::json(response).map_err(|_| "发布结果未完整接收，请到 X 核实；不要重复发送。")?;
                let id = value["data"]["id"].as_str().filter(|s| !s.is_empty() && s.len() <= 30 && s.bytes().all(|b| b.is_ascii_digit())).ok_or("未收到有效发布回执，请到 X 核实；不要重复发送。")?;
                let url = format!("https://x.com/{}/status/{id}", credentials.username);
                if let Err(warning) = journal.finish(&identity, &url) { return Ok(Receipt { url, recorded: false, warning: Some(warning) }); }
                url
            }
        };
        let recorded = match state.lock() {
            Ok(mut store) if state.library_epoch.load(Ordering::SeqCst) == epoch => store.record_api_publication(&input.draft_id, input.revision, &url).is_ok(),
            _ => false,
        };
        Ok(Receipt { url, recorded, warning: (!recorded).then(|| "X 已发布成功，但未能关联当前资料。请复制链接后手动记录，不要再次发布。".into()) })
    }).await.map_err(|_| "发布操作中断，请先到 X 核实结果。".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn insufficient_scope_and_local_assets_are_rejected() {
        let token = serde_json::json!({"access_token":"synthetic", "token_type":"bearer", "expires_in":7200, "scope":"tweet.read users.read"});
        assert!(apply_token(token, None, "client".into()).is_err());
        assert!(validate_text("![image](assets/example.png)", true).is_err());
        assert!(validate_text("password='not-a-real-password'", false).is_err());
        assert!(validate_text("Hello", false).is_ok());
    }
    #[test]
    fn status_never_serializes_tokens() {
        let c = Credentials {
            client_id: "public".into(),
            access_token: "synthetic-access".into(),
            refresh_token: Some("synthetic-refresh".into()),
            expires_at: 0,
            user_id: "123".into(),
            username: "example".into(),
        };
        let text = serde_json::to_string(&status(Some(&c))).unwrap();
        assert!(!text.contains("synthetic"));
        let refreshed = apply_token(
            serde_json::json!({"access_token":"new", "token_type":"bearer", "expires_in":7200}),
            Some(&c),
            "public".into(),
        )
        .unwrap();
        assert_eq!(refreshed.refresh_token, c.refresh_token);
    }
}
