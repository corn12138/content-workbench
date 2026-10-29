import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export class Database {
  readonly connection: DatabaseSync;

  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.connection = new DatabaseSync(join(directory, "workbench.sqlite"));
    this.connection.exec(
      "PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;",
    );
    const version = this.connection.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    if (version.user_version > 1) {
      this.connection.close();
      throw new Error("资料来自更新版本的应用，请升级后打开。");
    }
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, body_hash TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS drafts_body_hash ON drafts(body_hash);
      CREATE TABLE IF NOT EXISTS revisions (
        draft_id TEXT NOT NULL REFERENCES drafts(id), revision INTEGER NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY(draft_id, revision)
      );
      CREATE TABLE IF NOT EXISTS publications (
        id TEXT PRIMARY KEY, identity TEXT NOT NULL UNIQUE, draft_id TEXT NOT NULL, revision INTEGER NOT NULL,
        payload TEXT NOT NULL, FOREIGN KEY(draft_id, revision) REFERENCES revisions(draft_id, revision)
      );
      CREATE TABLE IF NOT EXISTS readings (id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, payload TEXT NOT NULL);
      PRAGMA user_version = 1;
    `);
  }

  all<T>(sql: string, ...values: (string | number)[]): T[] {
    return (
      this.connection.prepare(sql).all(...values) as { payload: string }[]
    ).map((row) => JSON.parse(row.payload) as T);
  }

  one<T>(sql: string, ...values: (string | number)[]): T | undefined {
    const row = this.connection.prepare(sql).get(...values) as
      { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as T) : undefined;
  }

  transaction<T>(operation: () => T): T {
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.connection.exec("COMMIT");
      return result;
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.connection.close();
  }
}
