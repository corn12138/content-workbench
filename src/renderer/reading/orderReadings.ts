import type { FeedItem, Reading } from "../../shared/contracts";

export function orderReadings(
  readings: Reading[],
  entries: FeedItem[],
): Reading[] {
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
  // Batch insertion times reflect fetch order, not the order in which articles were published.
  const date = (reading: Reading) =>
    published.get(reading.id) ?? Date.parse(reading.updatedAt);
  return [...readings].sort((a, b) => date(b) - date(a));
}
