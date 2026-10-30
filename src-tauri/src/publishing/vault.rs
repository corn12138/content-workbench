use super::Credentials;
use sha2::{Digest, Sha256};
use std::path::Path;

fn account(directory: &Path) -> String {
    // Development, test and production data directories must never share an account token.
    format!(
        "x-{:x}",
        Sha256::digest(directory.to_string_lossy().as_bytes())
    )
}
const SERVICE: &str = "local.contentworkbench.oauth";
#[cfg(target_os = "macos")]
pub fn read(directory: &Path) -> Result<Option<Credentials>, String> {
    match security_framework::passwords::get_generic_password(SERVICE, &account(directory)) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| "账号凭证无法读取，请断开后重新授权。".into()),
        Err(e) if e.code() == -25300 => Ok(None),
        Err(_) => Err("无法访问系统钥匙串，请允许访问或解锁后重试。".into()),
    }
}
#[cfg(target_os = "macos")]
pub fn save(directory: &Path, credentials: &Credentials) -> Result<(), String> {
    let bytes = serde_json::to_vec(credentials).map_err(|_| "无法保存账号凭证。")?;
    security_framework::passwords::set_generic_password(SERVICE, &account(directory), &bytes)
        .map_err(|_| "无法保存到系统钥匙串，账号尚未连接。".into())
}
#[cfg(target_os = "macos")]
pub fn delete(directory: &Path) -> Result<(), String> {
    match security_framework::passwords::delete_generic_password(SERVICE, &account(directory)) {
        Ok(()) => Ok(()),
        Err(e) if e.code() == -25300 => Ok(()),
        Err(_) => Err("无法移除本机凭证，请检查钥匙串访问权限。".into()),
    }
}
#[cfg(not(target_os = "macos"))]
pub fn read(_: &Path) -> Result<Option<Credentials>, String> {
    Err("X 授权暂仅支持 macOS 钥匙串。".into())
}
#[cfg(not(target_os = "macos"))]
pub fn save(_: &Path, _: &Credentials) -> Result<(), String> {
    Err("当前系统尚未接入安全凭证保存。".into())
}
#[cfg(not(target_os = "macos"))]
pub fn delete(_: &Path) -> Result<(), String> {
    Err("当前系统尚未接入安全凭证保存。".into())
}
