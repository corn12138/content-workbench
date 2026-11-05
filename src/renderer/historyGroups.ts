import type { Revision } from "../shared/contracts";

/** Autosaves closer together than this belong to one editing session. */
export const SESSION_GAP_MS = 10 * 60 * 1000;

export interface HistoryEntry {
  revision: Revision;
  /** Characters in the body, counted like the editor's "字符" (string length). */
  length: number;
  /** Change against the previous saved version; null for the first version. */
  delta: number | null;
  current: boolean;
  published: boolean;
}

export interface HistoryGroup {
  /** The newest version of the session; the one shown in the list. */
  head: HistoryEntry;
  /** Earlier autosaves of the same session, newest first. */
  older: HistoryEntry[];
  /** savedAt of the oldest version in the session. */
  startedAt: string;
}

const size = (text: string) => text.length;
const blank = (item: Revision) => !item.body.trim() && (!item.title.trim() || item.title === "未命名稿件");

/**
 * Groups stored versions for display only; nothing is merged or deleted. A new group starts after
 * a pause longer than `gap`, and at the current or a published version so those are never hidden.
 * Empty starting versions (an untouched "新建") are left out unless current or published.
 */
export function groupHistory(
  items: Revision[],
  current: number,
  published: ReadonlySet<number>,
  gap = SESSION_GAP_MS,
): HistoryGroup[] {
  const ascending = [...items].sort((a, b) => a.revision - b.revision);
  const entries = ascending.map((revision, index): HistoryEntry => {
    const length = size(revision.body);
    return {
      revision,
      length,
      delta: index === 0 ? null : length - size(ascending[index - 1].body),
      current: revision.revision === current,
      published: published.has(revision.revision),
    };
  });
  const visible = entries
    .filter((entry) => entry.current || entry.published || !blank(entry.revision))
    .reverse();
  const groups: HistoryGroup[] = [];
  let newer: HistoryEntry | null = null;
  for (const entry of visible) {
    const group = groups.at(-1);
    const pause = newer ? Date.parse(newer.revision.savedAt) - Date.parse(entry.revision.savedAt) : Infinity;
    if (!group || pause > gap || entry.current || entry.published) {
      groups.push({ head: entry, older: [], startedAt: entry.revision.savedAt });
    } else {
      group.older.push(entry);
      group.startedAt = entry.revision.savedAt;
    }
    newer = entry;
  }
  return groups;
}

const day = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const clock = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" });

/** "11/5 03:34" or, for a session, "11/5 03:20–03:34". */
export function sessionTime(group: HistoryGroup) {
  const end = new Date(group.head.revision.savedAt);
  if (!group.older.length) return day.format(end);
  const start = new Date(group.startedAt);
  const sameDay = start.toDateString() === end.toDateString();
  const from = day.format(start);
  const to = sameDay ? clock.format(end) : day.format(end);
  return from === day.format(end) ? from : `${from}–${to}`;
}

export function entrySummary(entry: HistoryEntry) {
  const length = `${entry.length.toLocaleString("zh-CN")} 字符`;
  if (entry.delta === null) return length;
  if (entry.delta === 0) return `${length} · 字数不变`;
  return `${length} · ${entry.delta > 0 ? "+" : "−"}${Math.abs(entry.delta).toLocaleString("zh-CN")}`;
}
