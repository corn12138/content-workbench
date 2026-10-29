import { useDeferredValue, useMemo, useState } from "react";
import {
  filterReadings,
  readingIndex,
  type ReadingFilter,
} from "./filterReadings";
import type { Reading, Library } from "../../shared/contracts";
import { sourceName } from "./sourceName";

export type { ReadingFilter } from "./filterReadings";

interface ReadingListProps {
  items: Reading[];
  library: Library;
  selectedId?: string;
  filter: ReadingFilter;
  setFilter: (filter: ReadingFilter) => void;
  select: (item: Reading) => Promise<void>;
  busy: boolean;
}

export function ReadingList({
  items,
  library,
  selectedId,
  filter,
  setFilter,
  select,
  busy,
}: ReadingListProps) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const deferredQuery = useDeferredValue(query);
  const content = useMemo(() => readingIndex(library.items), [library.items]);
  const visible = useMemo(
    () => filterReadings(items, library, filter, source, deferredQuery),
    [items, library, filter, source, deferredQuery],
  );

  return (
    <div className="list-pane reading-list">
      <div className="reading-search">
        <input
          className="input"
          type="search"
          aria-label="搜索标题、内容和笔记"
          placeholder="搜索标题、内容和笔记"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {library.feeds.length > 0 && (
          <select
            className="input"
            aria-label="筛选订阅来源"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">所有来源</option>
            {library.feeds.map((feed) => (
              <option key={feed.id} value={feed.id}>
                {feed.title}
                {feed.enabled ? "" : "（已取消）"}
              </option>
            ))}
          </select>
        )}
        <span className="muted small" role="status">
          {visible.length} 篇{query.trim() ? "匹配文章" : "文章"}
        </span>
      </div>
      <div className="toolbar reading-filters" aria-label="筛选阅读资料">
        {(
          [
            ["all", "全部"],
            ["unread", "未读"],
            ["notes", "有笔记"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            className={filter === value ? "active" : ""}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {visible.length === 0 && (
        <p className="reading-list-empty muted">
          {query.trim() || source
            ? "没有匹配的文章，试试其他关键词或来源。"
            : filter === "notes"
              ? "写下第一条笔记后，会出现在这里。"
              : "这些文章都读过了。"}
        </p>
      )}
      {visible.map((item) => (
        <button
          className={`list-item reading-item ${selectedId === item.id ? "active" : ""}`}
          key={item.id}
          onClick={() => void select(item)}
          disabled={busy}
          aria-current={selectedId === item.id ? "true" : undefined}
        >
          <span className="reading-item-title">
            {!item.read && <i className="reading-unread" aria-label="未读" />}
            {item.title || sourceName(item.url)}
          </span>
          {content.get(item.id)?.summary && (
            <span className="reading-item-excerpt">
              {content.get(item.id)!.summary.slice(0, 180)}
            </span>
          )}
          <span className="reading-item-meta">
            {sourceName(item.url)}
            {item.note.trim() ? " · 有笔记" : ""}
          </span>
        </button>
      ))}
    </div>
  );
}
