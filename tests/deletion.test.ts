import { test } from "node:test";
import assert from "node:assert/strict";
import type { Draft, Library, Reading } from "../src/shared/contracts";
import { isDeleteShortcut } from "../src/renderer/shortcuts";
import {
  draftDeleteCopy,
  feedArticles,
  feedDeleteCopy,
  readingDeleteCopy,
  recordDeleteCopy,
} from "../src/renderer/deletion/deleteText";
import { versionStatus } from "../src/renderer/records/feedback";

const key = (over: Partial<KeyboardEvent>) =>
  ({ key: "Backspace", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, isComposing: false, keyCode: 8, repeat: false, ...over }) as KeyboardEvent;

test("delete shortcut is ⌘⌫ on macOS and Delete elsewhere, never during IME or with extra modifiers", () => {
  assert.equal(isDeleteShortcut(key({ metaKey: true }), "MacIntel"), true);
  assert.equal(isDeleteShortcut(key({}), "MacIntel"), false);
  assert.equal(isDeleteShortcut(key({ metaKey: true, shiftKey: true }), "MacIntel"), false);
  assert.equal(isDeleteShortcut(key({ metaKey: true, isComposing: true }), "MacIntel"), false);
  assert.equal(isDeleteShortcut(key({ metaKey: true, repeat: true }), "MacIntel"), false);
  assert.equal(isDeleteShortcut(key({ key: "Delete" }), "Win32"), true);
  assert.equal(isDeleteShortcut(key({ key: "Delete", ctrlKey: true }), "Win32"), false);
  assert.equal(isDeleteShortcut(key({ key: "Backspace" }), "Win32"), false);
});

const draft: Draft = {
  id: "d",
  title: "",
  body: "x",
  project: "",
  revision: 3,
  archived: false,
  createdAt: "2026-11-05T00:00:00.000Z",
  updatedAt: "2026-11-05T00:00:00.000Z",
};

test("draft delete copy says what goes and what stays", () => {
  const plain = draftDeleteCopy(draft, 0, false);
  assert.equal(plain.title, "删除《未命名稿件》？");
  assert.match(plain.lines.join(""), /全部 3 个历史版本/);
  assert.match(plain.lines.join(""), /在提示中立即撤销/);
  const published = draftDeleteCopy({ ...draft, title: "作品" }, 2, true);
  assert.match(published.lines[0], /2 条发布记录.*继续保留.*线上作品不受影响/);
  assert.ok(published.lines.some((line) => line.includes("发布准备")));
  assert.doesNotMatch(published.lines.join(""), /历史版本会从这台电脑上删除/);
});

const reading = (id: string, note = ""): Reading =>
  ({ id, url: `https://example.com/${id}`, title: id, note, read: false, createdAt: "", updatedAt: "" }) as Reading;

test("reading and record copy name notes, feedback and online state", () => {
  assert.equal(readingDeleteCopy(reading("a", "想法"), true).confirmLabel, "删除文章和笔记");
  assert.match(readingDeleteCopy(reading("a"), true).lines.join(""), /不会再次出现/);
  assert.doesNotMatch(readingDeleteCopy(reading("a"), false).lines.join(""), /订阅/);
  assert.match(recordDeleteCopy("作品", 2).lines[0], /2 条反馈记录.*不会删除线上作品/);
});

test("feed delete counts only its own articles and keeps noted ones by default", () => {
  const item = (feedId: string, readingId: string) => ({ feedId, key: readingId, readingId, title: "", url: "", summary: "", publishedAt: null });
  const library = {
    feeds: [],
    items: [item("f", "a"), item("f", "b"), item("f", "shared"), item("g", "shared")],
  } as unknown as Library;
  const counts = feedArticles(library, [reading("a", "笔记"), reading("b"), reading("shared")], "f");
  assert.deepEqual(counts, { articles: 2, noted: 1 });
  const keep = feedDeleteCopy("周刊", 2, 1, false);
  assert.match(keep.lines[0], /收录的 1 篇文章/);
  assert.match(keep.lines[1], /1 篇写过笔记的文章会保留/);
  assert.match(feedDeleteCopy("周刊", 2, 1, true).lines[0], /收录的 2 篇文章/);
  assert.equal(feedDeleteCopy("周刊", 1, 1, false).lines[0], "订阅会被删除，删除后无法撤销。");
});

test("records of a deleted draft still point to the published version", () => {
  const publication = { draftRevision: 4 } as Parameters<typeof versionStatus>[0];
  assert.match(versionStatus(publication, undefined, true), /原稿已删除.*版本 4/);
  assert.match(versionStatus(publication, undefined), /已不存在/);
});
