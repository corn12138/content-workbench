use super::{
    assets::{valid_name, Asset, MAX_IMAGE_BYTES},
    models::ImportResult,
    WorkbenchStore,
};
use percent_encoding::percent_decode_str;
use pulldown_cmark::{Event, Parser, Tag, TagEnd};
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
}

pub fn images(markdown: &str) -> Vec<ImageReference> {
    let mut result = Vec::new();
    let mut current: Option<ImageReference> = None;
    let mut depth = 0;
    for (event, range) in Parser::new(markdown).into_offset_iter() {
        match event {
            Event::Start(Tag::Image { dest_url, .. }) => {
                if depth == 0 {
                    current = Some(ImageReference {
                        range,
                        destination: dest_url.to_string(),
                        alt: String::new(),
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
                    replacements.push((image.range, format!("![{alt}](assets/{})", asset.name)));
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
