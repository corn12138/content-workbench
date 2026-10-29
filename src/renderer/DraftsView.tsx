import type { ReactNode } from "react";
import { FileText, FolderClosed, Plus, Search, Upload } from "lucide-react";
import type { Draft } from "../shared/contracts";

interface Props {
  drafts: Draft[];
  active: Draft | undefined;
  query: string;
  showArchived: boolean;
  busy: boolean;
  onQuery: (value: string) => void;
  onFilter: (archived: boolean) => void;
  onSelect: (draft: Draft) => void;
  onCreate: () => void;
  onImport: () => void;
  onUnarchive: (draft: Draft) => void;
  children: ReactNode;
}
export function DraftsView({
  drafts,
  active,
  query,
  showArchived,
  busy,
  onQuery,
  onFilter,
  onSelect,
  onCreate,
  onImport,
  onUnarchive,
  children,
}: Props) {
  const visible = drafts
    .filter(
      (item) =>
        item.archived === showArchived &&
        [item.title, item.project, item.body]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const hasDrafts = drafts.some((draft) => !draft.archived);
  return (
    <div className="drafts-view">
      <header className="page-heading">
        <div>
          <p className="eyebrow">从想法，到分享</p>
          <h1>稿件</h1>
        </div>
        <div className="toolbar">
          <button className="button quiet" disabled={busy} onClick={onCreate}>
            <Plus size={17} />
            新建
          </button>
          <button className="button" disabled={busy} onClick={onImport}>
            <Upload size={16} />
            导入文章
          </button>
        </div>
      </header>
      <div className="split-view">
        <section className="list-pane" aria-label="稿件列表">
          <div className="list-tools">
            <label className="search-box">
              <Search size={15} />
              <input
                placeholder="搜索稿件"
                aria-label="搜索稿件"
                value={query}
                onChange={(event) => onQuery(event.target.value)}
              />
            </label>
            <div className="list-filters">
              <button
                className={!showArchived ? "selected" : ""}
                disabled={busy}
                aria-pressed={!showArchived}
                onClick={() => onFilter(false)}
              >
                全部稿件
              </button>
              <button
                className={showArchived ? "selected" : ""}
                disabled={busy}
                aria-pressed={showArchived}
                onClick={() => onFilter(true)}
              >
                已归档
              </button>
            </div>
          </div>
          <div className="scroll-list">
            {visible.length ? (
              visible.map((draft) => (
                <button
                  className={
                    "list-item " + (draft.id === active?.id ? "active" : "")
                  }
                  key={draft.id}
                  disabled={busy}
                  aria-current={draft.id === active?.id ? "true" : undefined}
                  onClick={() => onSelect(draft)}
                >
                  <div className="list-item-top">
                    <FileText size={15} />
                    <span>
                      {new Date(draft.updatedAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                  <h3>{draft.title || "未命名稿件"}</h3>
                  <p>
                    {draft.body
                      .replace(/[#*\x60>]/g, "")
                      .trim()
                      .slice(0, 70) || "准备写下新的内容"}
                  </p>
                  {draft.project && (
                    <small>
                      <FolderClosed size={12} />
                      {draft.project}
                    </small>
                  )}
                </button>
              ))
            ) : (
              <p className="list-empty">
                {query
                  ? "没有找到匹配稿件"
                  : showArchived
                    ? "还没有归档稿件"
                    : "你的文章会出现在这里"}
              </p>
            )}
          </div>
        </section>
        {active && !active.archived ? (
          children
        ) : active?.archived ? (
          <div className="detail-pane empty-state">
            <FileText size={35} />
            <h2>{active.title || "未命名稿件"}</h2>
            <p>这篇稿件已归档，线上内容不受影响。</p>
            <button
              className="button"
              disabled={busy}
              onClick={() => onUnarchive(active)}
            >
              恢复到稿件
            </button>
          </div>
        ) : showArchived || hasDrafts ? (
          <div className="detail-pane empty-state">
            <FileText size={35} strokeWidth={1.3} />
            <h2>
              {showArchived
                ? "归档的稿件，随时可以找回"
                : "选择一篇稿件，继续整理"}
            </h2>
            <p>
              {showArchived
                ? "从左侧打开稿件，即可恢复到稿件列表。"
                : "从左侧打开文章，接着编辑、预览或准备发布。"}
            </p>
          </div>
        ) : (
          <div className="detail-pane empty-state">
            <div className="empty-symbol">
              <FileText size={38} strokeWidth={1.3} />
            </div>
            <p className="eyebrow">留住值得分享的内容</p>
            <h2>把第一篇文章放进来</h2>
            <p>
              导入写好的 Markdown，或从一段想法开始。
              <br />
              整理、预览，再分享给更多人。
            </p>
            <button
              className="button primary"
              disabled={busy}
              onClick={onImport}
            >
              <Upload size={16} />
              导入文章
            </button>
            <button className="text-button" disabled={busy} onClick={onCreate}>
              也可以新建草稿
            </button>
            <small>导入后检查预览，发布时仍需在平台上传图片。</small>
          </div>
        )}
      </div>
    </div>
  );
}
