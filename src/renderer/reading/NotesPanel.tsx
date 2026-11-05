import { useEffect, useRef } from "react";
import { Check, FilePlus2, Link2, LoaderCircle, RefreshCw, TriangleAlert, X } from "lucide-react";
import type { Reading } from "../../shared/contracts";
import { sourceName } from "./sourceName";
import type { ReadingSaveState } from "./useReadingEditor";

interface Props {
  record: Reading;
  source: string;
  busy: boolean;
  saveState: ReadingSaveState;
  saveError: string;
  focusToken: number;
  edit: (next: Reading) => void;
  flush: () => Promise<void>;
  convert: () => Promise<void>;
  close: () => void;
}

const labels: Record<ReadingSaveState, string> = {
  saved: "已保存到本机",
  pending: "等待保存…",
  saving: "正在保存…",
  error: "保存失败",
};

export function NotesPanel({
  record,
  source,
  busy,
  saveState,
  saveError,
  focusToken,
  edit,
  flush,
  convert,
  close,
}: Props) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusToken) textarea.current?.focus();
  }, [focusToken]);
  return (
    <aside className="notes-panel" id="reading-notes" aria-labelledby="notes-heading">
      <div className="notes-head" data-tauri-drag-region>
        <h2 id="notes-heading">
          <label htmlFor="reading-note">我的笔记</label>
        </h2>
        <span
          className={`save-status${saveState === "error" ? " error" : ""}`}
          role="status"
        >
          {saveState === "error" ? (
            <TriangleAlert size={12} aria-hidden="true" />
          ) : saveState === "saving" ? (
            <LoaderCircle size={12} className="spin" aria-hidden="true" />
          ) : (
            <Check size={12} aria-hidden="true" />
          )}
          {labels[saveState]}
        </span>
        <button type="button" className="icon-button" aria-label="收起笔记" title="收起笔记" onClick={close}>
          <X size={16} />
        </button>
      </div>
      <div className="notes-body">
        <textarea
          ref={textarea}
          id="reading-note"
          className="input reading-note"
          value={record.note}
          onChange={(event) => edit({ ...record, note: event.target.value })}
          disabled={busy}
          placeholder={"这篇文章让我想到…\n\n有什么可以用在自己的项目里？"}
        />
        <div className="notes-side">
          {saveState === "error" && (
            <div className="notice danger" role="alert">
              <TriangleAlert size={15} aria-hidden="true" />
              <div className="notice-body">
                <p>{saveError} 你输入的内容仍在这里。</p>
                <div className="notice-actions">
                  <button type="button" className="button" onClick={() => void flush().catch(() => {})}>
                    <RefreshCw size={13} aria-hidden="true" />
                    重试保存
                  </button>
                </div>
              </div>
            </div>
          )}
          <p className="note-source">
            <Link2 size={12} aria-hidden="true" />
            <span>
              来源会随笔记一起保留：{record.title || sourceName(record.url)} · {source}
            </span>
          </p>
          <button
            type="button"
            className="button block"
            disabled={!record.note.trim() || busy}
            onClick={() => void convert()}
          >
            <FilePlus2 size={15} aria-hidden="true" />
            用笔记开始写作
          </button>
        </div>
      </div>
    </aside>
  );
}
