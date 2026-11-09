import { useState } from "react";
import { ChevronDown, CircleCheckBig, CircleHelp, ExternalLink, Info, PenLine, Search, Send, Trash2 } from "lucide-react";
import type { Draft, Feedback, Publication } from "../shared/contracts";
import { RecordDetail } from "./records/RecordDetail";
import { feedbackFor, searchPublications } from "./records/feedback";
import { api, errorMessage } from "./api";
import { ConfirmDelete } from "./deletion/ConfirmDelete";
import { useContextMenu } from "./deletion/ContextMenu";
import { recordDeleteCopy } from "./deletion/deleteText";
import { useDeleteShortcut } from "./deletion/useDeleteShortcut";

const platformName = { juejin: "掘金", x: "X" } as const;
const timeFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Publication records: links and their provenance, traced back to the local draft revision, with
 * manual feedback history. Platform data appears only where an official API returned it.
 */
export function RecordsView({
  publications,
  drafts,
  feedback,
  notify,
  onDrafts,
  onOpenDraft,
  onChanged,
  removedDrafts,
}: {
  removedDrafts: { draftId: string }[];
  publications: Publication[];
  drafts: Draft[];
  feedback: Feedback[];
  notify: (message: string) => void;
  onDrafts: () => void;
  onOpenDraft: (draft: Draft) => void;
  onChanged: () => Promise<void>;
}) {
  const [platform, setPlatform] = useState<"all" | Publication["platform"]>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const visible = searchPublications(publications, platform, query);
  const [removing, setRemoving] = useState<Publication | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const context = useContextMenu();
  const canRemove = !!api.removePublication;
  const opened = publications.find((item) => item.id === open);
  useDeleteShortcut(canRemove && opened ? () => setRemoving(opened) : null);
  const remove = async (item: Publication) => {
    setRemoveBusy(true);
    try {
      await api.removePublication!(item.id);
      setRemoving(null);
      if (open === item.id) setOpen(null);
      await onChanged();
      notify("已移除这条本地记录。线上作品不受影响。");
    } catch (error) {
      setRemoving(null);
      notify(`未能移除：${errorMessage(error)}`);
    } finally {
      setRemoveBusy(false);
    }
  };
  return (
    <section className="page records-page" aria-labelledby="records-title">
      {context.menu}
      {removing && (
        <ConfirmDelete
          {...recordDeleteCopy(removing.title, feedbackFor(feedback, removing.id).length)}
          busy={removeBusy}
          onCancel={() => setRemoving(null)}
          onConfirm={() => void remove(removing)}
        />
      )}
      <div className="page-inner">
        <header className="page-heading" data-tauri-drag-region>
          <div>
            <h1 id="records-title">发布记录</h1>
            <p>分享出去的作品都在这里，方便回到平台跟进。</p>
          </div>
          {publications.length > 0 && (
            <div className="records-tools">
            <label className="search-box">
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                aria-label="搜索作品标题或链接"
                placeholder="搜索标题或链接"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="segmented" role="group" aria-label="按平台筛选">
              {(
                [
                  ["all", "全部"],
                  ["juejin", "掘金"],
                  ["x", "X"],
                ] as const
              ).map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={platform === value}
                  onClick={() => setPlatform(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            </div>
          )}
        </header>
        {!publications.length ? (
          <div className="empty-state records-empty">
            <div className="empty-symbol">
              <Send size={24} strokeWidth={1.5} aria-hidden="true" />
            </div>
            <h2>发布后的作品会出现在这里</h2>
            <ol className="steps">
              <li>
                <span className="step-number">1</span>
                <span>在稿件中点“准备发布”，选择掘金或 X。</span>
              </li>
              <li>
                <span className="step-number">2</span>
                <span>掘金：在网页完成发布后，粘贴文章链接保存；X：发布成功后自动记录平台回执。</span>
              </li>
              <li>
                <span className="step-number">3</span>
                <span>记录会显示平台、确认时间和确认方式，随时打开作品查看反馈。</span>
              </li>
            </ol>
            <div className="actions">
              <button type="button" className="button" onClick={onDrafts}>
                前往稿件
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="notice info">
              <Info size={15} aria-hidden="true" />
              <div className="notice-body">
                <p>
                  展开作品可回到本地稿件、查看发布时的版本，并手动记录阅读、点赞等反馈。X 作品连接官方 API
                  后可读取公开数据；评论内容和掘金数据不会自动获取。
                </p>
              </div>
            </div>
            <div className="record-row record-head" aria-hidden="true">
              <span>作品</span>
              <span>平台</span>
              <span>确认时间</span>
              <span>确认方式</span>
              <span />
            </div>
            <ul className="record-list" aria-label="已记录的作品">
              {visible.map((item) => (
                <li className={`record-item${open === item.id ? " open" : ""}`} key={item.id}>
                <div
                  className="record-row"
                  onContextMenu={(event) =>
                    context.show(event, [
                      {
                        label: "打开作品",
                        icon: <ExternalLink size={15} aria-hidden="true" />,
                        run: () => void api.openExternal(item.url).catch((e) => notify(errorMessage(e))),
                      },
                      ...(canRemove
                        ? [{ label: "移除本地记录…", icon: <Trash2 size={15} aria-hidden="true" />, danger: true, run: () => setRemoving(item) }]
                        : []),
                    ])
                  }
                >
                  <div className="record-main">
                    <h2>{item.title || "未命名稿件"}</h2>
                    <p>{item.url}</p>
                  </div>
                  <span className="platform-mark">
                    <i aria-hidden="true">{item.platform === "juejin" ? "掘" : "X"}</i>
                    {platformName[item.platform]}
                  </span>
                  <span className="record-time num">{timeFormat.format(new Date(item.confirmedAt))}</span>
                  <span className="record-source">
                    {item.confirmation === "api" ? (
                      <CircleCheckBig size={13} aria-hidden="true" />
                    ) : (
                      <PenLine size={13} aria-hidden="true" />
                    )}
                    {item.confirmation === "api" ? "平台回执" : item.correctedAt ? "人工确认 · 已更正" : "人工确认"}
                  </span>
                  <span className="record-action">
                    <button
                      type="button"
                      className="button small"
                      aria-label={`在浏览器打开作品：${item.title || "未命名稿件"}`}
                      onClick={() =>
                        void api.openExternal(item.url).catch((e) => notify(errorMessage(e)))
                      }
                    >
                      <ExternalLink size={13} aria-hidden="true" />
                      打开作品
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-expanded={open === item.id}
                      aria-label={`${open === item.id ? "收起" : "展开"}详情：${item.title || "未命名稿件"}`}
                      onClick={() => setOpen((value) => (value === item.id ? null : item.id))}
                    >
                      <ChevronDown size={15} className="chevron" aria-hidden="true" />
                    </button>
                  </span>
                </div>
                {open === item.id && (
                  <RecordDetail
                    publication={item}
                    draft={drafts.find((draft) => draft.id === item.draftId)}
                    feedback={feedbackFor(feedback, item.id)}
                    onOpenDraft={onOpenDraft}
                    onChanged={onChanged}
                    removed={removedDrafts.some((entry) => entry.draftId === item.draftId)}
                    onRemove={canRemove ? () => setRemoving(item) : undefined}
                    notify={notify}
                  />
                )}
                </li>
              ))}
            </ul>
            {!visible.length && (
              <p className="list-empty">
                {query.trim()
                  ? "没有匹配的作品，试试其他关键词。"
                  : `没有${platformName[platform as Publication["platform"]]}的发布记录。`}
              </p>
            )}
            <p className="foot-note">
              <CircleHelp size={13} aria-hidden="true" />
              <span>“人工确认”是你在平台发布后粘贴链接保存的记录；“平台回执”是通过 X API 发布后由平台返回的记录。</span>
            </p>
          </>
        )}
      </div>
    </section>
  );
}
