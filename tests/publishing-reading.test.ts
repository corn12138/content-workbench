import test from "node:test";
import assert from "node:assert/strict";
import {
  checkXText,
  sensitiveText,
  initialXText,
} from "../src/renderer/publishing/text";
import {
  filterReadings,
  readingIndex,
} from "../src/renderer/reading/filterReadings";
import type { Library, Reading } from "../src/shared/contracts";

test("X count handles CJK, family emoji and shortened URLs; local resources cannot be sent", () => {
  assert.equal(checkXText("中".repeat(140)).valid, true);
  assert.equal(checkXText("中".repeat(141)).valid, false);
  assert.equal(checkXText("👨‍👩‍👧‍👦").length, 2);
  assert.equal(checkXText("https://example.com/very/long/path").length, 23);
  assert.equal(checkXText("![image](assets/example.png)").valid, false);
  assert.equal(checkXText("   ").valid, false);
  assert.equal(sensitiveText("password='not-a-real-password'"), true);
});

test("aggregation searches cached content and notes, filters source without dropping shared articles", () => {
  const readings: Reading[] = [
    {
      id: "a",
      title: "Rust",
      url: "https://example.com/a",
      note: "my idea",
      read: false,
      createdAt: "",
      updatedAt: "",
    },
    {
      id: "b",
      title: "React",
      url: "https://example.com/b",
      note: "",
      read: true,
      createdAt: "",
      updatedAt: "",
    },
  ];
  const library: Library = {
    feeds: [],
    items: [
      {
        feedId: "one",
        readingId: "a",
        key: "1",
        title: "Rust",
        url: readings[0].url,
        summary: "short",
        publishedAt: null,
      },
      {
        feedId: "two",
        readingId: "a",
        key: "2",
        title: "Rust",
        url: readings[0].url,
        summary: "Detailed ASYNC contents",
        publishedAt: null,
      },
    ],
  };
  assert.equal(readingIndex(library.items).get("a")?.feedId, "two");
  assert.deepEqual(
    filterReadings(readings, library, "all", "one", "async").map((x) => x.id),
    ["a"],
  );
  assert.deepEqual(
    filterReadings(readings, library, "notes", "", "idea").map((x) => x.id),
    ["a"],
  );
  assert.deepEqual(
    filterReadings(readings, library, "unread", "", "React"),
    [],
  );
});

test("long articles start with the title rather than overloading the short-post editor", () => {
  assert.equal(initialXText("Title", "Body"), "Title\n\nBody");
  assert.equal(initialXText("Title", "x".repeat(1_000_000)), "Title");
  assert.equal(initialXText("Title", "![image](assets/example.png)"), "Title");
});
