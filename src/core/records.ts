import { randomUUID } from "node:crypto";
import type {
  Draft,
  Publication,
  Reading,
  ReadingInput,
  Revision,
} from "../shared/contracts";
import { Database } from "./database";
import { Drafts } from "./drafts";
import {
  assertId,
  normalizeReadingUrl,
  parseInput,
  parsePublicationUrl,
  readingInputSchema,
} from "./validation";

export class Records {
  constructor(
    private readonly db: Database,
    private readonly drafts: Drafts,
  ) {}

  recordPublication(
    draftId: string,
    revision: number,
    rawUrl: string,
  ): Publication {
    this.drafts.get(draftId);
    if (!Number.isSafeInteger(revision) || revision < 1)
      throw new Error("请选择有效的稿件版本。");
    const source = this.db.one<Revision>(
      "SELECT payload FROM revisions WHERE draft_id = ? AND revision = ?",
      draftId,
      revision,
    );
    if (!source) throw new Error("无法找到发布时的稿件版本，请重新准备发布。");
    const parsed = parsePublicationUrl(rawUrl);
    const previous = this.db.one<Publication>(
      "SELECT payload FROM publications WHERE identity = ?",
      parsed.identity,
    );
    if (previous) {
      if (previous.draftId !== draftId || previous.draftRevision !== revision) {
        throw new Error(
          "这篇线上作品已关联其他稿件或版本，请检查链接，不会覆盖原记录。",
        );
      }
      return previous;
    }
    const publication: Publication = {
      id: randomUUID(),
      draftId,
      draftRevision: revision,
      title: source.title,
      platform: parsed.platform,
      url: parsed.url,
      confirmedAt: new Date().toISOString(),
      confirmation: "manual",
    };
    // A pasted URL is a user's record, not proof that the platform published this content or verified ownership.
    this.db.connection
      .prepare(
        "INSERT INTO publications(id, identity, draft_id, revision, payload) VALUES(?, ?, ?, ?, ?)",
      )
      .run(
        publication.id,
        parsed.identity,
        draftId,
        revision,
        JSON.stringify(publication),
      );
    return publication;
  }

  saveReading(input: ReadingInput): Reading {
    const value = parseInput(
      readingInputSchema,
      input,
      "阅读资料内容无效或过长，请检查后重试。",
    );
    const url = normalizeReadingUrl(value.url);
    const existing = value.id ? this.getReading(value.id) : undefined;
    const duplicate = this.db.one<Reading>(
      "SELECT payload FROM readings WHERE url = ?",
      url,
    );
    if (duplicate && duplicate.id !== existing?.id) {
      if (existing) throw new Error("这个链接已经收藏，请打开已有记录。");
      // Re-adding a bookmark must never erase an existing note or reset its reading status.
      return duplicate;
    }
    const now = new Date().toISOString();
    const reading: Reading = {
      id: existing?.id ?? randomUUID(),
      url,
      title: value.title.trim() || new URL(url).hostname,
      note: value.note,
      read: value.read,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.db.connection
      .prepare(
        `INSERT INTO readings(id, url, payload) VALUES(?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET url = excluded.url, payload = excluded.payload`,
      )
      .run(reading.id, reading.url, JSON.stringify(reading));
    return reading;
  }

  getReading(id: string): Reading {
    assertId(id);
    const reading = this.db.one<Reading>(
      "SELECT payload FROM readings WHERE id = ?",
      id,
    );
    if (!reading) throw new Error("这条阅读资料不存在，请返回列表重新选择。");
    return reading;
  }

  deleteReading(id: string): void {
    this.getReading(id);
    this.db.connection.prepare("DELETE FROM readings WHERE id = ?").run(id);
  }

  readingToDraft(id: string): Draft {
    const reading = this.getReading(id);
    if (!reading.note.trim())
      throw new Error("先写下一条收获，再把它整理成草稿。");
    const body = `# ${reading.title}\n\n${reading.note}\n\n来源：${reading.url}\n`;
    return this.drafts.importMarkdown(`${reading.title}.md`, body).draft;
  }
}
