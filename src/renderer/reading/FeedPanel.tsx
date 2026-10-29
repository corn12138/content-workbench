import { useEffect, useRef, useState, type FormEvent } from "react";
import { Plus, RefreshCw, Rss } from "lucide-react";
import type { Library } from "../../shared/contracts";
import { api, errorMessage } from "../api";

interface Props {
  library: Library;
  onLibrary: (library: Library) => void;
  onRefresh: () => Promise<void>;
}

export function FeedPanel({ library, onLibrary, onRefresh }: Props) {
  const feeds = library.feeds.filter((feed) => feed.enabled);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
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

  const run = async (task: () => Promise<string>) => {
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
      if (active.current) setMessage(errorMessage(error));
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  };

  const add = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await api.addFeed!(url.trim());
      if (active.current) {
        setUrl("");
        setAdding(false);
      }
      return "已添加订阅，文章已放入阅读列表。";
    });
  };

  const refresh = () =>
    void run(async () => {
      const queue = [...feeds];
      let failed = 0;
      // A small worker pool keeps many sources from opening connections at once.
      await Promise.all(
        Array.from({ length: Math.min(3, queue.length) }, async () => {
          while (active.current) {
            const feed = queue.shift();
            if (!feed) return;
            try {
              if ((await api.refreshFeed!(feed.id)).error) failed += 1;
            } catch {
              failed += 1;
            }
          }
        }),
      );
      return failed
        ? `${failed} 个订阅暂未更新，可展开订阅查看。已有文章和笔记都在。`
        : "订阅已更新，重复文章不会再次添加。";
    });

  return (
    <div className="feed-panel">
      <div className="feed-toolbar">
        <button
          className="button quiet"
          onClick={() => setAdding(!adding)}
          aria-expanded={adding}
          disabled={busy}
        >
          <Rss size={15} />
          添加订阅
        </button>
        {feeds.length > 0 && (
          <>
            <button className="button quiet" onClick={refresh} disabled={busy}>
              <RefreshCw size={14} />
              {busy ? "更新中…" : "更新订阅"}
            </button>
            <details className="feed-management">
              <summary>{feeds.length} 个订阅</summary>
              <div className="feed-sources">
                <p className="muted">
                  点击更新时读取最新文章。取消订阅会保留已收录的文章和笔记。
                </p>
                {feeds.map((feed) => (
                  <div className="feed-source" key={feed.id}>
                    <div>
                      <strong>{feed.title}</strong>
                      <span className="muted">{feed.url}</span>
                      <span className={feed.error ? "reading-error" : "muted"}>
                        {feed.error ||
                          (feed.checkedAt
                            ? `上次检查 ${new Date(feed.checkedAt).toLocaleString()}`
                            : "尚未更新")}
                      </span>
                    </div>
                    <button
                      className="button quiet"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api.unsubscribe!(feed.id);
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
          </>
        )}
      </div>
      {adding && (
        <form className="feed-add" onSubmit={add}>
          <label htmlFor="feed-url">RSS / Atom 订阅地址</label>
          <div>
            <input
              id="feed-url"
              className="input"
              type="url"
              required
              autoFocus
              disabled={busy}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/feed.xml"
            />
            <button className="button primary" disabled={busy}>
              <Plus size={15} />
              {busy ? "读取中…" : "添加"}
            </button>
          </div>
          <p className="muted">
            填写网站提供的订阅地址，文章会自动出现在下方。
          </p>
        </form>
      )}
      {message && (
        <p className="feed-message" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
