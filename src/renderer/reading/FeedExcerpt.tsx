import { useLayoutEffect, useRef, useState } from "react";
import type { FeedItem } from "../../shared/contracts";
import { Markdown } from "../Markdown";

export function FeedExcerpt({ item }: { item: FeedItem }) {
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const preview = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const content = item.content;
  const text = content?.value || item.summary;
  const label =
    content?.kind === "summary"
      ? "订阅摘要"
      : content
        ? "订阅正文"
        : "订阅内容";

  useLayoutEffect(() => {
    const box = preview.current;
    const inner = body.current;
    if (!box || !inner || expanded) return;
    // Markup and loaded images can exceed the preview height even when the text is short.
    const measure = () => setOverflow(box.scrollHeight > box.clientHeight + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(inner);
    measure();
    return () => observer.disconnect();
  }, [text, expanded]);

  return (
    <section className="reading-excerpt" aria-label="订阅内容">
      <div className="eyebrow">
        {label}
        {item.publishedAt &&
          ` · ${new Date(item.publishedAt).toLocaleDateString()}`}
      </div>
      <div
        ref={preview}
        className={`reading-preview-text ${expanded ? "expanded" : ""}`}
      >
        <div ref={body}>
          {content?.format === "html" ? (
            <Markdown text={content.value} html baseURL={item.url} />
          ) : (
            text || "订阅未提供正文，请点击“打开原文”阅读。"
          )}
        </div>
      </div>
      {(expanded || overflow) && (
        <button
          className="button quiet"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "收起预览" : "展开订阅内容"}
        </button>
      )}
      {(content || item.summary) && (
        <span className="muted">
          {content ? (
            <>
              {content.kind === "summary"
                ? "来源仅提供摘要。"
                : "显示订阅源提供的正文，完整内容以原文为准。"}
              {content.truncated ? "内容较长，已截取前段。" : ""}
            </>
          ) : (
            "旧文章保留文字缓存，可点击“更新订阅”获取排版。"
          )}
        </span>
      )}
    </section>
  );
}
