import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Draft, Snapshot } from "../shared/contracts";
import { api, errorMessage } from "./api";
import { DraftEditor } from "./DraftEditor";
import { DraftsView } from "./DraftsView";
import { PublishDialog } from "./PublishDialog";
import { FeedbackView } from "./FeedbackView";
import { SettingsView } from "./SettingsView";
import { ReadingView } from "./ReadingView";
import { Sidebar, type View } from "./Sidebar";

const empty: Snapshot = { drafts: [], publications: [], readings: [] };
const noPendingEdits = async () => {};

export function App() {
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
  const [busy, setBusy] = useState(false);
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
      setView(next);
    });
  };
  const chooseDraft = async (draft: Draft) => {
    await refresh();
    resetEditor();
    setView("drafts");
    setShowArchived(draft.archived);
    setQuery("");
    setSelected(draft.id);
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
    if (selected === draft.id) return;
    void action(async () => {
      resetEditor();
      setSelected(draft.id);
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

  return (
    <div className="app-shell" inert={closing}>
      <Sidebar
        view={view}
        draftCount={data.drafts.filter((draft) => !draft.archived).length}
        disabled={busy || loading || !!loadError}
        onChange={changeView}
      />
      <main className="workspace" aria-busy={loading || busy} inert={busy}>
        <div className="window-dragbar" data-tauri-drag-region />
        {loading ? (
          <div className="empty-state">
            <p>正在打开你的工作台…</p>
          </div>
        ) : loadError ? (
          <div className="empty-state" role="alert">
            <h2>暂时无法读取资料</h2>
            <p>{loadError}</p>
            <button className="button" onClick={() => void load()}>
              重试
            </button>
          </div>
        ) : view === "drafts" ? (
          <DraftsView
            drafts={data.drafts}
            active={active}
            query={query}
            showArchived={showArchived}
            busy={busy}
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
              />
            )}
          </DraftsView>
        ) : view === "feedback" ? (
          <FeedbackView publications={data.publications} notify={notify} />
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
            onRestored={async () => {
              resetEditor();
              setSelected(null);
              await refresh();
            }}
            notify={notify}
          />
        )}
      </main>
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button
            className="icon-button"
            aria-label="关闭提示"
            onClick={() => setNotice("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {publishing && (
        <PublishDialog
          draft={publishing}
          onClose={() => setPublishing(null)}
          onRecorded={refresh}
          notify={notify}
        />
      )}
    </div>
  );
}
