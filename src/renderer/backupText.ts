import type { BackupSummary } from "../shared/contracts";

export function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/** Plain-language counts for the restore confirmation; zero categories are omitted. */
export function backupSummaryLines(summary: BackupSummary) {
  const exported = new Date(summary.exportedAt);
  const lines = [
    `备份时间：${Number.isFinite(exported.getTime()) ? exported.toLocaleString("zh-CN") : "未知"}`,
    `稿件 ${summary.drafts} 篇${summary.archivedDrafts ? `（含已归档 ${summary.archivedDrafts} 篇）` : ""}，历史版本 ${summary.revisions} 个`,
  ];
  const optional: [number, string][] = [
    [summary.images, `图片 ${summary.images} 张`],
    [summary.publications, `发布记录 ${summary.publications} 条`],
    [summary.readings, `阅读资料 ${summary.readings} 篇（有笔记 ${summary.notes} 篇）`],
    [summary.feeds, `订阅来源 ${summary.feeds} 个，订阅文章 ${summary.feedItems} 篇`],
    [summary.preparations, `未完成的发布准备 ${summary.preparations} 项`],
    [summary.compositions, `笔记整理来源 ${summary.compositions} 组`],
    [summary.feedback, `反馈记录 ${summary.feedback} 条`],
  ];
  for (const [count, line] of optional) if (count) lines.push(line);
  return lines;
}
