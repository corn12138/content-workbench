import type { Reading } from "../../shared/contracts";
import { sourceName } from "./sourceName";

export type ReadingFilter = "all" | "unread" | "notes";

interface ReadingListProps {
  items: Reading[];
  selectedId?: string;
  filter: ReadingFilter;
  setFilter: (filter: ReadingFilter) => void;
  select: (item: Reading) => Promise<void>;
  busy: boolean;
}

export function ReadingList({
  items,
  selectedId,
  filter,
  setFilter,
  select,
  busy,
}: ReadingListProps) {
  const visible = items.filter(
    (item) =>
      filter === "all" ||
      (filter === "unread" ? !item.read : Boolean(item.note.trim())),
  );

  return (
    <div className="list-pane reading-list">
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
          {filter === "notes"
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
          <span className="reading-item-meta">
            {sourceName(item.url)}
            {item.note.trim() ? " · 有笔记" : ""}
          </span>
        </button>
      ))}
    </div>
  );
}
