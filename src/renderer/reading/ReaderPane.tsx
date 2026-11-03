import { useEffect, useRef } from "react";
import {
  ArrowUpRight,
  ChevronLeft,
  Info,
  NotebookPen,
  PanelLeftOpen,
  Rss,
  TriangleAlert,
} from "lucide-react";
import type { FeedItem, Reading } from "../../shared/contracts";
import { api, errorMessage } from "../api";
import { Markdown } from "../Markdown";
import { contentState } from "./contentKind";
import { sourceName } from "./sourceName";

interface Props {
  record: Reading;
  feedItem?: FeedItem;
  feedTitle?: string;
  busy: boolean;
  notesOpen: boolean;
  noteLabel: string;
  showBack: boolean;
  showListButton: boolean;
  onBack: () => void;
  onShowList: () => void;
  toggleNotes: () => void;
  toggleRead: () => void;
  notify: (message: string) => void;
}

const dateFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

export function ReaderPane({
  record,
  feedItem,
  feedTitle,
  busy,
  notesOpen,
  noteLabel,
  showBack,
  showListButton,
  onBack,
  onShowList,
  toggleNotes,
  toggleRead,
  notify,
}: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const state = contentState(feedItem);
  const source = feedTitle || sourceName(record.url);
  const published = feedItem?.publishedAt ? Date.parse(feedItem.publishedAt) : NaN;
  const text = feedItem?.content?.value || feedItem?.summary || "";

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [record.id]);

  const openOriginal = () => {
    void api.openExternal(record.url).catch((error) => {
      notify(errorMessage(error) || "无法打开链接。");
    });
  };

  return (
    <article className="detail-pane reader" aria-label="文章阅读">
      <div className="pane-header reader-bar" data-tauri-drag-region>
        {showBack && (
          <button type="button" className="button quiet small" onClick={onBack}>
            <ChevronLeft size={15} aria-hidden="true" />
            文章
          </button>
        )}
        {showListButton && (
          <button type="button" className="button quiet small" onClick={onShowList}>
            <PanelLeftOpen size={15} aria-hidden="true" />
            文章列表
          </button>
        )}
        <span className="reader-source">
          <Rss size={13} aria-hidden="true" />
          {source}
        </span>
        <button type="button" className="button quiet small" disabled={busy} onClick={toggleRead}>
          {record.read ? "标为未读" : "标为已读"}
        </button>
        <button type="button" className="button small" onClick={openOriginal}>
          <ArrowUpRight size={14} aria-hidden="true" />
          打开原文
        </button>
        <button
          type="button"
          className={`button small${notesOpen ? " on" : ""}`}
          aria-pressed={notesOpen}
          aria-controls="reading-notes"
          onClick={toggleNotes}
        >
          <NotebookPen size={14} aria-hidden="true" />
          {noteLabel}
        </button>
      </div>
      {/* One scroll container for the whole article; wide code and tables scroll inside their own regions. */}
      <div className="reader-scroll" ref={scroller} tabIndex={0} aria-label="正文">
        <div className="reader-column">
          <h1 className="reader-title">{record.title || sourceName(record.url)}</h1>
          <p className="reader-meta">
            <span>{source}</span>
            {Number.isFinite(published) && <span>{dateFormat.format(published)}</span>}
            <span className={record.read ? "" : "reader-unread"}>
              {record.read ? "已读" : "未读"}
            </span>
          </p>
          <div className={`content-kind${state.warning ? " warning" : ""}`} role="note">
            {state.warning ? (
              <TriangleAlert size={15} aria-hidden="true" />
            ) : (
              <Info size={15} aria-hidden="true" />
            )}
            <p>
              <strong>{state.label}</strong> · {state.description}
            </p>
          </div>
          {state.kind === "link" || state.kind === "empty" ? (
            <div className="reader-original">
              <p className="reader-url">{record.url}</p>
              <button type="button" className="button primary" onClick={openOriginal}>
                <ArrowUpRight size={15} aria-hidden="true" />
                在浏览器中打开原文
              </button>
            </div>
          ) : feedItem?.content?.format === "html" ? (
            <div className="reader-content">
              <Markdown text={feedItem.content.value} html baseURL={feedItem.url} />
            </div>
          ) : (
            <div className="reader-content reader-plain">{text}</div>
          )}
          {state.truncated && (
            <div className="notice warning reader-truncated">
              <TriangleAlert size={16} aria-hidden="true" />
              <div className="notice-body">
                <p>以上是工作台保留的前段内容，后续部分请在原文中阅读。</p>
                <div className="notice-actions">
                  <button type="button" className="button" onClick={openOriginal}>
                    继续阅读原文
                  </button>
                </div>
              </div>
            </div>
          )}
          <div className="reader-end">
            {!record.note.trim() && !notesOpen && (
              <button type="button" className="button small" onClick={toggleNotes}>
                <NotebookPen size={14} aria-hidden="true" />
                写一条笔记
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
