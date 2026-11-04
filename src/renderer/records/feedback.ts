import type { Feedback, Metrics, Platform, Publication } from "../../shared/contracts";

/** Platform-specific counters. Juejin "阅读" and X "展示" measure different things and are never merged. */
export const metricFields: Record<Platform, { key: string; label: string }[]> = {
  juejin: [
    { key: "views", label: "阅读" },
    { key: "likes", label: "点赞" },
    { key: "comments", label: "评论" },
    { key: "collects", label: "收藏" },
  ],
  x: [
    { key: "impressions", label: "展示" },
    { key: "likes", label: "喜欢" },
    { key: "replies", label: "回复" },
    { key: "reposts", label: "转帖" },
    { key: "quotes", label: "引用" },
    { key: "bookmarks", label: "书签" },
  ],
};

/** Empty input is unknown (null); only typed digits become numbers, including an explicit 0. */
export function parseMetrics(platform: Platform, values: Record<string, string>): { metrics: Metrics } | { error: string } {
  const metrics: Metrics = {};
  for (const { key, label } of metricFields[platform]) {
    const raw = (values[key] ?? "").trim().replace(/[,，\s]/g, "");
    if (!raw) {
      metrics[key] = null;
      continue;
    }
    if (!/^\d{1,15}$/.test(raw)) return { error: `“${label}”请填写 0 或正整数，留空表示未知。` };
    metrics[key] = Number(raw);
  }
  return { metrics };
}

export const formatMetric = (value: number | null | undefined) =>
  value === null || value === undefined ? "未知" : value.toLocaleString("zh-CN");

/** Local datetime-input value for a date, minute precision. */
export function localInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function toISO(local: string): string | null {
  const time = new Date(local).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function searchPublications(items: Publication[], platform: "all" | Platform, query: string) {
  const needle = query.trim().toLocaleLowerCase();
  return items
    .filter((item) => platform === "all" || item.platform === platform)
    .filter((item) => !needle || `${item.title}\n${item.url}`.toLocaleLowerCase().includes(needle))
    .sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt));
}

export const feedbackFor = (feedback: Feedback[], publicationId: string) =>
  feedback
    .filter((item) => item.publicationId === publicationId)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt) || b.createdAt.localeCompare(a.createdAt));

/** How the published revision relates to the local draft now. */
export function versionStatus(publication: Publication, draft: { revision: number; archived: boolean } | undefined) {
  if (!draft) return "本地稿件已不存在，链接与发布时标题仍保留。";
  const base = `发布时为版本 ${publication.draftRevision}`;
  const changed =
    draft.revision === publication.draftRevision
      ? "，稿件之后没有修改"
      : `，稿件现在是版本 ${draft.revision}（发布后有修改）`;
  return `${base}${changed}${draft.archived ? "，稿件已归档" : ""}。`;
}
