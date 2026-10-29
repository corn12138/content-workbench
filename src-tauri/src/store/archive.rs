use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io::{Cursor, Read, Write},
};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

pub const MAX_ARCHIVE: usize = 256 * 1024 * 1024;
pub const MAX_FILES: usize = 515;
pub const MAX_LIBRARY_BYTES: usize = 96 * 1024 * 1024;
pub type Files = BTreeMap<String, Vec<u8>>;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    bytes: usize,
    sha256: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    format: String,
    version: u32,
    entries: BTreeMap<String, Entry>,
}

fn entry_limit(name: &str) -> Result<usize, String> {
    Ok(match name {
        "manifest.json" => 1024 * 1024,
        "core.json" => super::validation::MAX_BACKUP_BYTES,
        "library.json" => MAX_LIBRARY_BYTES,
        _ if name
            .strip_prefix("assets/")
            .is_some_and(super::assets::valid_name) =>
        {
            super::assets::MAX_IMAGE_BYTES
        }
        _ => return Err("备份含有未知或不安全的路径。".into()),
    })
}

pub fn write_zip(files: &Files) -> Result<Vec<u8>, String> {
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o600);
    for (name, bytes) in files {
        zip.start_file(name, options).map_err(|e| e.to_string())?;
        zip.write_all(bytes).map_err(|e| e.to_string())?;
    }
    Ok(zip.finish().map_err(|e| e.to_string())?.into_inner())
}

pub fn pack(mut files: Files) -> Result<Vec<u8>, String> {
    if files.len() >= MAX_FILES || files.values().map(Vec::len).sum::<usize>() > MAX_ARCHIVE {
        return Err("备份超过当前 256 MB 上限。".into());
    }
    for (name, bytes) in &files {
        if name == "manifest.json" || bytes.len() > entry_limit(name)? {
            return Err("备份内容超过单项上限。".into());
        }
    }
    let entries = files
        .iter()
        .map(|(name, bytes)| {
            (
                name.clone(),
                Entry {
                    bytes: bytes.len(),
                    sha256: format!("{:x}", Sha256::digest(bytes)),
                },
            )
        })
        .collect();
    let manifest = Manifest {
        format: "content-workbench".into(),
        version: 2,
        entries,
    };
    files.insert(
        "manifest.json".into(),
        serde_json::to_vec(&manifest).map_err(|e| e.to_string())?,
    );
    write_zip(&files)
}

pub fn unpack(bytes: &[u8]) -> Result<Files, String> {
    if bytes.len() > MAX_ARCHIVE {
        return Err("备份文件过大。".into());
    }
    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(|_| "备份包无法读取。")?;
    if archive.len() > MAX_FILES {
        return Err("备份包文件数量过多。".into());
    }
    let mut files = Files::new();
    let mut total = 0;
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|_| "备份包文件无法读取。")?;
        let name = file.name().map_err(|_| "备份文件名称无效。")?.into_owned();
        let limit = entry_limit(&name)?;
        // Whitelisted entries are read into memory, never extracted to paths supplied by the archive.
        if file.is_dir()
            || file
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
            || file.size() > limit as u64
            || files.contains_key(&name)
        {
            return Err("备份文件重复、过大或类型不安全。".into());
        }
        let mut content = Vec::new();
        (&mut file)
            .take((limit + 1) as u64)
            .read_to_end(&mut content)
            .map_err(|_| "备份内容损坏。")?;
        total += content.len();
        if content.len() > limit || total > MAX_ARCHIVE {
            return Err("备份展开后过大。".into());
        }
        files.insert(name, content);
    }
    let manifest: Manifest =
        serde_json::from_slice(&files.remove("manifest.json").ok_or("备份缺少校验清单。")?)
            .map_err(|_| "备份清单无效。")?;
    if manifest.format != "content-workbench"
        || manifest.version != 2
        || manifest.entries.len() != files.len()
    {
        return Err("备份版本或文件清单不匹配。".into());
    }
    for (name, content) in &files {
        let entry = manifest.entries.get(name).ok_or("备份含有未声明文件。")?;
        if entry.bytes != content.len() || entry.sha256 != format!("{:x}", Sha256::digest(content))
        {
            return Err("备份校验失败，当前资料未修改。".into());
        }
    }
    Ok(files)
}
