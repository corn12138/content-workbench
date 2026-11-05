use super::{
    assets::{valid_name, Asset, MAX_IMAGE_BYTES},
    models::ImportResult,
    WorkbenchStore,
};
use percent_encoding::percent_decode_str;
use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use std::{
    collections::BTreeMap,
    fs,
    io::Read,
    ops::Range,
    path::{Component, Path},
};

#[derive(Debug)]
pub struct ImageReference {
    pub range: Range<usize>,
    pub destination: String,
    pub alt: String,
    pub title: String,
}

pub fn images(markdown: &str) -> Vec<ImageReference> {
    let mut result = Vec::new();
    let mut current: Option<ImageReference> = None;
    let mut depth = 0;
    // Match the preview's GFM constructs so images in tables and footnotes are bundled too.
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_FOOTNOTES;
    for (event, range) in Parser::new_ext(markdown, options).into_offset_iter() {
        match event {
            Event::Start(Tag::Image {
                dest_url, title, ..
            }) => {
                if depth == 0 {
                    current = Some(ImageReference {
                        range,
                        destination: dest_url.to_string(),
                        alt: String::new(),
                        title: title.to_string(),
                    });
                }
                depth += 1;
            }
            Event::Text(text) | Event::Code(text) => {
                if let Some(image) = current.as_mut() {
                    image.alt.push_str(&text);
                }
            }
            Event::End(TagEnd::Image) => {
                depth -= 1;
                if depth == 0 {
                    if let Some(mut image) = current.take() {
                        image.range.end = range.end;
                        result.push(image);
                    }
                }
            }
            _ => {}
        }
    }
    result
}

pub fn managed_name(destination: &str) -> Option<&str> {
    destination
        .strip_prefix("assets/")
        .filter(|name| valid_name(name))
}

pub fn read_image(path: &Path) -> Result<Asset, String> {
    if !fs::metadata(path).is_ok_and(|metadata| metadata.is_file()) {
        return Err("图片文件不存在。".into());
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(|_| "无法读取图片。")?
        .take((MAX_IMAGE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "无法读取图片。")?;
    Asset::from_bytes(bytes)
}

pub fn relative_image(root: &Path, destination: &str) -> Result<Asset, String> {
    if destination.starts_with('/')
        || destination.starts_with('\\')
        || url::Url::parse(destination).is_ok()
    {
        return Err("外链或绝对路径未导入。".into());
    }
    let value = destination.split(['?', '#']).next().unwrap_or_default();
    let decoded = percent_decode_str(value)
        .decode_utf8()
        .map_err(|_| "图片路径格式无效。")?;
    let relative = Path::new(decoded.as_ref());
    if relative.is_absolute()
        || relative
            .components()
            .any(|part| matches!(part, Component::ParentDir | Component::Prefix(_)))
    {
        return Err("目录外的图片未导入。".into());
    }
    let base = fs::canonicalize(root).map_err(|_| "无法读取文章目录。")?;
    let path = fs::canonicalize(base.join(relative)).map_err(|_| "有图片文件缺失。")?;
    // Resolving symlinks before the boundary check prevents references escaping the selected article folder.
    if !path.starts_with(&base) {
        return Err("目录外的图片未导入。".into());
    }
    read_image(&path)
}

impl WorkbenchStore {
    pub fn import_article(&mut self, path: &Path, text: &str) -> Result<ImportResult, String> {
        let root = path.parent().ok_or("文章目录无效。")?;
        let mut body = text.to_owned();
        let mut assets = BTreeMap::new();
        let mut replacements = Vec::new();
        let mut warnings = Vec::new();
        for image in images(text) {
            let asset = relative_image(root, &image.destination).or_else(|error| {
                managed_name(&image.destination)
                    .map(|name| self.asset(name))
                    .unwrap_or(Err(error))
            });
            match asset {
                Ok(asset) => {
                    let alt = image
                        .alt
                        .replace('\\', "\\\\")
                        .replace('[', "\\[")
                        .replace(']', "\\]");
                    let title = if image.title.is_empty() {
                        String::new()
                    } else {
                        format!(
                            " \"{}\"",
                            image.title.replace('\\', "\\\\").replace('"', "\\\"")
                        )
                    };
                    replacements.push((
                        image.range,
                        format!("![{alt}](assets/{}{title})", asset.name),
                    ));
                    assets.insert(asset.name.clone(), asset);
                }
                Err(error) => {
                    if !warnings.contains(&error) {
                        warnings.push(error);
                    }
                }
            }
        }
        for (range, value) in replacements.into_iter().rev() {
            body.replace_range(range, &value);
        }
        if text.to_ascii_lowercase().contains("<img") {
            warnings.push("HTML 图片不会执行，请使用 Markdown 图片语法。".into());
        }
        self.transaction(|store| {
            for asset in assets.values() {
                store.put_asset(asset)?;
            }
            let mut imported = store.import_markdown(
                path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("文章.md"),
                &body,
            )?;
            imported.warnings = warnings;
            Ok(imported)
        })
    }

    /// Imports a bundle produced by "导出" (article.md + assets). Image names are content hashes and are
    /// re-verified against their bytes before anything is stored.
    pub fn import_bundle(&mut self, filename: &str, bytes: &[u8]) -> Result<ImportResult, String> {
        let files = super::archive::read_article_zip(bytes)?;
        let text = String::from_utf8(files["article.md"].clone())
            .map_err(|_| "文章包中的 article.md 需为 UTF-8 编码。")?;
        let mut assets = BTreeMap::new();
        let mut warnings = Vec::new();
        for image in images(&text) {
            let Some(name) = managed_name(&image.destination) else {
                if url::Url::parse(&image.destination).is_ok() {
                    let note = "外链图片保留为原链接，未下载。".to_string();
                    if !warnings.contains(&note) {
                        warnings.push(note);
                    }
                }
                continue;
            };
            if assets.contains_key(name) {
                continue;
            }
            match files.get(&format!("assets/{name}")) {
                Some(bytes) => {
                    let asset = Asset::from_bytes(bytes.clone())?;
                    if asset.name != name {
                        return Err("文章包中的图片校验失败，未导入。".into());
                    }
                    assets.insert(name.to_owned(), asset);
                }
                None => {
                    let note = "文章包缺少部分图片，相应位置会显示为缺失。".to_string();
                    if !warnings.contains(&note) {
                        warnings.push(note);
                    }
                }
            }
        }
        let markdown_name = std::path::Path::new(filename)
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| format!("{s}.md"))
            .unwrap_or_else(|| "文章.md".into());
        self.transaction(|store| {
            for asset in assets.values() {
                store.put_asset(asset)?;
            }
            let mut imported = store.import_markdown(&markdown_name, &text)?;
            imported.warnings = warnings;
            Ok(imported)
        })
    }

    pub fn draft_assets(&self, id: &str) -> Result<Vec<Asset>, String> {
        let draft = self.get_draft(id)?;
        let mut assets = BTreeMap::new();
        for image in images(&draft.body) {
            if let Some(name) = managed_name(&image.destination) {
                assets.insert(name.to_owned(), self.asset(name)?);
            }
        }
        Ok(assets.into_values().collect())
    }
}
