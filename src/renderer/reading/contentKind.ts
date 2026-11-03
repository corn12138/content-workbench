import type { FeedItem } from "../../shared/contracts";

export type ContentKind =
  | "body"
  | "summary"
  | "legacy"
  | "empty"
  | "link";

export interface ContentState {
  kind: ContentKind;
  label: string;
  description: string;
  /** Set when the stored text is shorter than the article because the app cut it. */
  truncated: boolean;
  warning: boolean;
}

/**
 * Describes what the reader actually holds. `truncated` is the app's own storage limit
 * (feed_parse keeps the first 100,000 characters), not a statement about the source.
 */
export function contentState(item?: FeedItem): ContentState {
  if (!item)
    return {
      kind: "link",
      label: "收藏的链接",
      description: "工作台不抓取网页正文，请打开原文阅读。",
      truncated: false,
      warning: false,
    };
  const truncated = !!item.content?.truncated;
  if (item.content?.kind === "body")
    return {
      kind: "body",
      label: truncated ? "已截取" : "订阅正文",
      description: truncated
        ? "内容较长，工作台仅保留前段，请打开原文阅读后续部分。"
        : "显示订阅源提供的正文，完整内容以原文为准。",
      truncated,
      warning: truncated,
    };
  if (item.content?.kind === "summary")
    return {
      kind: "summary",
      label: "仅摘要",
      description: truncated
        ? "来源仅提供摘要，且内容较长，工作台仅保留前段。阅读全文请打开原文。"
        : "来源仅提供摘要。阅读全文请打开原文。",
      truncated,
      warning: truncated,
    };
  if (item.summary.trim())
    return {
      kind: "legacy",
      label: "文字缓存",
      description: "早期保存的纯文字，排版已简化。点击“更新订阅”可获取带排版的内容。",
      truncated: false,
      warning: false,
    };
  return {
    kind: "empty",
    label: "无内容",
    description: "订阅未提供正文或摘要，请打开原文阅读。",
    truncated: false,
    warning: true,
  };
}
