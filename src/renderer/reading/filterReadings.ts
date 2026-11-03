import type { FeedItem, Library, Reading } from "../../shared/contracts";
export type ReadingFilter = "all" | "unread" | "notes";

export function readingIndex(items: FeedItem[]) {
  const byReading = new Map<string, FeedItem>();
  for (const item of items) {
    if (!item.readingId) continue;
    const previous = byReading.get(item.readingId);
    if (
      !previous ||
      (!!item.content && !previous.content) ||
      (!!item.content === !!previous.content &&
        (item.content?.value.length ?? item.summary.length) >
          (previous.content?.value.length ?? previous.summary.length))
    )
      byReading.set(item.readingId, item);
  }
  return byReading;
}
export function filterReadings(
  items: Reading[],
  library: Library,
  filter: ReadingFilter,
  source: string,
  query: string,
) {
  const sourceIds = new Set(
    library.items
      .filter((item) => item.feedId === source)
      .map((item) => item.readingId),
  );
  const needle = query.trim().toLocaleLowerCase();
  const contentMatches = new Set(
    needle
      ? library.items
          .filter((item) => item.summary.toLocaleLowerCase().includes(needle))
          .map((item) => item.readingId)
      : [],
  );
  return items.filter((item) => {
    if (
      (filter === "unread" && item.read) ||
      (filter === "notes" && !item.note.trim())
    )
      return false;
    if (source && !sourceIds.has(item.id)) return false;
    return (
      !needle ||
      contentMatches.has(item.id) ||
      [item.title, item.url, item.note]
        .join("\n")
        .toLocaleLowerCase()
        .includes(needle)
    );
  });
}
