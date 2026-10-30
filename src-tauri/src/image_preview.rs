use crate::{
    feed_fetch,
    state::trusted,
    store::assets::{Asset, MAX_IMAGE_BYTES},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{io::Read, time::Duration};
use tauri::WebviewWindow;

// Explicit preview requests do not persist tracking URLs or downloaded bytes into article backups.
pub(crate) fn fetch_asset(raw: &str) -> Result<Asset, String> {
    let mut url = feed_fetch::feed_url(raw).map_err(|_| "请使用不含账号密码的公网图片地址。")?;
    for hop in 0..=3 {
        let addresses = feed_fetch::addresses(&url)?;
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(12))
            .connect_timeout(Duration::from_secs(5))
            .resolve_to_addrs(url.host_str().unwrap_or_default(), &addresses)
            .build()
            .map_err(|_| "无法连接图片网站。")?;
        let response = client
            .get(url.clone())
            .send()
            .map_err(|_| "图片加载失败，请检查网络或原始链接。")?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or("图片跳转地址无效。")?;
            let next = url.join(location).map_err(|_| "图片跳转地址无效。")?;
            if hop == 3 || url.scheme() == "https" && next.scheme() != "https" {
                return Err("图片跳转不安全或过多。".into());
            }
            url = feed_fetch::feed_url(next.as_str())?;
            continue;
        }
        if !response.status().is_success() {
            return Err("图片网站拒绝读取，请检查原图是否需要登录。".into());
        }
        if response
            .content_length()
            .is_some_and(|n| n > MAX_IMAGE_BYTES as u64)
        {
            return Err("图片不能超过 10 MB。".into());
        }
        let mut bytes = Vec::new();
        response
            .take((MAX_IMAGE_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| "图片未完整接收。")?;
        return Asset::from_bytes(bytes);
    }
    Err("图片无法读取。".into())
}
#[tauri::command]
pub async fn remote_image_preview(window: WebviewWindow, url: String) -> Result<String, String> {
    trusted(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let asset = fetch_asset(&url)?;
        Ok(format!(
            "data:{};base64,{}",
            asset.mime,
            STANDARD.encode(asset.bytes)
        ))
    })
    .await
    .map_err(|_| "图片预览未完成。".to_string())?
}
#[cfg(test)]
mod tests {
    #[test]
    #[ignore = "explicit public-network verification only"]
    fn public_project_icon_can_be_saved() {
        let asset = super::fetch_asset("https://raw.githubusercontent.com/corn12138/content-workbench/main/src-tauri/icons/128x128.png").unwrap();
        assert_eq!(asset.mime, "image/png");
        assert!(!asset.bytes.is_empty());
    }
    #[test]
    fn private_image_destinations_are_rejected_before_fetch() {
        for url in [
            "file:///etc/passwd",
            "http://127.0.0.1/a.png",
            "http://[::1]/a.png",
            "https://name:pass@example.com/a.png",
        ] {
            assert!(super::fetch_asset(url).is_err());
        }
    }
}
