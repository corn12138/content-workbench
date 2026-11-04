import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { LayoutContext, useShellLayout } from "./layout";
import type { Draft, Snapshot } from "../shared/contracts";
import { api, errorMessage } from "./api";
import { DraftEditor } from "./DraftEditor";
import { DraftsView } from "./DraftsView";
import { PublishWorkspace } from "./PublishWorkspace";
import { RecordsView } from "./RecordsView";
import { SettingsView } from "./SettingsView";
import { ReadingView } from "./ReadingView";
import { Sidebar, type View } from "./Sidebar";
import { useUpdates } from "./updates/useUpdates";
import { UpdateProgress } from "./updates/UpdateSection";

const empty: Snapshot = { drafts: [], publications: [], readings: [] };
const noPendingEdits = async () => {};

export function App() {
  const updates = useUpdates();
  const [data, setData] = useState<Snapshot>(empty);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [view, setView] = useState<View>("drafts");
  const [selected, setSelected] = useState<string | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [notice, setNotice] = useState("");
  const [publishing, setPublishing] = useState<Draft | null>(null);
  const [publishBusy, setPublishBusy] = useState(false);
  const [listCollapsed, setListCollapsed] = useState(false);
  const [draftPane, setDraftPane] = useState<"list" | "detail">("detail");
  const shell = useRef<HTMLDivElement>(null);
  const publishButton = useRef<HTMLButtonElement>(null);
  const layout = useShellLayout(shell);
  const [busy, setBusy] = useState(false);
  // Set after a restore replaced the data and until the restored data has been read back successfully.
  const [restoredUnread, setRestoredUnread] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeSequence = useRef(0);
  const actionPending = useRef(false);
  const flush = useRef<() => Promise<void>>(noPendingEdits);
  const notify = useCallback((message: string) => setNotice(message), []);
  const registerFlush = useCallback((handler: () => Promise<void>) => {
    flush.current = handler;
  }, []);
  const refreshSequence = useRef(0);
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const next = await api.snapshot();
    // A slower list read cannot replace the newer snapshot loaded after a save or restore.
    if (sequence === refreshSequence.current) setData(next);
  }, []);
  const load = useCallback(async () => {
    setLoadError("");
    setLoading(true);
    try {
      await refresh();
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(
    () =>
      api.onBeforeClose((attempt) => {
        const sequence = ++closeSequence.current;
        setClosing(true);
        void flush
          .current()
          .then(() => api.finishClose(attempt))
          .catch((error) => {
            if (closeSequence.current === sequence) {
              setClosing(false);
              notify("暂未关闭：" + errorMessage(error));
            }
          });
      }),
    [notify],
  );
  useEffect(
    () =>
      api.onCloseCancelled?.(() => {
        closeSequence.current += 1;
        setClosing(false);
      }),
    [],
  );

  const action = async (task: () => Promise<void>) => {
    // Lock immediately; the inert workspace prevents new edits between flushing and changing views.
    if (actionPending.current) return;
    actionPending.current = true;
    setBusy(true);
    try {
      await flush.current();
      await task();
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  };
  const resetEditor = () => {
    // Only clear the old owner's flush after it has saved, before mounting the next editor.
    flush.current = noPendingEdits;
    setEditorKey((value) => value + 1);
  };
  const changeView = (next: View) => {
    if (next === view) return;
    void action(async () => {
      resetEditor();
      setPublishing(null);
      setView(next);
    });
  };
  const closePublishing = () => {
    setPublishing(null);
    // The editor remounts behind the workspace; return focus to the action that opened it.
    requestAnimationFrame(() => publishButton.current?.focus());
  };
  const chooseDraft = async (draft: Draft) => {
    await refresh();
    resetEditor();
    setPublishing(null);
    setView("drafts");
    setShowArchived(draft.archived);
    setQuery("");
    setSelected(draft.id);
    setDraftPane("detail");
  };
  const createDraft = () =>
    void action(async () => {
      await chooseDraft(
        await api.saveDraft({ title: "", body: "", project: "" }),
      );
    });
  const importDraft = () =>
    void action(async () => {
      const result = await api.importMarkdown();
      if (!result) return;
      await chooseDraft(result.draft);
      notify(
        [
          result.duplicate ? "这篇文章已经在这里，已为你打开" : "文章已导入",
          ...result.warnings,
        ].join("。"),
      );
    });
  const selectDraft = (draft: Draft) => {
    if (selected === draft.id) {
      setDraftPane("detail");
      return;
    }
    void action(async () => {
      resetEditor();
      setSelected(draft.id);
      setDraftPane("detail");
    });
  };
  const filterDrafts = (archived: boolean) => {
    if (archived === showArchived) return;
    void action(async () => {
      resetEditor();
      setSelected(null);
      setShowArchived(archived);
    });
  };
  const onSaved = (draft: Draft) =>
    setData((current) => ({
      ...current,
      drafts: current.drafts.map((item) =>
        item.id === draft.id ? draft : item,
      ),
    }));
  const archiveDraft = (id: string) =>
    action(async () => {
      await api.archiveDraft(id, true);
      resetEditor();
      setSelected(null);
      await refresh();
      notify("已归档，可从“已归档”找回");
    });
  const active = data.drafts.find((item) => item.id === selected);

  const compact = layout === "compact";
  const unread = data.readings.filter((item) => !item.read).length;

  return (
    <LayoutContext.Provider value={layout}>
      <div className="app-shell" ref={shell} data-layout={layout} inert={closing}>
        <Sidebar
          view={view}
          draftCount={data.drafts.filter((draft) => !draft.archived).length}
          unreadCount={unread}
          disabled={busy || publishBusy || loading || !!loadError}
          onChange={changeView}
        />
        <main className="workspace" aria-busy={loading || busy} inert={busy}>
          {updates.available && view !== "settings" && (
            <div className="update-banner" role="status">
              新版本 {updates.available.version} 已就绪
              <button
                type="button"
                className="button quiet small"
                disabled={publishBusy}
                onClick={() => changeView("settings")}
              >
                查看更新
              </button>
            </div>
          )}
          {loading ? (
            <div className="empty-state">
              <p>正在打开你的工作台…</p>
            </div>
          ) : loadError ? (
            <div className="empty-state" role="alert">
              <h2>暂时无法读取资料</h2>
              <p>{loadError}</p>
              <button type="button" className="button" onClick={() => void load()}>
                重试
              </button>
            </div>
          ) : restoredUnread && view !== "settings" ? (
            <div className="empty-state" role="alert">
              <h2>资料已恢复，列表暂未刷新</h2>
              <p>恢复已经完成。为避免在旧列表上继续编辑，请先重新读取资料。</p>
              <div className="actions">
                <button
                  type="button"
                  className="button primary"
                  onClick={() =>
                    void refresh().then(
                      () => setRestoredUnread(false),
                      (error) => notify(errorMessage(error)),
                    )
                  }
                >
                  重新读取资料
                </button>
              </div>
            </div>
          ) : view === "drafts" && publishing ? (
            <PublishWorkspace
              draft={publishing}
              onClose={closePublishing}
              onRecorded={refresh}
              onBusy={setPublishBusy}
              onViewRecords={() => changeView("feedback")}
              onPrepared={(draft) => {
                onSaved(draft);
                resetEditor();
              }}
              notify={notify}
            />
          ) : view === "drafts" ? (
            <DraftsView
              drafts={data.drafts}
              publications={data.publications}
              active={active}
              query={query}
              showArchived={showArchived}
              busy={busy}
              listHidden={compact ? draftPane === "detail" && !!active : listCollapsed}
              detailHidden={compact && (draftPane === "list" || !active)}
              onQuery={setQuery}
              onFilter={filterDrafts}
              onSelect={selectDraft}
              onCreate={createDraft}
              onImport={importDraft}
              onUnarchive={(draft) =>
                void action(async () => {
                  await api.archiveDraft(draft.id, false);
                  await chooseDraft({ ...draft, archived: false });
                })
              }
            >
              {active && !active.archived && (
                <DraftEditor
                  key={active.id + ":" + editorKey}
                  draft={active}
                  onSaved={onSaved}
                  onPublish={setPublishing}
                  registerFlush={registerFlush}
                  notify={notify}
                  onRestored={(draft) => {
                    onSaved(draft);
                    resetEditor();
                  }}
                  onArchive={archiveDraft}
                  compact={compact}
                  listCollapsed={listCollapsed}
                  onToggleList={() => setListCollapsed((value) => !value)}
                  onBack={() => setDraftPane("list")}
                  publishButton={publishButton}
                />
              )}
            </DraftsView>
          ) : view === "feedback" ? (
            <RecordsView
              publications={data.publications}
              notify={notify}
              onDrafts={() => changeView("drafts")}
            />
          ) : view === "reading" ? (
            <ReadingView
              items={data.readings}
              onRefresh={refresh}
              onDraft={chooseDraft}
              notify={notify}
              registerFlush={registerFlush}
            />
          ) : (
            <SettingsView
              updates={updates}
              installUpdate={() => void action(updates.install)}
              onRestored={async () => {
                resetEditor();
                setSelected(null);
                setPublishing(null);
                setRestoredUnread(true);
                await refresh();
                setRestoredUnread(false);
              }}
              notify={notify}
            />
          )}
        </main>
        <UpdateProgress updates={updates} />
        {notice && (
          <div className="toast" role="status">
            <span>{notice}</span>
            <button
              type="button"
              className="icon-button"
              aria-label="关闭提示"
              onClick={() => setNotice("")}
            >
              <X size={15} />
            </button>
          </div>
        )}
      </div>
    </LayoutContext.Provider>
  );
}
