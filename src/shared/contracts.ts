export interface Draft {
  id: string;
  title: string;
  body: string;
  project: string;
  revision: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface DraftInput {
  id?: string;
  title: string;
  body: string;
  project: string;
  expectedRevision?: number;
}
export interface Revision {
  revision: number;
  title: string;
  body: string;
  project: string;
  savedAt: string;
}
export interface Publication {
  id: string;
  draftId: string;
  draftRevision: number;
  title: string;
  platform: "juejin" | "x";
  url: string;
  confirmedAt: string;
  confirmation: "manual";
}
export interface Reading {
  id: string;
  url: string;
  title: string;
  note: string;
  read: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface ReadingInput {
  id?: string;
  url: string;
  title: string;
  note: string;
  read: boolean;
}
export interface Snapshot {
  drafts: Draft[];
  publications: Publication[];
  readings: Reading[];
}
export interface AppInfo {
  version: string;
  dataPath: string;
  platform: string;
  mode: "desktop";
}
export interface WorkbenchAPI {
  snapshot(): Promise<Snapshot>;
  saveDraft(input: DraftInput): Promise<Draft>;
  importMarkdown(): Promise<{
    draft: Draft;
    duplicate: boolean;
    warnings: string[];
  } | null>;
  archiveDraft(id: string, archived: boolean): Promise<void>;
  revisions(id: string): Promise<Revision[]>;
  restoreRevision(
    id: string,
    revision: number,
    expectedRevision: number,
  ): Promise<Draft>;
  recordPublication(
    draftId: string,
    revision: number,
    url: string,
  ): Promise<Publication>;
  saveReading(input: ReadingInput): Promise<Reading>;
  deleteReading(id: string): Promise<void>;
  readingToDraft(id: string): Promise<Draft>;
  copyText(text: string): Promise<void>;
  exportDraft(id: string): Promise<boolean>;
  openExternal(url: string): Promise<void>;
  backup(): Promise<boolean>;
  restoreBackup(): Promise<boolean>;
  info(): Promise<AppInfo>;
  onBeforeClose(handler: (attempt?: number) => void): () => void;
  onCloseCancelled?(handler: () => void): () => void;
  finishClose(attempt?: number): Promise<void>;
}
declare global {
  interface Window {
    workbench?: WorkbenchAPI;
  }
}
