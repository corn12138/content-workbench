import { test } from "node:test";
import assert from "node:assert/strict";
import type { FeedItem, Reading } from "../src/shared/contracts";
import { contentState } from "../src/renderer/reading/contentKind";
import { groupReadings, publishedDates } from "../src/renderer/reading/orderReadings";
import { uncertainPublishError } from "../src/renderer/publishing/text";
import { validPublicationURL } from "../src/renderer/publishing/text";
import { layoutFor } from "../src/renderer/layout";
import { excerpt } from "../src/renderer/draftText";

const item = (content?: FeedItem["content"], summary = ""): FeedItem => ({
  feedId: "f",
  key: "k",
  readingId: "r",
  title: "t",
  url: "https://example.com/a",
  summary,
  content,
  publishedAt: null,
});

test("reader labels distinguish app truncation from summary-only sources", () => {
  assert.equal(contentState(undefined).kind, "link");
  assert.equal(contentState(item({ format: "html", kind: "body", value: "x", truncated: false })).label, "订阅正文");
  const cut = contentState(item({ format: "html", kind: "body", value: "x", truncated: true }));
  assert.equal(cut.label, "已截取");
  assert.match(cut.description, /工作台仅保留前段/);
  assert.doesNotMatch(cut.description, /来源仅提供/);
  const summary = contentState(item({ format: "text", kind: "summary", value: "x", truncated: false }));
  assert.equal(summary.label, "仅摘要");
  assert.match(summary.description, /来源仅提供摘要/);
  assert.equal(contentState(item(undefined, "旧文字")).kind, "legacy");
  assert.equal(contentState(item(undefined, "  ")).kind, "empty");
});

test("reading groups follow local calendar days without inventing dates", () => {
  const now = new Date(2026, 10, 3, 12);
  const reading = (id: string, updatedAt: string) =>
    ({ id, url: "", title: id, note: "", read: false, createdAt: updatedAt, updatedAt }) as Reading;
  const ordered = [
    reading("today", new Date(2026, 10, 3, 8).toISOString()),
    reading("yesterday", new Date(2026, 10, 2, 23).toISOString()),
    reading("week", new Date(2026, 9, 30).toISOString()),
    reading("older", new Date(2026, 8, 1).toISOString()),
    reading("unknown", "not a date"),
  ];
  const groups = groupReadings(ordered, publishedDates([]), now);
  assert.deepEqual(
    groups.map((group) => [group.label, group.items.map((r) => r.id)]),
    [
      ["今天", ["today"]],
      ["昨天", ["yesterday"]],
      ["近 7 天", ["week"]],
      ["9 月", ["older"]],
      ["日期未知", ["unknown"]],
    ],
  );
});

test("unknown X delivery is never treated as a plain failure", () => {
  // Messages produced by src-tauri/src/publishing for unknown outcomes.
  for (const message of [
    "上次请求的结果尚未确认，已阻止重复发送。请打开 X 个人主页核实；若已发布，可粘贴链接记录。",
    "X 未返回明确发布结果，请到个人主页核实；不要重复发送。",
    "发布操作中断，请先到 X 核实结果。",
  ])
    assert.ok(uncertainPublishError(message), message);
  assert.ok(!uncertainPublishError("请先连接 X 账号。"));
});

test("publication links are validated per platform", () => {
  assert.ok(validPublicationURL("juejin", "https://juejin.cn/post/7430000000000000001"));
  assert.ok(!validPublicationURL("juejin", "https://x.com/a/status/1"));
  assert.ok(validPublicationURL("x", " https://x.com/user_1/status/123 "));
  assert.ok(!validPublicationURL("x", "https://x.com/user/likes"));
});

test("layout breakpoints and list excerpts", () => {
  assert.equal(layoutFor(1440), "wide");
  assert.equal(layoutFor(1180), "standard");
  assert.equal(layoutFor(800), "compact");
  assert.equal(excerpt("# 标题\n\n```js\ncode\n```\n正文 **重点** 与 [链接](https://example.com)"), "正文 重点 与 链接");
  assert.equal(excerpt(""), "");
});
