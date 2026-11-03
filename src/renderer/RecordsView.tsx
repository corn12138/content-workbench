import { useState } from "react";
import { CircleCheckBig, CircleHelp, ExternalLink, Info, PenLine, Send } from "lucide-react";
import type { Publication } from "../shared/contracts";
import { api, errorMessage } from "./api";

const platformName = { juejin: "掘金", x: "X" } as const;
const timeFormat = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Publication records: only stored links and their provenance. Platform metrics are not integrated. */
export function RecordsView({
  publications,
  notify,
  onDrafts,
}: {
  publications: Publication[];
  notify: (message: string) => void;
  onDrafts: () => void;
}) {
  const [platform, setPlatform] = useState<"all" | Publication["platform"]>("all");
  const visible = publications
    .filter((item) => platform === "all" || item.platform === platform)
    .sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt));
  return (
    <section className="page records-page" aria-labelledby="records-title">
      <div className="page-inner">
        <header className="page-heading" data-tauri-drag-region>
          <div>
            <h1 id="records-title">发布记录</h1>
            <p>分享出去的作品都在这里，方便回到平台跟进。</p>
          </div>
          {publications.length > 0 && (
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
                <p>评论数和阅读量尚未接入。需要查看反馈时，打开作品即可在平台上看到。</p>
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
                <li className="record-row" key={item.id}>
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
                    {item.confirmation === "api" ? "平台回执" : "人工确认"}
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
                  </span>
                </li>
              ))}
            </ul>
            {!visible.length && (
              <p className="list-empty">没有{platformName[platform as Publication["platform"]]}的发布记录。</p>
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
