import { useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { BookOpen, ChevronDown, Link2, Plus, Rss } from "lucide-react";
import type { Draft, Reading, Library } from "../shared/contracts";
import { api } from "./api";
import { useLayout } from "./layout";
import { ReadingAddForm } from "./reading/ReadingAddForm";
import { ReaderPane } from "./reading/ReaderPane";
import { NotesPanel } from "./reading/NotesPanel";
import { ReadingList, type ReadingFilter } from "./reading/ReadingList";
import { useReadingEditor } from "./reading/useReadingEditor";
import { orderReadings } from "./reading/orderReadings";
import { filterReadings, readingIndex } from "./reading/filterReadings";
import { FeedPanel } from "./reading/FeedPanel";
import { sourceName } from "./reading/sourceName";
import "./reading.css";

interface ReadingViewProps {
  items: Reading[];
  onRefresh: () => Promise<void>;
  onDraft: (draft: Draft) => Promise<void>;
  notify: (message: string) => void;
  registerFlush: (flush: () => Promise<void>) => void;
}

type Adding = "feed" | "link" | null;

export function ReadingView(props: ReadingViewProps) {
  const layout = useLayout();
  const [library, setLibrary] = useState<Library>({ feeds: [], items: [] });
  const previewIndex = useMemo(() => readingIndex(library.items), [library.items]);
  const [libraryLoaded, setLibraryLoaded] = useState(!api.library);
  const readings = useMemo(
    () => orderReadings(props.items, library.items),
    [props.items, library.items],
  );
  const editor = useReadingEditor({
    ...props,
    items: libraryLoaded ? readings : [],
  });
  const [filter, setFilter] = useState<ReadingFilter>("all");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const deferredQuery = useDeferredValue(query);
  const visible = useMemo(
    () => filterReadings(readings, library, filter, source, deferredQuery),
    [readings, library, filter, source, deferredQuery],
  );
  const [adding, setAdding] = useState<Adding>(null);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  // Notes default open where there is room beside the article; elsewhere they open on demand.
  const [notesOpen, setNotesOpen] = useState(layout === "wide");
  const [pane, setPane] = useState<"list" | "detail">(layout === "compact" ? "list" : "detail");
  const [noteFocus, setNoteFocus] = useState(0);
  const addMenu = useRef<HTMLDetailsElement>(null);

  // A failed save is surfaced where the retry lives, even if the panel was collapsed.
  useEffect(() => {
    if (editor.saveState === "error") setNotesOpen(true);
  }, [editor.saveState]);

  const compact = layout === "compact";
  const record = editor.record;
  const feedItem = record ? previewIndex.get(record.id) : undefined;
  const feedTitle = feedItem
    ? library.feeds.find((feed) => feed.id === feedItem.feedId)?.title
    : undefined;
  const showList = compact ? pane === "list" || !record : !(layout === "standard" && notesOpen && record);
  const showReader = !!record && (compact ? pane === "detail" : true);

  const select = async (next: Reading) => {
    if (busy) return;
    if (editor.record?.id === next.id) {
      setPane("detail");
      return;
    }
    setBusy(true);
    try {
      await editor.flush();
      editor.selectSaved(next);
      setPane("detail");
    } catch {
      props.notify("笔记还没有保存，已留在当前文章。请在笔记栏重试保存后再切换。");
    } finally {
      setBusy(false);
    }
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFormError("");
    try {
      await editor.flush();
      const parsed = new URL(url.trim());
      if (!["https:", "http:"].includes(parsed.protocol))
        throw new Error("请填写以 https:// 或 http:// 开头的文章链接。");
      const existing = props.items.find((item) => item.url === parsed.href);
      const saved =
        existing ??
        (await api.saveReading({
          url: parsed.href,
          title: title.trim(),
          note: "",
          read: false,
        }));
      await props.onRefresh();
      editor.selectSaved(saved);
      setFilter("all");
      setAdding(null);
      setPane("detail");
      setUrl("");
      setTitle("");
      props.notify(existing ? "这个链接已收藏，已为你打开。" : "已加入阅读。");
    } catch (error) {
      setFormError(
        error instanceof TypeError
          ? "请填写完整的文章链接。"
          : error instanceof Error
            ? error.message
            : "链接未能保存，请重试。",
      );
    } finally {
      setBusy(false);
    }
  };

  const convert = async () => {
    if (!editor.record || busy) return;
    setBusy(true);
    let created = false;
    try {
      await editor.flush();
      const draft = await api.readingToDraft(editor.record.id);
      created = true;
      await props.onDraft(draft);
    } catch (error) {
      props.notify(
        created
          ? "稿件已创建，可在“稿件”中查看。"
          : error instanceof Error
            ? error.message
            : "暂时无法创建稿件。",
      );
    } finally {
      setBusy(false);
    }
  };

  const openNotes = () => {
    setNotesOpen(true);
    setNoteFocus((value) => value + 1);
  };
  const startAdding = (mode: Adding) => {
    if (addMenu.current) addMenu.current.open = false;
    setAdding(mode);
    setFormError("");
    setPane("list");
    if (layout === "standard") setNotesOpen(false);
  };
  const unread = props.items.filter((item) => !item.read).length;
  const noteLabel = notesOpen
    ? "收起笔记"
    : editor.saveState === "error"
      ? "笔记 · 未保存"
      : record?.note.trim()
        ? "笔记 · 已写"
        : "笔记";

  const header = (
    <div className="pane-header" data-tauri-drag-region>
      <h1>阅读</h1>
      <details className="more-menu" ref={addMenu}>
        <summary className="button small" aria-label="添加阅读来源">
          <Plus size={14} aria-hidden="true" />
          添加
          <ChevronDown size={13} aria-hidden="true" />
        </summary>
        <div className="menu-items" role="menu">
          {api.library && (
            <button type="button" role="menuitem" onClick={() => startAdding("feed")}>
              <Rss size={15} aria-hidden="true" />
              添加订阅
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => startAdding("link")}>
            <Link2 size={15} aria-hidden="true" />
            添加文章链接
          </button>
        </div>
      </details>
    </div>
  );

  const tools = (
    <>
      {api.library && (
        <FeedPanel
          library={library}
          onLibrary={(next) => {
            setLibrary(next);
            setLibraryLoaded(true);
          }}
          onRefresh={props.onRefresh}
          adding={adding === "feed"}
          setAdding={(value) => setAdding(value ? "feed" : null)}
        />
      )}
      {adding === "link" && (
        <ReadingAddForm
          url={url}
          title={title}
          busy={busy}
          error={formError}
          setUrl={setUrl}
          setTitle={setTitle}
          add={add}
          cancel={() => setAdding(null)}
        />
      )}
    </>
  );

  return (
    <section
      className="reading-workspace panes"
      aria-label="阅读与笔记"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        if (adding && !busy) setAdding(null);
        else if (compact && notesOpen) setNotesOpen(false);
      }}
    >
      {/* Kept mounted while hidden so feed refreshes, search text and filters survive layout changes. */}
      <section className="list-pane reading-list" aria-label="文章列表与筛选" hidden={!showList}>
        <ReadingList
          visible={visible}
          total={readings.length}
          library={library}
          selectedId={record?.id}
          filter={filter}
          setFilter={setFilter}
          query={query}
          setQuery={setQuery}
          source={source}
          setSource={setSource}
          unread={unread}
          select={select}
          busy={busy}
          header={header}
          tools={tools}
        />
      </section>
      {showReader && record ? (
        <ReaderPane
          record={record}
          feedItem={feedItem}
          feedTitle={feedTitle}
          busy={busy}
          notesOpen={notesOpen}
          noteLabel={noteLabel}
          showBack={compact}
          showListButton={layout === "standard" && notesOpen}
          onBack={() => setPane("list")}
          onShowList={() => setNotesOpen(false)}
          toggleNotes={() => (notesOpen ? setNotesOpen(false) : openNotes())}
          toggleRead={() => {
            editor.edit({ ...record, read: !record.read });
            void editor.flush().catch(() => {});
          }}
          notify={props.notify}
        />
      ) : (
        !compact && (
          <div className="detail-pane empty-state reading-empty">
            <span className="empty-symbol">
              <BookOpen size={26} strokeWidth={1.5} aria-hidden="true" />
            </span>
            <h2>{readings.length ? "选择一篇文章开始阅读" : "订阅值得读的来源"}</h2>
            <p>
              {readings.length
                ? "从左侧打开文章，在旁边记下想法。"
                : "添加 RSS / Atom 订阅或单篇文章链接。读完把想法记在旁边，下次写作就有了起点。"}
            </p>
            {!readings.length && (
              <div className="actions">
                {api.library && (
                  <button type="button" className="button primary" onClick={() => startAdding("feed")}>
                    <Rss size={15} aria-hidden="true" />
                    添加订阅
                  </button>
                )}
                <button type="button" className="button" onClick={() => startAdding("link")}>
                  <Link2 size={15} aria-hidden="true" />
                  添加文章链接
                </button>
              </div>
            )}
            <span className="fine">
              {api.library
                ? "订阅只在你添加或点击“更新订阅”时联网，关闭应用后不会继续更新。"
                : "资料和笔记保存在你的电脑上。"}
            </span>
          </div>
        )
      )}
      {record && notesOpen && (compact ? pane === "detail" : true) && (
        <NotesPanel
          record={record}
          source={feedTitle || sourceName(record.url)}
          busy={busy}
          saveState={editor.saveState}
          saveError={editor.saveError}
          focusToken={noteFocus}
          edit={editor.edit}
          flush={editor.flush}
          convert={convert}
          close={() => setNotesOpen(false)}
        />
      )}
    </section>
  );
}
