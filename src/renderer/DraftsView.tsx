import type { ReactNode } from "react";
import { Archive, FileText, FileUp, HardDrive, Plus, Search } from "lucide-react";
import type { Draft, Publication } from "../shared/contracts";
import { excerpt, updatedLabel } from "./draftText";

interface Props {
  drafts: Draft[];
  publications: Publication[];
  active: Draft | undefined;
  query: string;
  showArchived: boolean;
  busy: boolean;
  listHidden: boolean;
  detailHidden: boolean;
  onQuery: (value: string) => void;
  onFilter: (archived: boolean) => void;
  onSelect: (draft: Draft) => void;
  onCreate: () => void;
  onImport: () => void;
  onUnarchive: (draft: Draft) => void;
  children: ReactNode;
}

const platformName = { juejin: "掘金", x: "X" } as const;
export function DraftsView({
  drafts,
  publications,
  active,
  query,
  showArchived,
  busy,
  listHidden,
  detailHidden,
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
  const activeCount = drafts.filter((draft) => !draft.archived).length;
  const published = new Map<string, Set<Publication["platform"]>>();
  for (const item of publications) {
    const platforms = published.get(item.draftId) ?? new Set();
    platforms.add(item.platform);
    published.set(item.draftId, platforms);
  }

  if (!drafts.length)
    return (
      <div className="drafts-view">
        <section className="empty-state first-run" aria-labelledby="first-run-title">
          <div className="empty-symbol">
            <FileText size={26} strokeWidth={1.5} aria-hidden="true" />
          </div>
          <h2 id="first-run-title">把第一篇文章放进来</h2>
          <p>导入在 Codex、Claude 或项目里写好的 Markdown，或者直接开始写。整理、预览之后，再分享出去。</p>
          <div className="actions">
            <button type="button" className="button primary large" disabled={busy} onClick={onImport}>
              <FileUp size={16} aria-hidden="true" />
              导入 Markdown
            </button>
            <button type="button" className="button large" disabled={busy} onClick={onCreate}>
              <Plus size={16} aria-hidden="true" />
              新建稿件
            </button>
          </div>
          <span className="fine">
            <HardDrive size={13} aria-hidden="true" />
            稿件、图片和历史版本只保存在这台电脑上，无需注册账号。
          </span>
        </section>
      </div>
    );

  return (
    <div className="drafts-view panes">
      {!listHidden && (
        <section className="list-pane" aria-label="稿件列表">
          <div className="list-head">
            <div className="pane-header" data-tauri-drag-region>
              <h1>稿件</h1>
              <button type="button" className="button small" disabled={busy} onClick={onImport}>
                <FileUp size={14} aria-hidden="true" />
                导入
              </button>
              <button type="button" className="button small" disabled={busy} onClick={onCreate}>
                <Plus size={14} aria-hidden="true" />
                新建
              </button>
            </div>
            <label className="search-box">
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                placeholder="搜索标题和正文"
                aria-label="搜索稿件"
                value={query}
                onChange={(event) => onQuery(event.target.value)}
              />
            </label>
            <div className="segmented full" role="group" aria-label="稿件筛选">
              <button
                type="button"
                disabled={busy}
                aria-pressed={!showArchived}
                onClick={() => onFilter(false)}
              >
                全部 <span className="num">{activeCount}</span>
              </button>
              <button
                type="button"
                disabled={busy}
                aria-pressed={showArchived}
                onClick={() => onFilter(true)}
              >
                已归档 <span className="num">{drafts.length - activeCount}</span>
              </button>
            </div>
          </div>
          <div className="list-scroll">
            {visible.length ? (
              visible.map((draft) => {
                const platforms = [...(published.get(draft.id) ?? [])];
                const text = excerpt(draft.body);
                return (
                  <button
                    type="button"
                    className={"list-item" + (draft.id === active?.id ? " active" : "")}
                    key={draft.id}
                    disabled={busy}
                    aria-current={draft.id === active?.id ? "true" : undefined}
                    onClick={() => onSelect(draft)}
                  >
                    <span className={draft.title ? "row-title" : "row-title untitled"}>
                      {draft.title || "未命名稿件"}
                    </span>
                    <span className="row-excerpt">{text || "还没有正文"}</span>
                    <span className="row-meta">
                      <span>{updatedLabel(draft.updatedAt)}</span>
                      {platforms.length > 0 && (
                        <span className="badge accent">
                          已发布 · {platforms.map((item) => platformName[item]).join("、")}
                        </span>
                      )}
                      {draft.project && <span className="badge">{draft.project}</span>}
                    </span>
                  </button>
                );
              })
            ) : (
              <p className="list-empty">
                {query
                  ? "没有找到匹配的稿件，试试其他关键词。"
                  : showArchived
                    ? "还没有归档的稿件。归档的稿件随时可以找回。"
                    : "没有进行中的稿件。新建或导入一篇开始。"}
              </p>
            )}
          </div>
        </section>
      )}
      {detailHidden ? null : active && !active.archived ? (
        children
      ) : active?.archived ? (
        <div className="detail-pane empty-state">
          <div className="empty-symbol">
            <Archive size={24} aria-hidden="true" />
          </div>
          <h2>{active.title || "未命名稿件"}</h2>
          <p>这篇稿件已归档，线上内容不受影响。</p>
          <div className="actions">
            <button type="button" className="button primary" disabled={busy} onClick={() => onUnarchive(active)}>
              恢复到稿件
            </button>
          </div>
        </div>
      ) : (
        <div className="detail-pane empty-state">
          <div className="empty-symbol">
            <FileText size={24} strokeWidth={1.5} aria-hidden="true" />
          </div>
          <h2>{showArchived ? "归档的稿件，随时可以找回" : "选择一篇稿件，继续整理"}</h2>
          <p>
            {showArchived
              ? "从左侧打开稿件，即可恢复到稿件列表。"
              : "从左侧打开稿件，接着编辑、预览或准备发布。"}
          </p>
        </div>
      )}
    </div>
  );
}
