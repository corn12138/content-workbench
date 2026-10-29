import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { WorkbenchAPI } from "../shared/contracts";

const pending = new Set<Promise<unknown>>();

async function call<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const operation = invoke<T>(command, args);
  pending.add(operation);
  try {
    return await operation;
  } catch (error) {
    throw new Error(typeof error === "string" ? error : "操作未完成，请重试。");
  } finally {
    pending.delete(operation);
  }
}

export async function createTauriAPI(): Promise<WorkbenchAPI> {
  const closeHandlers = new Set<(attempt?: number) => void>();
  const cancelHandlers = new Set<() => void>();
  // Register before mounting React so native close cannot overtake asynchronous listener setup.
  const unlisten: UnlistenFn = await listen<number>(
    "workbench:before-close",
    (event) => {
      for (const handler of closeHandlers) handler(event.payload);
    },
  );
  const stopCancel = await listen("workbench:cancel-close", () => {
    for (const handler of cancelHandlers) handler();
  });
  window.addEventListener("unload", stopCancel, { once: true });
  window.addEventListener("unload", unlisten, { once: true });
  return {
    snapshot: () => call("snapshot"),
    saveDraft: (input) => call("save_draft", { input }),
    importMarkdown: () => call("import_markdown"),
    archiveDraft: (id, archived) => call("archive_draft", { id, archived }),
    revisions: (id) => call("revisions", { id }),
    restoreRevision: (id, revision, expectedRevision) =>
      call("restore_revision", { id, revision, expectedRevision }),
    recordPublication: (draftId, revision, url) =>
      call("record_publication", { draftId, revision, url }),
    saveReading: (input) => call("save_reading", { input }),
    deleteReading: (id) => call("delete_reading", { id }),
    readingToDraft: (id) => call("reading_to_draft", { id }),
    copyText: (text) => call("copy_text", { text }),
    exportDraft: (id) => call("export_draft", { id }),
    openExternal: (url) => call("open_external", { url }),
    backup: () => call("backup"),
    restoreBackup: () => call("restore_backup"),
    info: () => call("info"),
    onBeforeClose(handler) {
      closeHandlers.add(handler);
      return () => {
        closeHandlers.delete(handler);
      };
    },
    onCloseCancelled(handler) {
      cancelHandlers.add(handler);
      return () => {
        cancelHandlers.delete(handler);
      };
    },
    async finishClose(attempt) {
      // Native file dialogs may still own an import/restore when the window receives Quit.
      while (pending.size) await Promise.allSettled([...pending]);
      await call("finish_close", { attempt });
    },
  };
}
