import type { Draft, Library, Reading } from "../../shared/contracts";

export interface DeleteCopy {
  title: string;
  lines: string[];
  confirmLabel: string;
}

const name = (title: string, fallback: string) => `《${title.trim() || fallback}》`;

/** What deleting a draft removes and keeps. Published drafts keep their records and published version. */
export function draftDeleteCopy(draft: Draft, publications: number, preparing: boolean): DeleteCopy {
  const lines = publications
    ? [
        `这篇稿件有 ${publications} 条发布记录。稿件会从列表中移除，发布记录、反馈和发布时的版本继续保留，线上作品不受影响。`,
      ]
    : [`稿件和全部 ${draft.revision} 个历史版本会从这台电脑上删除，之后的备份也不再包含它。`];
  if (preparing) lines.push("未完成的发布准备会一起删除。");
  lines.push("删除后可以在提示中立即撤销。");
  return { title: `删除${name(draft.title, "未命名稿件")}？`, lines, confirmLabel: "删除稿件" };
}

export function readingDeleteCopy(reading: Reading, fromFeed: boolean): DeleteCopy {
  const lines = [
    reading.note.trim()
      ? "这篇文章和你写的笔记会一起删除，删除后无法撤销。"
      : "这篇文章会从阅读中删除，删除后无法撤销。",
  ];
  if (fromFeed) lines.push("之后更新订阅时，它不会再次出现。");
  return {
    title: `删除${name(reading.title, reading.url)}？`,
    lines,
    confirmLabel: reading.note.trim() ? "删除文章和笔记" : "删除文章",
  };
}

/** Counts are for articles only this subscription lists; shared articles are never deleted. */
export function feedDeleteCopy(title: string, articles: number, noted: number, withNotes: boolean): DeleteCopy {
  const plain = articles - noted;
  const lines = [
    plain || (withNotes && noted)
      ? `订阅和它收录的 ${withNotes ? articles : plain} 篇文章会被删除，删除后无法撤销。`
      : "订阅会被删除，删除后无法撤销。",
  ];
  if (noted && !withNotes) lines.push(`${noted} 篇写过笔记的文章会保留，正文缓存删除后仍可打开原文。`);
  lines.push("其他订阅也收录的文章不受影响。只想停止更新时，可以选择“取消订阅”。");
  return { title: `删除订阅「${title}」？`, lines, confirmLabel: "删除订阅" };
}

export function recordDeleteCopy(title: string, feedback: number): DeleteCopy {
  return {
    title: `移除${name(title, "未命名稿件")}的发布记录？`,
    lines: [
      `只删除这条本地记录${feedback ? `和 ${feedback} 条反馈记录` : ""}，不会删除线上作品，也不会改动稿件。删除后无法撤销。`,
    ],
    confirmLabel: "移除记录",
  };
}

/** Articles only this subscription lists (others keep shared ones), and how many of them have notes. */
export function feedArticles(library: Library, readings: Reading[], feedId: string) {
  const elsewhere = new Set(
    library.items.filter((item) => item.feedId !== feedId && item.readingId).map((item) => item.readingId),
  );
  const ids = new Set(
    library.items
      .filter((item) => item.feedId === feedId && item.readingId && !elsewhere.has(item.readingId))
      .map((item) => item.readingId!),
  );
  const own = readings.filter((item) => ids.has(item.id));
  return { articles: own.length, noted: own.filter((item) => item.note.trim()).length };
}
