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
  /** Present when the user corrected a manually recorded link. */
  correctedAt?: string;
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
  content?: { format: "html" | "text"; kind: "body" | "summary"; value: string; truncated: boolean };
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
  /** Where the Client ID came from; absent on older native builds. */
  clientSource?: "connected" | "saved" | "default" | "none";
  needsReconnect?: boolean;
  callback: string;
}
export type Platform = "juejin" | "x";
export interface PreparedImage {
  position: number;
  source: string;
  filename: string | null;
  status: "ready" | "failed";
  error: string | null;
}
export interface Preparation {
  draftId: string;
  platform: Platform;
  revision: number;
  contentHash: string;
  xText: string | null;
  xMode: "web" | "api" | null;
  pendingUrl: string;
  images: PreparedImage[];
  imagesRevision: number | null;
  updatedAt: string;
}
export interface PreparationInput {
  draftId: string;
  platform: Platform;
  revision: number;
  xText?: string | null;
  xMode?: "web" | "api" | null;
  pendingUrl: string;
}
export interface NoteSource {
  readingId: string;
  title: string;
  url: string;
}
export interface DraftSources {
  draftId: string;
  composeKey: string;
  sources: NoteSource[];
  createdAt: string;
}
/** null or a missing key means unknown; 0 is an explicit zero. */
export type Metrics = Record<string, number | null>;
export interface Feedback {
  id: string;
  publicationId: string;
  platform: Platform;
  source: "manual" | "api";
  observedAt: string;
  metrics: Metrics;
  note: string;
  createdAt: string;
}
export interface FeedbackInput {
  publicationId: string;
  observedAt: string;
  metrics: Metrics;
  note: string;
}
export interface Workflow {
  preparations: Preparation[];
  sources: DraftSources[];
  feedback: Feedback[];
  /** Deleted drafts kept hidden because publication records still point at them. */
  removedDrafts?: { draftId: string; removedAt: string }[];
}
export interface ExportReceipt {
  filename: string;
  bundled: boolean;
  images: number;
  missing: number;
  remote: number;
}
export interface BackupReceipt {
  filename: string;
  size: number;
  savedAt: string;
  exists: boolean;
}
export interface BackupSummary {
  format: string;
  exportedAt: string;
  drafts: number;
  archivedDrafts: number;
  revisions: number;
  publications: number;
  readings: number;
  notes: number;
  feeds: number;
  feedItems: number;
  images: number;
  preparations: number;
  compositions: number;
  feedback: number;
}
export interface BackupPreview {
  token: string;
  filename: string;
  size: number;
  summary: BackupSummary;
}
export interface OpmlEntry {
  url: string;
  title: string;
  status: "new" | "resubscribe" | "duplicate" | "invalid" | "blocked" | "overLimit";
  reason: string | null;
}
export interface UpdateProgress {
  stage: "download" | "verify" | "backup" | "backedUp" | "install" | "restart" | "unknown";
  message: string;
}
export interface PublishReceipt {
  url: string;
  recorded: boolean;
  warning: string | null;
}
export interface WorkbenchAPI {
  checkUpdate?(): Promise<{ version: string; notes: string } | null>;
  installUpdate?(version: string): Promise<void>;
  /** Downloads and verifies a checked update in the background; installs nothing. */
  downloadUpdate?(version: string): Promise<void>;
  /** Quit path: installs the downloaded update (after backup) and exits; rejects and cancels the quit on failure. */
  finishCloseWithUpdate?(attempt: number | undefined, version: string): Promise<void>;
  openUpdateBackups?(): Promise<void>;
  onUpdateProgress?(handler: (progress: UpdateProgress) => void): () => void;
  prepareImages?(
    id: string,
    revision: number,
  ): Promise<{
    draft: Draft;
    count: number;
    warnings: string[];
    images?: PreparedImage[];
    folder?: boolean;
  }>;
  openPreparedImages?(draftId: string): Promise<void>;
  workflow?(): Promise<Workflow>;
  savePreparation?(input: PreparationInput): Promise<Preparation>;
  clearPreparation?(draftId: string, platform: Platform): Promise<void>;
  updatePublication?(id: string, url: string): Promise<Publication>;
  removePublication?(id: string): Promise<void>;
  /** Hides the draft; the undo toast calls restoreRemovedDraft (possible until the app restarts). */
  removeDraft?(id: string): Promise<void>;
  restoreRemovedDraft?(id: string): Promise<Draft>;
  /** Deletes a subscription and its articles; articles with notes are kept unless withNotes. */
  deleteFeed?(id: string, withNotes: boolean): Promise<void>;
  saveFeedback?(input: FeedbackInput): Promise<Feedback>;
  deleteFeedback?(id: string): Promise<void>;
  composeNotes?(ids: string[]): Promise<{ draft: Draft; duplicate: boolean }>;
  /** Saves the editor's current, possibly unsaved content; never changes the stored draft. */
  exportCurrent?(input: { title: string; body: string; project: string }): Promise<ExportReceipt | null>;
  opmlPreview?(): Promise<{ filename: string; entries: OpmlEntry[] } | null>;
  exportOpml?(): Promise<{ filename: string; count: number } | null>;
  createBackup?(): Promise<BackupReceipt | null>;
  lastBackup?(): Promise<BackupReceipt | null>;
  revealBackup?(): Promise<void>;
  inspectBackup?(): Promise<BackupPreview | null>;
  cancelRestore?(): Promise<void>;
  restoreInspected?(token: string): Promise<boolean>;
  xSaveClientId?(clientId: string): Promise<XAccount>;
  xMetrics?(publicationId: string): Promise<Feedback>;
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
