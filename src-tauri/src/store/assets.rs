use super::WorkbenchStore;
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{ImageFormat, ImageReader};
use rusqlite::params;
use sha2::{Digest, Sha256};
use std::io::Cursor;

pub const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_ASSET_BYTES: usize = 128 * 1024 * 1024;

#[derive(Clone, Debug)]
pub struct Asset {
    pub name: String,
    pub mime: String,
    pub bytes: Vec<u8>,
}

impl Asset {
    pub fn from_bytes(bytes: Vec<u8>) -> Result<Self, String> {
        if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
            return Err("图片不能超过 10 MB。".into());
        }
        let format = image::guess_format(&bytes).map_err(|_| "图片格式无法识别。")?;
        let (extension, mime) = match format {
            ImageFormat::Png => ("png", "image/png"),
            ImageFormat::Jpeg => ("jpg", "image/jpeg"),
            ImageFormat::Gif => ("gif", "image/gif"),
            ImageFormat::WebP => ("webp", "image/webp"),
            _ => return Err("请选择 PNG、JPEG、GIF 或 WebP 图片。".into()),
        };
        let (width, height) = ImageReader::with_format(Cursor::new(&bytes), format)
            .into_dimensions()
            .map_err(|_| "图片文件不完整。")?;
        if width == 0
            || height == 0
            || width > 16384
            || height > 16384
            || u64::from(width) * u64::from(height) > 32_000_000
        {
            return Err("图片尺寸过大，请缩小后再导入。".into());
        }
        image::load_from_memory_with_format(&bytes, format)
            .map_err(|_| "图片文件损坏，未导入。")?;
        Ok(Self {
            name: format!("{:x}.{extension}", Sha256::digest(&bytes)),
            mime: mime.into(),
            bytes,
        })
    }
}

pub fn valid_name(name: &str) -> bool {
    let Some((hash, extension)) = name.split_once('.') else {
        return false;
    };
    hash.len() == 64
        && hash
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        && matches!(extension, "png" | "jpg" | "gif" | "webp")
}

impl WorkbenchStore {
    pub fn asset_data_url(&self, name: &str) -> Result<String, String> {
        let asset = self.asset(name)?;
        Ok(format!(
            "data:{};base64,{}",
            asset.mime,
            STANDARD.encode(asset.bytes)
        ))
    }

    pub fn asset(&self, name: &str) -> Result<Asset, String> {
        if !valid_name(name) {
            return Err("图片引用无效。".into());
        }
        self.connection
            .query_row("SELECT mime,bytes FROM assets WHERE name=?", [name], |r| {
                Ok(Asset {
                    name: name.into(),
                    mime: r.get(0)?,
                    bytes: r.get(1)?,
                })
            })
            .map_err(|_| "图片未保存在本机，请重新插入图片。".into())
    }

    pub fn put_asset(&mut self, asset: &Asset) -> Result<(), String> {
        let current: i64 = self
            .connection
            .query_row(
                "SELECT COALESCE(SUM(length(bytes)),0) FROM assets",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        let exists: bool = self
            .connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM assets WHERE name=?)",
                [&asset.name],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        let count: i64 = self
            .connection
            .query_row("SELECT COUNT(*) FROM assets", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if !exists && count >= 512 {
            return Err("当前最多保存 512 张图片。".into());
        }
        if !exists && current + asset.bytes.len() as i64 > MAX_ASSET_BYTES as i64 {
            return Err("图片资料已达到当前 128 MB 上限，请先导出整理。".into());
        }
        self.connection
            .execute(
                "INSERT OR IGNORE INTO assets(name,mime,bytes) VALUES(?,?,?)",
                params![asset.name, asset.mime, asset.bytes],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub(super) fn all_assets(&self) -> Result<Vec<Asset>, String> {
        let mut statement = self
            .connection
            .prepare("SELECT name,mime,bytes FROM assets ORDER BY name")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |r| {
                Ok(Asset {
                    name: r.get(0)?,
                    mime: r.get(1)?,
                    bytes: r.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }
}
