import { createHash, randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { Draft, DraftInput, Revision } from "../shared/contracts";
import { Database } from "./database";
import { assertId, draftInputSchema, MAX_BODY, parseInput } from "./validation";

export const hashBody = (body: string): string =>
  createHash("sha256").update(body).digest("hex");

export class Drafts {
  constructor(private readonly db: Database) {}

  get(id: string): Draft {
    assertId(id);
    const draft = this.db.one<Draft>(
      "SELECT payload FROM drafts WHERE id = ?",
      id,
    );
    if (!draft) throw new Error("这篇稿件不存在，请返回列表重新选择。");
    return draft;
  }

  save(input: DraftInput): Draft {
    const value = parseInput(
      draftInputSchema,
      input,
      "稿件内容无效或过长，请检查后重试。",
    );
    return this.db.transaction(() => {
      const previous = value.id ? this.get(value.id) : undefined;
      if (previous && value.expectedRevision !== previous.revision) {
        throw new Error("稿件已发生变化。请重新打开最新内容后再保存。");
      }
      const title = value.title.trim() || "未命名稿件";
      const project = value.project.trim();
      if (
        previous &&
        title === previous.title &&
        value.body === previous.body &&
        project === previous.project
      )
        return previous;
      const now = new Date().toISOString();
      const draft: Draft = {
        id: previous?.id ?? randomUUID(),
        title,
        body: value.body,
        project,
        revision: (previous?.revision ?? 0) + 1,
        archived: previous?.archived ?? false,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      };
      this.db.connection
        .prepare(
          `INSERT INTO drafts(id, body_hash, payload) VALUES(?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET body_hash = excluded.body_hash, payload = excluded.payload`,
        )
        .run(draft.id, hashBody(draft.body), JSON.stringify(draft));
      const revision: Revision = {
        revision: draft.revision,
        title,
        body: draft.body,
        project,
        savedAt: now,
      };
      // Content versions are append-only: restoring old text creates a new revision instead of erasing evidence.
      this.db.connection
        .prepare(
          "INSERT INTO revisions(draft_id, revision, payload) VALUES(?, ?, ?)",
        )
        .run(draft.id, draft.revision, JSON.stringify(revision));
      return draft;
    });
  }

  importMarkdown(
    filename: string,
    text: string,
  ): { draft: Draft; duplicate: boolean; warnings: string[] } {
    if (
      typeof filename !== "string" ||
      filename.length > 4096 ||
      typeof text !== "string" ||
      text.length > MAX_BODY
    ) {
      throw new Error(
        "文章过大或格式无效，请选择 100 万字符以内的 Markdown 文本。",
      );
    }
    const warnings = /!\[[\s\S]*?\]\s*(?:\(|\[)|<img\b/i.test(text)
      ? ["当前版本只导入文字，图片仍需在发布平台添加。"]
      : [];
    const existing = this.db.one<Draft>(
      "SELECT payload FROM drafts WHERE body_hash = ?",
      hashBody(text),
    );
    if (existing && existing.body === text) {
      if (existing.archived) this.archive(existing.id, false);
      return { draft: this.get(existing.id), duplicate: true, warnings };
    }
    const heading = /^#\s+(.+)$/m.exec(text)?.[1]?.trim();
    const title = (
      heading ||
      basename(filename).replace(/\.(?:md|markdown|txt)$/i, "") ||
      "未命名稿件"
    ).slice(0, 200);
    return {
      draft: this.save({ title, body: text, project: "" }),
      duplicate: false,
      warnings,
    };
  }

  archive(id: string, archived: boolean): void {
    if (typeof archived !== "boolean") throw new Error("归档状态无效。");
    const draft = this.get(id);
    this.db.connection
      .prepare("UPDATE drafts SET payload = ? WHERE id = ?")
      .run(
        JSON.stringify({
          ...draft,
          archived,
          updatedAt: new Date().toISOString(),
        }),
        id,
      );
  }

  revisions(id: string): Revision[] {
    this.get(id);
    return this.db.all<Revision>(
      "SELECT payload FROM revisions WHERE draft_id = ? ORDER BY revision DESC",
      id,
    );
  }

  restore(id: string, revision: number, expectedRevision: number): Draft {
    this.get(id);
    if (!Number.isSafeInteger(revision) || revision < 1)
      throw new Error("请选择有效的历史版本。");
    const old = this.db.one<Revision>(
      "SELECT payload FROM revisions WHERE draft_id = ? AND revision = ?",
      id,
      revision,
    );
    if (!old) throw new Error("这个历史版本不存在，请重新选择。");
    return this.save({
      id,
      title: old.title,
      body: old.body,
      project: old.project,
      expectedRevision,
    });
  }
}
