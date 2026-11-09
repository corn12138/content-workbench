import { useMemo, type ReactNode } from "react";
import { Check, FilePlus2, NotebookPen, Search, Trash2 } from "lucide-react";
import { useContextMenu } from "../deletion/ContextMenu";
import type { Reading, Library } from "../../shared/contracts";
import { readingIndex, type ReadingFilter } from "./filterReadings";
import { groupReadings, publishedDates, readingDate } from "./orderReadings";
import { sourceName } from "./sourceName";

export type { ReadingFilter } from "./filterReadings";

interface ReadingListProps {
  visible: Reading[];
  total: number;
  library: Library;
  selectedId?: string;
  filter: ReadingFilter;
  setFilter: (filter: ReadingFilter) => void;
  query: string;
  setQuery: (query: string) => void;
  source: string;
  setSource: (source: string) => void;
  unread: number;
  select: (item: Reading) => Promise<void>;
  busy: boolean;
  tools: ReactNode;
  header: ReactNode;
  /** Selected ids while choosing notes to compose; null when not composing. */
  composing?: Set<string> | null;
  onCompose?: () => void;
  onDelete?: (item: Reading) => void;
}

const timeFormat = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
});
const clockFormat = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
});

export function ReadingList({
  visible,
  total,
  library,
  selectedId,
  filter,
  setFilter,
  query,
  setQuery,
  source,
  setSource,
  unread,
  select,
  busy,
  tools,
  header,
  composing,
  onCompose,
  onDelete,
}: ReadingListProps) {
  const context = useContextMenu();
  const content = useMemo(() => readingIndex(library.items), [library.items]);
  const feedTitles = useMemo(
    () => new Map(library.feeds.map((feed) => [feed.id, feed.title])),
    [library.feeds],
  );
  const published = useMemo(() => publishedDates(library.items), [library.items]);
  const groups = useMemo(
    () => groupReadings(visible, published),
    [visible, published],
  );
  const when = (item: Reading, group: string) => {
    const time = readingDate(item, published);
    if (!Number.isFinite(time)) return "";
    return group === "今天" ? clockFormat.format(time) : timeFormat.format(time);
  };
  const filtered = !!(query.trim() || source || filter !== "all");

  return (
    <>
      {context.menu}
      <div className="list-head">
        {header}
        {tools}
        <label className="search-box">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            aria-label="搜索标题、内容和笔记"
            placeholder="搜索标题、正文和笔记"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
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
        <div className="segmented full" role="group" aria-label="筛选阅读资料">
          {(
            [
              ["all", "全部"],
              ["unread", `未读 ${unread}`],
              ["notes", "有笔记"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="list-scroll" aria-label="文章列表">
        <p className="list-status" role="status">
          {composing
            ? "点选要整理的笔记（只能选择有笔记的文章）"
            : filtered
              ? `${visible.length} 篇匹配文章`
              : `共 ${total} 篇`}
          {!composing && onCompose && (
            <button type="button" className="link-button" disabled={busy} onClick={onCompose}>
              <FilePlus2 size={12} aria-hidden="true" />
              整理多篇笔记
            </button>
          )}
        </p>
        {visible.length === 0 && (
          <p className="list-empty">
            {total === 0
              ? "还没有文章。添加订阅或文章链接后会出现在这里。"
              : query.trim() || source
                ? "没有匹配的文章，试试其他关键词或来源。"
                : filter === "notes"
                  ? "写下第一条笔记后，会出现在这里。"
                  : "这些文章都读过了。"}
          </p>
        )}
        {groups.map((group) => (
          <section key={group.label} aria-label={group.label}>
            <h2 className="group-label">
              <span>{group.label}</span>
              <span className="num">{group.items.length} 篇</span>
            </h2>
            {group.items.map((item) => {
              const entry = content.get(item.id);
              const feed = entry ? feedTitles.get(entry.feedId) : undefined;
              const hasNote = !!item.note.trim();
              const chosen = !!composing?.has(item.id);
              return (
                <button
                  type="button"
                  className={`list-item reading-item${!composing && selectedId === item.id ? " active" : ""}${chosen ? " active" : ""}${item.read ? " read" : ""}`}
                  key={item.id}
                  onClick={() => void select(item)}
                  onContextMenu={(event) => {
                    if (!onDelete || composing) return;
                    context.show(event, [
                      {
                        label: item.note.trim() ? "删除文章和笔记…" : "删除文章…",
                        icon: <Trash2 size={15} aria-hidden="true" />,
                        danger: true,
                        disabled: busy,
                        run: () => onDelete(item),
                      },
                    ]);
                  }}
                  disabled={busy || (!!composing && !hasNote)}
                  aria-current={!composing && selectedId === item.id ? "true" : undefined}
                  aria-pressed={composing ? chosen : undefined}
                >
                  <span className="reading-item-grid">
                    {composing && (
                      <span className="compose-check" aria-hidden="true">
                        {chosen ? <Check size={14} /> : null}
                      </span>
                    )}
                    <span
                      className={item.read ? "reading-dot" : "reading-dot unread"}
                      aria-hidden="true"
                    />
                    <span className="reading-item-text">
                      <span className="row-title">
                        {item.title || sourceName(item.url)}
                      </span>
                      <span className="row-meta">
                        <span className="reading-item-source">
                          {feed || sourceName(item.url)}
                        </span>
                        {when(item, group.label) && (
                          <span>{when(item, group.label)}</span>
                        )}
                        {hasNote && (
                          <span className="reading-item-note">
                            <NotebookPen size={12} aria-hidden="true" />
                            笔记
                          </span>
                        )}
                        {entry?.content?.kind === "summary" && <span>仅摘要</span>}
                      </span>
                    </span>
                  </span>
                  <span className="sr-only">
                    {item.read ? "已读" : "未读"}
                    {hasNote ? "，有笔记" : ""}
                  </span>
                </button>
              );
            })}
          </section>
        ))}
      </div>
    </>
  );
}
