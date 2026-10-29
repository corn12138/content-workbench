import { contextBridge, ipcRenderer } from "electron";
import type { WorkbenchAPI } from "../shared/contracts";

async function call<T>(name: string, ...args: unknown[]): Promise<T> {
  const result = await ipcRenderer.invoke(`workbench:${name}`, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

// Exposing named business actions prevents renderer content from choosing arbitrary IPC channels.
const api: WorkbenchAPI = {
  snapshot: () => call("snapshot"),
  saveDraft: (input) => call("saveDraft", input),
  importMarkdown: () => call("importMarkdown"),
  archiveDraft: (id, archived) => call("archiveDraft", id, archived),
  revisions: (id) => call("revisions", id),
  restoreRevision: (id, revision, expected) =>
    call("restoreRevision", id, revision, expected),
  recordPublication: (id, revision, url) =>
    call("recordPublication", id, revision, url),
  saveReading: (input) => call("saveReading", input),
  deleteReading: (id) => call("deleteReading", id),
  readingToDraft: (id) => call("readingToDraft", id),
  copyText: (text) => call("copyText", text),
  exportDraft: (id) => call("exportDraft", id),
  openExternal: (url) => call("openExternal", url),
  backup: () => call("backup"),
  restoreBackup: () => call("restoreBackup"),
  info: () => call("info"),
  onBeforeClose: (handler) => {
    const listener = () => handler();
    ipcRenderer.on("workbench:before-close", listener);
    return () => ipcRenderer.removeListener("workbench:before-close", listener);
  },
  finishClose: () => call("finishClose"),
};
contextBridge.exposeInMainWorld("workbench", api);
