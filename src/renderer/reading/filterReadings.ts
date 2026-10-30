import type { FeedItem, Library, Reading } from "../../shared/contracts";
export type ReadingFilter = "all" | "unread" | "notes";

export function readingIndex(items: FeedItem[]) {
  const byReading = new Map<string, FeedItem>();
  for (const item of items) {
    if (!item.readingId) continue;
    const previous = byReading.get(item.readingId);
    if (!previous || item.summary.length > previous.summary.length)
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
  const content = readingIndex(library.items);
  const sourceIds = new Set(
    library.items
      .filter((item) => item.feedId === source)
      .map((item) => item.readingId),
  );
  const needle = query.trim().toLocaleLowerCase();
  return items.filter((item) => {
    if (
      (filter === "unread" && item.read) ||
      (filter === "notes" && !item.note.trim())
    )
      return false;
    if (source && !sourceIds.has(item.id)) return false;
    return (
      !needle ||
      [item.title, item.url, item.note, content.get(item.id)?.summary || ""]
        .join("\n")
        .toLocaleLowerCase()
        .includes(needle)
    );
  });
}
