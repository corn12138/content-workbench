import { test } from "node:test";
import assert from "node:assert/strict";
import { orderReadings } from "../src/renderer/reading/orderReadings";
import type { Reading, FeedItem } from "../src/shared/contracts";

test("RSS uses publication dates across timezones; manual links retain their update order", () => {
  const readings = ["old", "new", "manual"].map(
    (id) =>
      ({
        id,
        url: `https://example.com/${id}`,
        title: id,
        note: "",
        read: false,
        createdAt: "2026-10-29T01:00:00Z",
        updatedAt: "2026-10-29T01:00:00Z",
      }) as Reading,
  );
  const entry = (readingId: string, publishedAt: string): FeedItem => ({
    feedId: "source",
    key: readingId,
    readingId,
    title: readingId,
    url: `https://example.com/${readingId}`,
    summary: "",
    publishedAt,
  });
  const result = orderReadings(readings, [
    entry("old", "2026-10-01T00:00:00Z"),
    entry("new", "2026-10-10T09:00:00+08:00"),
    entry("new", "2026-10-02T00:00:00Z"),
  ]);
  assert.deepEqual(
    result.map((item) => item.id),
    ["manual", "new", "old"],
  );
  assert.deepEqual(
    readings.map((item) => item.id),
    ["old", "new", "manual"],
  );
  assert.deepEqual(
    orderReadings(readings, [entry("old", "invalid")]),
    readings,
  );
});
