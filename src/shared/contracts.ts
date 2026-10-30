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
  confirmation: "manual" | "api";
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
export interface Feed {
  id: string;
  enabled: boolean;
  url: string;
  title: string;
  checkedAt: string | null;
  etag: string | null;
  lastModified: string | null;
  error: string | null;
}
export interface FeedItem {
  feedId: string;
  key: string;
  readingId: string | null;
  title: string;
  url: string;
  summary: string;
  publishedAt: string | null;
}
export interface Library {
  feeds: Feed[];
  items: FeedItem[];
}
export interface XAccount {
  connected: boolean;
  username: string | null;
  clientId: string;
  callback: string;
}
export interface PublishReceipt {
  url: string;
  recorded: boolean;
  warning: string | null;
}
export interface WorkbenchAPI {
  checkUpdate?(): Promise<{ version: string; notes: string } | null>;
  installUpdate?(version: string): Promise<void>;
  openUpdateBackups?(): Promise<void>;
  onUpdateProgress?(handler: (message: string) => void): () => void;
  prepareImages?(
    id: string,
    revision: number,
  ): Promise<{ draft: Draft; count: number; warnings: string[] }>;
  xAccount?(): Promise<XAccount>;
  xConnect?(clientId: string): Promise<XAccount>;
  xCancel?(): Promise<void>;
  xDisconnect?(): Promise<string>;
  xPublish?(input: {
    draftId: string;
    revision: number;
    text: string;
    acknowledged: boolean;
    expectedUsername: string;
  }): Promise<PublishReceipt>;

  insertImage?(): Promise<string | null>;
  remoteImagePreview?(url: string): Promise<string>;
  assetData?(name: string): Promise<string>;
  library?(): Promise<Library>;
  addFeed?(url: string): Promise<Feed>;
  refreshFeed?(id: string): Promise<Feed>;
  unsubscribe?(id: string): Promise<void>;
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
