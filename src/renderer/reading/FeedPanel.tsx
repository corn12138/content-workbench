import { useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronDown, Download, Plus, RefreshCw, TriangleAlert, Upload, X } from "lucide-react";
import type { Feed, Library, OpmlEntry } from "../../shared/contracts";
import { opmlCounts, opmlLabel } from "./opml";
import { api, errorMessage } from "../api";

interface Props {
  library: Library;
  onLibrary: (library: Library) => void;
  onRefresh: () => Promise<void>;
  adding: boolean;
  setAdding: (adding: boolean) => void;
  importing: boolean;
  setImporting: (importing: boolean) => void;
}

interface FailedFeed {
  id: string;
  title: string;
  error: string;
}
interface FailedImport {
  url: string;
  title: string;
  error: string;
}

const timeFormat = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function FeedPanel({ library, onLibrary, onRefresh, adding, setAdding, importing, setImporting }: Props) {
  const feeds = library.feeds.filter((feed) => feed.enabled);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [addError, setAddError] = useState("");
  const [failed, setFailed] = useState<FailedFeed[]>([]);
  const [preview, setPreview] = useState<{ filename: string; entries: OpmlEntry[] } | null>(null);
  const [importFailed, setImportFailed] = useState<FailedImport[]>([]);
  const active = useRef(false);
  const locked = useRef(false);
  const generation = useRef(0);
  const handlers = useRef({ onLibrary, onRefresh });
  handlers.current = { onLibrary, onRefresh };

  useEffect(() => {
    active.current = true;
    let cancelled = false;
    const started = generation.current;
    void Promise.all([api.library!(), handlers.current.onRefresh()]).then(
      ([next]) => {
        if (!cancelled && generation.current === started)
          handlers.current.onLibrary(next);
      },
      (error) => {
        if (!cancelled) {
          handlers.current.onLibrary({ feeds: [], items: [] });
          setMessage(errorMessage(error));
        }
      },
    );
    return () => {
      active.current = false;
      cancelled = true;
    };
  }, []);

  const run = async (task: () => Promise<string>, onError?: (message: string) => void) => {
    if (locked.current) return;
    locked.current = true;
    generation.current += 1;
    setBusy(true);
    setMessage("");
    try {
      const result = await task();
      if (!active.current) return;
      const next = await api.library!();
      if (!active.current) return;
      handlers.current.onLibrary(next);
      await handlers.current.onRefresh();
      if (active.current) setMessage(result);
    } catch (error) {
      if (active.current) (onError ?? setMessage)(errorMessage(error));
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  };

  const add = (event: FormEvent) => {
    event.preventDefault();
    setAddError("");
    void run(async () => {
      await api.addFeed!(url.trim());
      if (active.current) {
        setUrl("");
        setAdding(false);
      }
      return "已添加订阅，文章已放入阅读列表。";
    }, setAddError);
  };

  const refresh = (targets: Feed[]) =>
    void run(async () => {
      const queue = [...targets];
      const failures: FailedFeed[] = [];
      // A small worker pool keeps many sources from opening connections at once.
      await Promise.all(
        Array.from({ length: Math.min(3, queue.length) }, async () => {
          while (active.current) {
            const feed = queue.shift();
            if (!feed) return;
            try {
              const result = await api.refreshFeed!(feed.id);
              if (result.error)
                failures.push({ id: feed.id, title: feed.title, error: result.error });
            } catch (error) {
              failures.push({ id: feed.id, title: feed.title, error: errorMessage(error) });
            }
          }
        }),
      );
      if (active.current) setFailed(failures);
      if (!failures.length)
        return targets.length < feeds.length
          ? "这些订阅已更新。"
          : "订阅已更新，重复文章不会再次添加。";
      return "";
    });

  // Choosing the file and checking it happen before anything is added; the user confirms the list.
  useEffect(() => {
    if (!importing || !api.opmlPreview) return;
    setImporting(false);
    void run(async () => {
      const value = await api.opmlPreview!();
      if (!value) return "已取消，没有导入订阅。";
      if (active.current) {
        setPreview(value);
        setImportFailed([]);
      }
      return "";
    });
  }, [importing]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Adds subscriptions with at most three requests at a time; each failure is reported per source. */
  const addAll = (targets: { url: string; title: string }[]) =>
    void run(async () => {
      const queue = [...targets];
      const failures: FailedImport[] = [];
      let added = 0;
      await Promise.all(
        Array.from({ length: Math.min(3, queue.length) }, async () => {
          while (active.current) {
            const target = queue.shift();
            if (!target) return;
            try {
              await api.addFeed!(target.url);
              added++;
            } catch (error) {
              failures.push({ ...target, error: errorMessage(error) });
            }
          }
        }),
      );
      if (active.current) {
        setPreview(null);
        setImportFailed(failures);
      }
      return failures.length
        ? `已添加 ${added} 个订阅，${failures.length} 个未能添加。已有文章和笔记不受影响。`
        : `已添加 ${added} 个订阅，文章已放入阅读列表。`;
    });

  const exportList = () =>
    void run(async () => {
      const result = await api.exportOpml!();
      return result ? `已导出 ${result.count} 个订阅到 ${result.filename}。` : "已取消导出。";
    });

  const counts = preview ? opmlCounts(preview.entries) : null;

  const lastChecked = feeds
    .map((feed) => (feed.checkedAt ? Date.parse(feed.checkedAt) : NaN))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];

  return (
    <div className="feed-panel">
      {adding && (
        <form className="inline-panel" onSubmit={add}>
          <label className="field-label" htmlFor="feed-url">
            订阅地址（RSS 或 Atom）
          </label>
          <input
            id="feed-url"
            className="input"
            type="url"
            required
            autoFocus
            disabled={busy}
            value={url}
            aria-invalid={!!addError}
            aria-describedby={addError ? "feed-url-error" : undefined}
            onChange={(e) => {
              setUrl(e.target.value);
              setAddError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape" && !busy) {
                e.stopPropagation();
                setAdding(false);
              }
            }}
            placeholder="https://example.com/feed.xml"
          />
          {addError && (
            <p className="field-error" id="feed-url-error" role="alert">
              {addError}
            </p>
          )}
          <div className="inline-actions">
            <button className="button primary small" disabled={busy} aria-busy={busy}>
              <Plus size={14} aria-hidden="true" />
              {busy ? "读取中…" : "添加订阅"}
            </button>
            <button
              type="button"
              className="button quiet small"
              disabled={busy}
              onClick={() => setAdding(false)}
            >
              取消
            </button>
          </div>
        </form>
      )}
      {preview && counts && (
        <div className="inline-panel opml-preview" role="region" aria-label="导入订阅列表">
          <strong>导入 {preview.filename}</strong>
          <p className="field-help">
            共 {preview.entries.length} 个来源：可添加 {counts.addable} 个
            {counts.duplicate ? `，重复 ${counts.duplicate} 个` : ""}
            {counts.skipped ? `，无法添加 ${counts.skipped} 个` : ""}。确认后才会联网读取。
          </p>
          <ul className="opml-entries">
            {preview.entries.map((entry, index) => (
              <li key={`${entry.url}-${index}`}>
                <span title={entry.url}>{entry.title || entry.url}</span>
                <span data-status={entry.status}>{opmlLabel(entry)}</span>
              </li>
            ))}
          </ul>
          <div className="inline-actions">
            <button
              type="button"
              className="button primary small"
              disabled={busy || !counts.addable}
              onClick={() =>
                addAll(preview.entries.filter((e) => e.status === "new" || e.status === "resubscribe"))
              }
            >
              {busy ? "添加中…" : `添加 ${counts.addable} 个订阅`}
            </button>
            <button type="button" className="button quiet small" disabled={busy} onClick={() => setPreview(null)}>
              取消
            </button>
          </div>
        </div>
      )}
      {importFailed.length > 0 && (
        <div className="notice warning" role="status">
          <TriangleAlert size={16} aria-hidden="true" />
          <div className="notice-body">
            <span className="notice-title">{importFailed.length} 个订阅未能添加</span>
            {importFailed.map((item) => (
              <p key={item.url}>
                {item.title || item.url}：{item.error}
              </p>
            ))}
            <div className="notice-actions">
              <button type="button" className="button" disabled={busy} onClick={() => addAll(importFailed)}>
                {importFailed.length === 1 ? "重试这个订阅" : `重试这 ${importFailed.length} 个`}
              </button>
              <button type="button" className="button quiet" onClick={() => setImportFailed([])}>
                知道了
              </button>
            </div>
          </div>
        </div>
      )}
      {feeds.length > 0 && (
        <div className="feed-toolbar">
          <button
            type="button"
            className="button small"
            onClick={() => refresh(feeds)}
            disabled={busy}
            aria-busy={busy}
          >
            <RefreshCw size={14} className={busy ? "spin" : undefined} aria-hidden="true" />
            {busy ? "更新中…" : "更新订阅"}
          </button>
          <details className="feed-management">
            <summary className="button quiet small">
              {feeds.length} 个订阅
              <ChevronDown size={13} aria-hidden="true" />
            </summary>
            <div className="feed-sources">
              <p className="muted">
                只在点击“更新订阅”时联网。取消订阅会保留已收录的文章和笔记。
              </p>
              {(api.opmlPreview || api.exportOpml) && (
                <div className="inline-actions">
                  {api.opmlPreview && (
                    <button type="button" className="button quiet small" disabled={busy} onClick={() => setImporting(true)}>
                      <Upload size={13} aria-hidden="true" />
                      导入 OPML
                    </button>
                  )}
                  {api.exportOpml && (
                    <button type="button" className="button quiet small" disabled={busy} onClick={exportList}>
                      <Download size={13} aria-hidden="true" />
                      导出 OPML
                    </button>
                  )}
                </div>
              )}
              {feeds.map((feed) => (
                <div className="feed-source" key={feed.id}>
                  <div>
                    <strong>{feed.title}</strong>
                    <span className="muted">{feed.url}</span>
                    <span className={feed.error ? "field-error" : "muted"}>
                      {feed.error ||
                        (feed.checkedAt
                          ? `上次检查 ${timeFormat.format(new Date(feed.checkedAt))}`
                          : "尚未更新")}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="button quiet small"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api.unsubscribe!(feed.id);
                        setFailed((items) => items.filter((item) => item.id !== feed.id));
                        return "已取消订阅，文章和笔记已保留。";
                      })
                    }
                  >
                    取消订阅
                  </button>
                </div>
              ))}
            </div>
          </details>
          {lastChecked !== undefined && (
            <span className="feed-checked">上次更新 {timeFormat.format(lastChecked)}</span>
          )}
        </div>
      )}
      {failed.length > 0 && (
        <div className={`notice ${failed.length === feeds.length ? "danger" : "warning"}`} role="status">
          <TriangleAlert size={16} aria-hidden="true" />
          <div className="notice-body">
            <span className="notice-title">
              {failed.length === feeds.length
                ? "订阅未能更新"
                : `${failed.length} 个订阅未能更新`}
            </span>
            {failed.map((item) => (
              <p key={item.id}>
                {item.title}：{item.error}
              </p>
            ))}
            <p>已有文章和笔记都在。</p>
            <div className="notice-actions">
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() =>
                  refresh(feeds.filter((feed) => failed.some((item) => item.id === feed.id)))
                }
              >
                {failed.length === 1 ? "重试这个订阅" : `重试这 ${failed.length} 个`}
              </button>
              <button
                type="button"
                className="button quiet"
                onClick={() => setFailed([])}
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      )}
      {message && (
        <p className="feed-message" role="status">
          {message}
          <button
            type="button"
            className="icon-button"
            aria-label="关闭消息"
            onClick={() => setMessage("")}
          >
            <X size={13} />
          </button>
        </p>
      )}
    </div>
  );
}
