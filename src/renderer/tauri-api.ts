import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { UpdateProgress, WorkbenchAPI } from "../shared/contracts";

const pending = new Set<Promise<unknown>>();

async function call<T>(
  command: string,
  args?: Record<string, unknown>,
  waitForClose = true,
): Promise<T> {
  const operation = invoke<T>(command, args);
  if (waitForClose) pending.add(operation);
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
  const updateHandlers = new Set<(progress: UpdateProgress) => void>();
  const stopUpdate = await listen<UpdateProgress | string>(
    "workbench:update-progress",
    (event) => {
      const payload = event.payload;
      const progress: UpdateProgress =
        typeof payload === "string" ? { stage: "unknown", message: payload } : payload;
      for (const handler of updateHandlers) handler(progress);
    },
  );
  window.addEventListener("unload", stopUpdate, { once: true });
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
    checkUpdate: () => call("check_update", undefined, false),
    async installUpdate(version) {
      while (pending.size) await Promise.allSettled([...pending]);
      return call("install_update", { version });
    },
    openUpdateBackups: () => call("open_update_backups"),
    onUpdateProgress(handler) {
      updateHandlers.add(handler);
      return () => {
        updateHandlers.delete(handler);
      };
    },
    prepareImages: (id, revision) => call("prepare_images", { id, revision }),
    openPreparedImages: (draftId) => call("open_prepared_images", { draftId }, false),
    workflow: () => call("workflow"),
    savePreparation: (input) => call("save_preparation", { input }),
    clearPreparation: (draftId, platform) => call("clear_preparation", { draftId, platform }),
    updatePublication: (id, url) => call("update_publication", { id, url }),
    removePublication: (id) => call("remove_publication", { id }),
    saveFeedback: (input) => call("save_feedback", { input }),
    deleteFeedback: (id) => call("delete_feedback", { id }),
    composeNotes: (ids) => call("compose_notes", { ids }),
    exportCurrent: (input) => call("export_current", { input }),
    opmlPreview: () => call("opml_preview"),
    exportOpml: () => call("export_opml"),
    createBackup: () => call("create_backup"),
    lastBackup: () => call("last_backup", undefined, false),
    revealBackup: () => call("reveal_backup", undefined, false),
    inspectBackup: () => call("inspect_backup"),
    cancelRestore: () => call("cancel_restore", undefined, false),
    restoreInspected: (token) => call("restore_inspected", { token }),
    xSaveClientId: (clientId) => call("x_save_client_id", { clientId }, false),
    xMetrics: (publicationId) => call("x_metrics", { publicationId }, false),
    xAccount: () => call("x_account", undefined, false),
    xConnect: (clientId) => call("x_connect", { clientId }, false),
    xCancel: () => call("x_cancel", undefined, false),
    xDisconnect: () => call("x_disconnect"),
    xPublish: (input) => call("x_publish", { input }),
    insertImage: () => call("insert_image"),
    remoteImagePreview: (url) => call("remote_image_preview", { url }, false),
    assetData: (name) => call("asset_data", { name }, false),
    library: () => call("library"),
    // Network refreshes write only after fetching and use an epoch guard; they must not delay closing local editors.
    addFeed: (url) => call("add_feed", { url }, false),
    refreshFeed: (id) => call("refresh_feed", { id }, false),
    unsubscribe: (id) => call("unsubscribe", { id }),
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
