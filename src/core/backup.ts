import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  Draft,
  Publication,
  Reading,
  Revision,
  Snapshot,
} from "../shared/contracts";
import { Database } from "./database";
import { hashBody } from "./drafts";
import {
  type Backup,
  backupSchema,
  MAX_BACKUP_BYTES,
  normalizeReadingUrl,
  parseInput,
  parsePublicationUrl,
} from "./validation";

function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length)
    throw new Error(`备份中有重复的${label}，未恢复。`);
}

export function validateBackup(json: string): Backup {
  if (
    typeof json !== "string" ||
    Buffer.byteLength(json, "utf8") > MAX_BACKUP_BYTES
  ) {
    throw new Error("备份文件过大，支持 25 MB 以内的内容备份。");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("无法读取备份文件，请选择本工具导出的 JSON 备份。");
  }
  const backup = parseInput(
    backupSchema,
    raw,
    "备份格式或版本不兼容，当前资料未改变。",
  );
  unique(
    backup.drafts.map((item) => item.id),
    "稿件",
  );
  unique(
    backup.readings.map((item) => item.id),
    "阅读记录",
  );
  unique(
    backup.readings.map((item) => normalizeReadingUrl(item.url)),
    "链接",
  );
  unique(
    backup.publications.map((item) => item.id),
    "发布记录",
  );
  unique(
    backup.publications.map((item) => parsePublicationUrl(item.url).identity),
    "线上作品",
  );
  unique(
    backup.revisions.map((item) => `${item.draftId}:${item.revision}`),
    "历史版本",
  );
  const drafts = new Map(backup.drafts.map((draft) => [draft.id, draft]));
  const revisions = new Map(
    backup.revisions.map((item) => [`${item.draftId}:${item.revision}`, item]),
  );
  const revisionCounts = new Map<string, number>();
  for (const revision of backup.revisions) {
    const draft = drafts.get(revision.draftId);
    if (!draft || revision.revision > draft.revision)
      throw new Error("备份的历史版本关联不完整，未恢复。");
    revisionCounts.set(
      revision.draftId,
      (revisionCounts.get(revision.draftId) ?? 0) + 1,
    );
  }
  for (const draft of backup.drafts) {
    const current = revisions.get(`${draft.id}:${draft.revision}`);
    // Complete history keeps old publication references meaningful after restoring a backup.
    if (
      !current ||
      revisionCounts.get(draft.id) !== draft.revision ||
      current.body !== draft.body ||
      current.title !== draft.title ||
      current.project !== draft.project
    ) {
      throw new Error("备份的稿件与历史版本不一致，未恢复。");
    }
  }
  for (const publication of backup.publications) {
    const revision = revisions.get(
      `${publication.draftId}:${publication.draftRevision}`,
    );
    const parsed = parsePublicationUrl(publication.url);
    if (
      !revision ||
      publication.title !== revision.title ||
      publication.platform !== parsed.platform
    ) {
      throw new Error("备份的发布记录关联不完整，未恢复。");
    }
    publication.url = parsed.url;
  }
  for (const reading of backup.readings)
    reading.url = normalizeReadingUrl(reading.url);
  return backup;
}

export class Backups {
  constructor(
    private readonly db: Database,
    private readonly snapshot: () => Snapshot,
  ) {}

  export(): string {
    const snapshot = this.snapshot();
    const rows = this.db.connection
      .prepare(
        "SELECT draft_id, payload FROM revisions ORDER BY draft_id, revision",
      )
      .all() as unknown as { draft_id: string; payload: string }[];
    const backup: Backup = {
      format: "content-workbench",
      version: 1,
      exportedAt: new Date().toISOString(),
      ...snapshot,
      revisions: rows.map((row) => ({
        draftId: row.draft_id,
        ...(JSON.parse(row.payload) as Revision),
      })),
    };
    const json = JSON.stringify(backup, null, 2);
    if (Buffer.byteLength(json, "utf8") > MAX_BACKUP_BYTES) {
      throw new Error(
        "资料超过当前 25 MB 内容备份上限，请先分别导出文章，暂不支持完整恢复。",
      );
    }
    return json;
  }

  restore(json: string): void {
    const backup = validateBackup(json);
    // Validate first; write a recovery copy before the transaction can replace any existing content.
    const filename = `before-restore-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.json`;
    writeFileSync(join(this.db.directory, filename), this.export(), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    this.db.transaction(() => {
      this.db.connection.exec(
        "DELETE FROM publications; DELETE FROM revisions; DELETE FROM drafts; DELETE FROM readings;",
      );
      for (const draft of backup.drafts) this.insertDraft(draft);
      for (const { draftId, ...revision } of backup.revisions) {
        this.db.connection
          .prepare(
            "INSERT INTO revisions(draft_id, revision, payload) VALUES(?, ?, ?)",
          )
          .run(draftId, revision.revision, JSON.stringify(revision));
      }
      for (const publication of backup.publications)
        this.insertPublication(publication);
      for (const reading of backup.readings) this.insertReading(reading);
    });
  }

  private insertDraft(draft: Draft): void {
    this.db.connection
      .prepare("INSERT INTO drafts(id, body_hash, payload) VALUES(?, ?, ?)")
      .run(draft.id, hashBody(draft.body), JSON.stringify(draft));
  }

  private insertPublication(publication: Publication): void {
    const identity = parsePublicationUrl(publication.url).identity;
    this.db.connection
      .prepare(
        "INSERT INTO publications(id, identity, draft_id, revision, payload) VALUES(?, ?, ?, ?, ?)",
      )
      .run(
        publication.id,
        identity,
        publication.draftId,
        publication.draftRevision,
        JSON.stringify(publication),
      );
  }

  private insertReading(reading: Reading): void {
    this.db.connection
      .prepare("INSERT INTO readings(id, url, payload) VALUES(?, ?, ?)")
      .run(reading.id, reading.url, JSON.stringify(reading));
  }
}
