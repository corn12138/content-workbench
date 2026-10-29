use super::{
    models::Backup,
    validation::{self, MAX_BACKUP_BYTES},
};
use std::collections::{HashMap, HashSet};

fn unique(values: impl Iterator<Item = String>, label: &str) -> Result<(), String> {
    let mut seen = HashSet::new();
    for value in values {
        if !seen.insert(value) {
            return Err(format!("备份中有重复的{label}，未恢复。"));
        }
    }
    Ok(())
}

pub(super) fn validate_backup(json: &str) -> Result<Backup, String> {
    if json.len() > MAX_BACKUP_BYTES {
        return Err("备份文件过大，支持 25 MB 以内的内容备份。".into());
    }
    let raw: serde_json::Value = serde_json::from_str(json)
        .map_err(|_| "无法读取备份文件，请选择本工具导出的 JSON 备份。".to_string())?;
    let mut backup: Backup = serde_json::from_value(raw)
        .map_err(|_| "备份格式或版本不兼容，当前资料未改变。".to_string())?;
    if !valid_shape(&backup) {
        return Err("备份格式或版本不兼容，当前资料未改变。".into());
    }
    unique(backup.drafts.iter().map(|item| item.id.clone()), "稿件")?;
    unique(
        backup.readings.iter().map(|item| item.id.clone()),
        "阅读记录",
    )?;
    let reading_urls = backup
        .readings
        .iter()
        .map(|item| validation::normalize_reading_url(&item.url))
        .collect::<Result<Vec<_>, _>>()?;
    unique(reading_urls.into_iter(), "链接")?;
    unique(
        backup.publications.iter().map(|item| item.id.clone()),
        "发布记录",
    )?;
    let identities = backup
        .publications
        .iter()
        .map(|item| validation::publication_url(&item.url).map(|parsed| parsed.identity))
        .collect::<Result<Vec<_>, _>>()?;
    unique(identities.into_iter(), "线上作品")?;
    unique(
        backup
            .revisions
            .iter()
            .map(|item| format!("{}:{}", item.draft_id, item.revision)),
        "历史版本",
    )?;

    let drafts: HashMap<_, _> = backup.drafts.iter().map(|d| (d.id.as_str(), d)).collect();
    let revisions: HashMap<_, _> = backup
        .revisions
        .iter()
        .map(|r| ((r.draft_id.as_str(), r.revision), r))
        .collect();
    let mut counts = HashMap::<&str, i64>::new();
    for revision in &backup.revisions {
        if drafts
            .get(revision.draft_id.as_str())
            .is_none_or(|d| revision.revision > d.revision)
        {
            return Err("备份的历史版本关联不完整，未恢复。".into());
        }
        *counts.entry(revision.draft_id.as_str()).or_default() += 1;
    }
    for draft in &backup.drafts {
        let current = revisions.get(&(draft.id.as_str(), draft.revision));
        // Unique, positive versions bounded by the current number make this count a continuity check.
        if counts.get(draft.id.as_str()) != Some(&draft.revision)
            || current.is_none_or(|r| {
                r.title != draft.title || r.body != draft.body || r.project != draft.project
            })
        {
            return Err("备份的稿件与历史版本不一致，未恢复。".into());
        }
    }
    for publication in &mut backup.publications {
        let revision = revisions.get(&(publication.draft_id.as_str(), publication.draft_revision));
        let parsed = validation::publication_url(&publication.url)?;
        if revision.is_none_or(|r| r.title != publication.title)
            || publication.platform != parsed.platform
        {
            return Err("备份的发布记录关联不完整，未恢复。".into());
        }
        publication.url = parsed.url;
    }
    for reading in &mut backup.readings {
        reading.url = validation::normalize_reading_url(&reading.url)?;
    }
    Ok(backup)
}

fn valid_shape(backup: &Backup) -> bool {
    let id = |value: &str| validation::assert_id(value).is_ok();
    backup.format == "content-workbench"
        && backup.version == 1
        && validation::timestamp(&backup.exported_at)
        && backup.drafts.len() <= 10_000
        && backup.revisions.len() <= 100_000
        && backup.publications.len() <= 20_000
        && backup.readings.len() <= 20_000
        && backup.drafts.iter().all(|d| {
            id(&d.id)
                && validation::content(&d.title, &d.body, &d.project)
                && validation::positive(d.revision)
                && validation::timestamp(&d.created_at)
                && validation::timestamp(&d.updated_at)
        })
        && backup.revisions.iter().all(|r| {
            id(&r.draft_id)
                && validation::content(&r.title, &r.body, &r.project)
                && validation::positive(r.revision)
                && validation::timestamp(&r.saved_at)
        })
        && backup.publications.iter().all(|p| {
            id(&p.id)
                && id(&p.draft_id)
                && validation::positive(p.draft_revision)
                && validation::schema_within(&p.title, 200)
                && validation::schema_within(&p.url, 4096)
                && matches!(p.platform.as_str(), "juejin" | "x")
                && p.confirmation == "manual"
                && validation::timestamp(&p.confirmed_at)
        })
        && backup.readings.iter().all(|r| {
            id(&r.id)
                && validation::schema_within(&r.title, 200)
                && validation::schema_within(&r.url, 4096)
                && validation::schema_within(&r.note, validation::MAX_BODY)
                && validation::timestamp(&r.created_at)
                && validation::timestamp(&r.updated_at)
        })
}
