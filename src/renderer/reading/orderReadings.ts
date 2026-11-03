import type { FeedItem, Reading } from "../../shared/contracts";

export function publishedDates(entries: FeedItem[]) {
  const published = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.readingId || !entry.publishedAt) continue;
    const date = Date.parse(entry.publishedAt);
    if (Number.isFinite(date))
      published.set(
        entry.readingId,
        Math.max(date, published.get(entry.readingId) ?? -Infinity),
      );
  }
  return published;
}

// Batch insertion times reflect fetch order, not the order in which articles were published.
export const readingDate = (reading: Reading, published: Map<string, number>) =>
  published.get(reading.id) ?? Date.parse(reading.updatedAt);

export function orderReadings(
  readings: Reading[],
  entries: FeedItem[],
): Reading[] {
  const published = publishedDates(entries);
  return [...readings].sort(
    (a, b) => readingDate(b, published) - readingDate(a, published),
  );
}

export interface ReadingGroup {
  label: string;
  items: Reading[];
}

/** Groups an already ordered list by local calendar day; labels describe real dates only. */
export function groupReadings(
  ordered: Reading[],
  published: Map<string, number>,
  now = new Date(),
): ReadingGroup[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  const label = (time: number) => {
    if (!Number.isFinite(time)) return "日期未知";
    if (time >= today) return "今天";
    if (time >= today - day) return "昨天";
    if (time >= today - 6 * day) return "近 7 天";
    const date = new Date(time);
    return date.getFullYear() === now.getFullYear()
      ? `${date.getMonth() + 1} 月`
      : `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
  };
  const groups: ReadingGroup[] = [];
  for (const item of ordered) {
    const name = label(readingDate(item, published));
    const last = groups[groups.length - 1];
    if (last?.label === name) last.items.push(item);
    else groups.push({ label: name, items: [item] });
  }
  return groups;
}
