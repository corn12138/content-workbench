import type {
  Draft,
  DraftInput,
  Publication,
  Reading,
  ReadingInput,
  Revision,
  Snapshot,
} from "../shared/contracts";
import { Backups } from "./backup";
import { Database } from "./database";
import { Drafts } from "./drafts";
import { Records } from "./records";

/** Single synchronous owner of local data; callers expose business operations, never raw SQL. */
export class WorkbenchStore {
  private readonly database: Database;
  private readonly drafts: Drafts;
  private readonly records: Records;
  private readonly backups: Backups;

  constructor(dataDirectory: string) {
    this.database = new Database(dataDirectory);
    this.drafts = new Drafts(this.database);
    this.records = new Records(this.database, this.drafts);
    this.backups = new Backups(this.database, () => this.snapshot());
  }

  snapshot(): Snapshot {
    const sortByUpdated = <T extends { updatedAt: string }>(items: T[]) =>
      items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return {
      drafts: sortByUpdated(
        this.database.all<Draft>("SELECT payload FROM drafts"),
      ),
      publications: this.database
        .all<Publication>("SELECT payload FROM publications")
        .sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt)),
      readings: sortByUpdated(
        this.database.all<Reading>("SELECT payload FROM readings"),
      ),
    };
  }

  saveDraft(input: DraftInput): Draft {
    return this.drafts.save(input);
  }
  importMarkdown(
    filename: string,
    text: string,
  ): { draft: Draft; duplicate: boolean; warnings: string[] } {
    return this.drafts.importMarkdown(filename, text);
  }
  archiveDraft(id: string, archived: boolean): void {
    this.drafts.archive(id, archived);
  }
  revisions(id: string): Revision[] {
    return this.drafts.revisions(id);
  }
  restoreRevision(
    id: string,
    revision: number,
    expectedRevision: number,
  ): Draft {
    return this.drafts.restore(id, revision, expectedRevision);
  }
  recordPublication(
    draftId: string,
    revision: number,
    url: string,
  ): Publication {
    return this.records.recordPublication(draftId, revision, url);
  }
  saveReading(input: ReadingInput): Reading {
    return this.records.saveReading(input);
  }
  deleteReading(id: string): void {
    this.records.deleteReading(id);
  }
  readingToDraft(id: string): Draft {
    return this.records.readingToDraft(id);
  }
  exportBackup(): string {
    return this.backups.export();
  }
  restoreBackup(json: string): void {
    this.backups.restore(json);
  }
  close(): void {
    this.database.close();
  }
}
