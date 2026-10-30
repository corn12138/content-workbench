use super::{
    assets::Asset,
    media,
    models::{Draft, DraftInput},
    WorkbenchStore,
};
use std::collections::BTreeMap;

pub fn replace_images(body: &str, assets: &BTreeMap<String, Asset>) -> String {
    let mut result = body.to_owned();
    for image in media::images(body).into_iter().rev() {
        let Some(asset) = assets.get(&image.destination) else {
            continue;
        };
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
        result.replace_range(
            image.range,
            &format!("![{alt}](assets/{}{title})", asset.name),
        );
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn images_and_revision_commit_together_and_stale_work_is_rejected() {
        let (_dir, mut store) = super::super::tests::fixture();
        let original = store.save_draft(super::super::tests::draft("Images", "![cover][img]\n\n[img]: https://example.com/x.png \"Caption\"\n\n```md\n![code](https://example.com/x.png)\n```\n")).unwrap();
        let mut bytes = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(2, 2)
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        let asset = Asset::from_bytes(bytes.into_inner()).unwrap();
        let assets = BTreeMap::from([("https://example.com/x.png".to_owned(), asset.clone())]);
        let prepared = store.save_prepared_images(&original, &assets).unwrap();
        assert_eq!(prepared.revision, original.revision + 1);
        assert!(prepared
            .body
            .contains(&format!("![cover](assets/{} \"Caption\")", asset.name)));
        assert!(prepared.body.contains("![code](https://example.com/x.png)"));
        assert_eq!(store.draft_assets(&original.id).unwrap().len(), 1);
        assert_eq!(store.revisions(&original.id).unwrap().len(), 2);
        assert!(store.save_prepared_images(&original, &assets).is_err());
        let backup = store.export_full_backup().unwrap();
        store.restore_full_backup(&backup).unwrap();
        assert_eq!(store.asset(&asset.name).unwrap().bytes, asset.bytes);
        assert_eq!(store.get_draft(&original.id).unwrap(), prepared);
    }
}

impl WorkbenchStore {
    pub fn save_prepared_images(
        &mut self,
        original: &Draft,
        assets: &BTreeMap<String, Asset>,
    ) -> Result<Draft, String> {
        self.transaction(|store| {
            let current = store.get_draft(&original.id)?;
            if current != *original || current.archived {
                return Err("稿件已变化，请重新打开发布预览后准备图片。".into());
            }
            for asset in assets.values() {
                store.put_asset(asset)?;
            }
            store.save_draft(DraftInput {
                id: Some(original.id.clone()),
                title: original.title.clone(),
                body: replace_images(&original.body, assets),
                project: original.project.clone(),
                expected_revision: Some(original.revision),
            })
        })
    }
}
