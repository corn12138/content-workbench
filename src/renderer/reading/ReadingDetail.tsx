import { ArrowUpRight, Check, FilePlus2, RefreshCw } from "lucide-react";
import type { Reading } from "../../shared/contracts";
import { api } from "../api";
import { sourceName } from "./sourceName";
import type { ReadingSaveState } from "./useReadingEditor";

interface ReadingDetailProps {
  record: Reading;
  busy: boolean;
  saveState: ReadingSaveState;
  saveError: string;
  edit: (next: Reading) => void;
  flush: () => Promise<void>;
  convert: () => Promise<void>;
  notify: (message: string) => void;
}

export function ReadingDetail({
  record,
  busy,
  saveState,
  saveError,
  edit,
  flush,
  convert,
  notify,
}: ReadingDetailProps) {
  const saveLabel = {
    saved: "已保存到本机",
    pending: "等待保存…",
    saving: "正在保存…",
    error: "保存失败",
  }[saveState];

  const openOriginal = () => {
    void api.openExternal(record.url).catch((error) => {
      notify(error instanceof Error ? error.message : "无法打开链接。");
    });
  };

  const toggleRead = () => {
    edit({ ...record, read: !record.read });
    void flush().catch(() => {});
  };

  return (
    <article className="detail-pane reading-detail">
      <div className="reading-source">
        <span className="eyebrow">{sourceName(record.url)}</span>
        <h2>{record.title || sourceName(record.url)}</h2>
        <p className="muted reading-url">{record.url}</p>
        <div className="reading-source-actions">
          <button className="button" onClick={openOriginal}>
            打开原文
            <ArrowUpRight size={15} />
          </button>
          <button className="button quiet" disabled={busy} onClick={toggleRead}>
            {record.read ? (
              <>
                <Check size={15} />
                已读 · 标为未读
              </>
            ) : (
              "标为已读"
            )}
          </button>
        </div>
      </div>
      <div className="reading-note-heading">
        <label htmlFor="reading-note">我的笔记</label>
        <span
          className={`reading-save-state ${saveState === "error" ? "reading-error" : "muted"}`}
          role="status"
        >
          {saveLabel}
        </span>
      </div>
      <textarea
        id="reading-note"
        className="input reading-note"
        value={record.note}
        onChange={(event) => edit({ ...record, note: event.target.value })}
        disabled={busy}
        placeholder={"这篇文章让我想到…\n\n有什么可以用在自己的项目里？"}
      />
      {saveState === "error" && (
        <div className="reading-save-error" role="alert">
          <p>{saveError} 你输入的内容仍在这里。</p>
          <button
            className="button"
            onClick={() => void flush().catch(() => {})}
          >
            <RefreshCw size={14} />
            重试保存
          </button>
        </div>
      )}
      <div className="reading-note-footer">
        <span className="muted">来源会随笔记一起保留。</span>
        <button
          className="button quiet"
          disabled={!record.note.trim() || busy}
          onClick={() => void convert()}
        >
          <FilePlus2 size={16} />
          用笔记开始写作
        </button>
      </div>
    </article>
  );
}
