import { ExternalLink, MessageSquare } from "lucide-react";
import type { Publication } from "../shared/contracts";
import { api, errorMessage } from "./api";

export function FeedbackView({
  publications,
  notify,
}: {
  publications: Publication[];
  notify: (message: string) => void;
}) {
  return (
    <section className="feedback-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">分享之后</p>
          <h1>反馈</h1>
          <p className="muted">把已发布的作品放在一起，方便回来跟进。</p>
        </div>
      </header>
      {!publications.length ? (
        <div className="empty-state">
          <MessageSquare size={36} strokeWidth={1.4} />
          <h2>发布后的反馈，会留在这里</h2>
          <p>
            先从稿件中准备发布，完成后记录文章链接。
            <br />
            平台评论和阅读数据尚未接入。
          </p>
        </div>
      ) : (
        <>
          <div className="notice">
            评论与阅读数据尚未接入。你可以从下方打开作品，在平台查看反馈。
          </div>
          <h2 className="section-heading">
            已记录的作品 <span>{publications.length}</span>
          </h2>
          <div className="publication-list">
            {publications.map((item) => (
              <article key={item.id}>
                <div className="publication-platform">
                  {item.platform === "juejin" ? "掘金" : "X"}
                </div>
                <div className="publication-info">
                  <h3>{item.title || "未命名稿件"}</h3>
                  <p>
                    人工确认 · {new Date(item.confirmedAt).toLocaleDateString()}{" "}
                    · 暂未获取数据
                  </p>
                </div>
                <button
                  className="button quiet"
                  onClick={() =>
                    void api
                      .openExternal(item.url)
                      .catch((e) => notify(errorMessage(e)))
                  }
                >
                  打开原文 <ExternalLink size={15} />
                </button>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
