import { test } from "node:test";
import assert from "node:assert/strict";
import type { Draft, Preparation, PreparedImage, Publication, Reading } from "../src/shared/contracts";
import { shortcutFor } from "../src/renderer/shortcuts";
import { exportOutcome } from "../src/renderer/exportOutcome";
import { imageSummary } from "../src/renderer/publishing/imageResults";
import { xIntentURL, X_INTENT } from "../src/renderer/publishing/xWeb";
import { initialLocal, isStale } from "../src/renderer/publishing/preparationState";
import { nextReading } from "../src/renderer/reading/readingNav";
import { loadPosition, offsetFor, positionWriter, savePosition } from "../src/renderer/reading/readingPosition";
import { opmlCounts, opmlLabel } from "../src/renderer/reading/opml";
import {
  feedbackFor,
  formatMetric,
  parseMetrics,
  searchPublications,
  versionStatus,
} from "../src/renderer/records/feedback";
import { backupSummaryLines, formatBytes } from "../src/renderer/backupText";

const key = (overrides: Partial<KeyboardEvent>) =>
  ({
    key: "n",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    keyCode: 78,
    repeat: false,
    ...overrides,
  }) as KeyboardEvent;

test("A5: shortcuts use ⌘ on macOS, Ctrl elsewhere, and never fire during IME composition", () => {
  assert.equal(shortcutFor(key({ metaKey: true }), "MacIntel"), "newDraft");
  assert.equal(shortcutFor(key({ ctrlKey: true }), "MacIntel"), null);
  assert.equal(shortcutFor(key({ ctrlKey: true }), "Win32"), "newDraft");
  assert.equal(shortcutFor(key({ metaKey: true }), "Win32"), null);
  assert.equal(shortcutFor(key({ metaKey: true, key: "o" }), "MacIntel"), "importDraft");
  assert.equal(shortcutFor(key({ metaKey: true, key: "E" }), "MacIntel"), "togglePreview");
  assert.equal(shortcutFor(key({ metaKey: true, isComposing: true }), "MacIntel"), null);
  assert.equal(shortcutFor(key({ metaKey: true, keyCode: 229 }), "MacIntel"), null);
  assert.equal(shortcutFor(key({ metaKey: true, shiftKey: true }), "MacIntel"), null);
  assert.equal(shortcutFor(key({ metaKey: true, repeat: true }), "MacIntel"), null);
  assert.equal(shortcutFor(key({ metaKey: true, key: "s" }), "MacIntel"), null);
});

test("A2/A3: export receipts never imply the database save succeeded", () => {
  const failed = exportOutcome({ filename: "稿.zip", bundled: true, images: 2, missing: 1, remote: 3 }, true);
  assert.match(failed, /稿\.zip（含 2 张图片）/);
  assert.match(failed, /1 处图片在资料库中找不到/);
  assert.match(failed, /3 张外链图片保留为链接/);
  assert.match(failed, /仍未保存到本机/);
  const ok = exportOutcome({ filename: "a.md", bundled: false, images: 0, missing: 0, remote: 0 }, false);
  assert.equal(ok, "已另存为 a.md。");
});

const draft = (revision: number, body = "正文"): Draft => ({
  id: "00000000-0000-4000-8000-000000000001",
  title: "标题",
  body,
  project: "",
  revision,
  archived: false,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
});
const prep = (overrides: Partial<Preparation>): Preparation => ({
  draftId: draft(1).id,
  platform: "x",
  revision: 1,
  contentHash: "h",
  xText: "我改过的短帖",
  xMode: "web",
  pendingUrl: "",
  images: [],
  imagesRevision: null,
  updatedAt: "2026-11-01T00:00:00.000Z",
  ...overrides,
});

test("B1/B2: saved preparation is restored and becomes stale when the draft changed", () => {
  const restored = initialLocal(draft(3), [prep({ revision: 2 }), prep({ platform: "juejin", xText: null, pendingUrl: "https://juejin.cn/post/1", revision: 3 })]);
  assert.equal(restored.x.xText, "我改过的短帖");
  assert.equal(restored.x.xMode, "web");
  assert.equal(isStale(restored.x, draft(3)), true, "X text checked against revision 2");
  assert.equal(isStale(restored.juejin, draft(3)), false);
  assert.equal(restored.juejin.pendingUrl, "https://juejin.cn/post/1");
  const fresh = initialLocal(draft(1, "短"), []);
  assert.equal(fresh.x.touched, false);
  assert.equal(isStale(fresh.x, draft(5)), false, "untouched platforms are never stale or persisted");
  assert.equal(fresh.x.xText, "标题\n\n短");
});

test("B3: image summary separates local preparation from upload and rejects old revisions", () => {
  const image = (position: number, status: PreparedImage["status"]): PreparedImage => ({
    position,
    source: "example.com/a.png",
    filename: status === "ready" ? `0${position}-图片.png` : null,
    status,
    error: status === "failed" ? "网络错误" : null,
  });
  const partial = imageSummary([image(1, "ready"), image(2, "failed")], 4, 4);
  assert.deepEqual([partial.ready, partial.failed, partial.allReady, partial.stale], [1, 1, false, false]);
  assert.match(partial.text, /只重试失败的图片/);
  const stale = imageSummary([image(1, "ready")], 3, 4);
  assert.equal(stale.stale, true);
  assert.equal(stale.allReady, false);
  assert.match(stale.text, /版本 3/);
  assert.match(imageSummary([image(1, "ready")], 4, 4).text, /本地准备好/);
  assert.match(imageSummary([image(1, "failed")], 4, 4).text, /没有可用图片/);
});

test("B5: X web intent uses the documented endpoint and refuses over-long prefill", () => {
  assert.equal(X_INTENT, "https://x.com/intent/tweet");
  assert.equal(xIntentURL(" 你好 #tag "), "https://x.com/intent/tweet?text=%E4%BD%A0%E5%A5%BD%20%23tag");
  assert.equal(xIntentURL("长".repeat(400)), null);
});

const reading = (id: string, read = false, note = ""): Reading => ({
  id,
  url: `https://example.com/${id}`,
  title: id,
  note,
  read,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
});

test("C3: next article stays inside the filter and continues from the current position", () => {
  const ordered = ["a", "b", "c", "d", "e"].map((id) => reading(id, id === "c"));
  const unreadVisible = ordered.filter((item) => !item.read);
  assert.equal(nextReading(ordered, ordered, "a", false)?.id, "b");
  assert.equal(nextReading(ordered, ordered, "b", true)?.id, "d", "next unread skips read articles");
  // "b" was just marked read and left the unread filter: continue after its position, not from the top.
  const afterRead = unreadVisible.filter((item) => item.id !== "b");
  assert.equal(nextReading(ordered, afterRead, "b", false)?.id, "d");
  assert.equal(nextReading(ordered, ordered, "e", false), null);
  const filtered = [ordered[0], ordered[4]];
  assert.equal(nextReading(ordered, filtered, "a", false)?.id, "e", "never leaves the filtered results");
  assert.equal(nextReading(ordered, ordered, undefined, false)?.id, "a");
});

test("C2: reading position is bounded, throttled and tolerant of damaged storage", () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  savePosition({ id: "r1", ratio: 0.42345 }, storage);
  assert.deepEqual(loadPosition(storage), { id: "r1", ratio: 0.423 });
  store.set("workbench-reading-position", JSON.stringify({ id: "r1", ratio: 7 }));
  assert.equal(loadPosition(storage)?.ratio, 1);
  store.set("workbench-reading-position", "{broken");
  assert.equal(loadPosition(storage), null);
  assert.equal(offsetFor(0.5, 2000, 1000), 500);
  assert.equal(offsetFor(0.9, 900, 1000), 0, "content shorter than the viewport");
  const writes: number[] = [];
  const writer = positionWriter((p) => writes.push(p.ratio), 10_000);
  writer.update({ id: "r", ratio: 0.1 });
  writer.update({ id: "r", ratio: 0.2 });
  writer.update({ id: "r", ratio: 0.3 });
  writer.flush();
  writer.update({ id: "r", ratio: 0.305 });
  writer.flush();
  assert.deepEqual(writes, [0.3], "one write per burst, no write for negligible changes");
});

test("C1: OPML preview labels and counts", () => {
  const entries = [
    { url: "a", title: "", status: "new", reason: null },
    { url: "b", title: "", status: "resubscribe", reason: "曾取消订阅" },
    { url: "c", title: "", status: "duplicate", reason: "已经订阅" },
    { url: "d", title: "", status: "blocked", reason: "x" },
    { url: "e", title: "", status: "overLimit", reason: "x" },
  ] as const;
  assert.deepEqual(opmlCounts([...entries]), { addable: 2, duplicate: 1, skipped: 2 });
  assert.equal(opmlLabel(entries[2]), "已经订阅");
  assert.equal(opmlLabel(entries[3]), "本机或内网地址");
});

const publication = (overrides: Partial<Publication>): Publication => ({
  id: "p1",
  draftId: draft(1).id,
  draftRevision: 2,
  title: "部署记录",
  platform: "juejin",
  url: "https://juejin.cn/post/1",
  confirmedAt: "2026-11-01T00:00:00.000Z",
  confirmation: "manual",
  ...overrides,
});

test("D3: manual feedback keeps unknown and zero apart and uses platform fields", () => {
  const parsed = parseMetrics("juejin", { views: "0", likes: "", comments: "1,024" });
  assert.ok("metrics" in parsed);
  assert.deepEqual(parsed.metrics, { views: 0, likes: null, comments: 1024, collects: null });
  assert.ok("error" in parseMetrics("juejin", { views: "-1" }));
  assert.ok("error" in parseMetrics("x", { impressions: "1.5" }));
  const x = parseMetrics("x", { impressions: "12" });
  assert.ok("metrics" in x && "impressions" in x.metrics && !("views" in x.metrics), "X impressions are not Juejin views");
  assert.equal(formatMetric(null), "未知");
  assert.equal(formatMetric(0), "0");
  assert.equal(formatMetric(undefined), "未知");
});

test("D1: search, version tracing and feedback ordering", () => {
  const items = [
    publication({ id: "1", title: "Rust 记录", confirmedAt: "2026-11-01T00:00:00.000Z" }),
    publication({ id: "2", title: "其他", platform: "x", url: "https://x.com/a/status/9", confirmedAt: "2026-11-03T00:00:00.000Z" }),
  ];
  assert.deepEqual(searchPublications(items, "all", "").map((p) => p.id), ["2", "1"]);
  assert.deepEqual(searchPublications(items, "all", "rust").map((p) => p.id), ["1"]);
  assert.deepEqual(searchPublications(items, "all", "status/9").map((p) => p.id), ["2"]);
  assert.deepEqual(searchPublications(items, "juejin", "其他"), []);
  assert.match(versionStatus(items[0], { revision: 2, archived: false }), /没有修改/);
  assert.match(versionStatus(items[0], { revision: 5, archived: true }), /版本 5（发布后有修改），稿件已归档/);
  assert.match(versionStatus(items[0], undefined), /已不存在/);
  const fb = (id: string, observedAt: string) => ({ id, publicationId: "1", platform: "juejin" as const, source: "manual" as const, observedAt, metrics: {}, note: "", createdAt: observedAt });
  assert.deepEqual(feedbackFor([fb("a", "2026-11-01T00:00:00Z"), fb("b", "2026-11-02T00:00:00Z"), { ...fb("c", "2026-11-03T00:00:00Z"), publicationId: "2" }], "1").map((f) => f.id), ["b", "a"]);
});

test("E2: restore preview lists what will be replaced, omitting empty categories", () => {
  const lines = backupSummaryLines({
    format: "完整备份",
    exportedAt: "2026-11-01T00:00:00.000Z",
    drafts: 3,
    archivedDrafts: 1,
    revisions: 9,
    publications: 0,
    readings: 4,
    notes: 2,
    feeds: 1,
    feedItems: 10,
    images: 0,
    preparations: 1,
    compositions: 0,
    feedback: 5,
  });
  assert.ok(lines.some((l) => l.includes("稿件 3 篇（含已归档 1 篇），历史版本 9 个")));
  assert.ok(lines.some((l) => l.includes("反馈记录 5 条")));
  assert.ok(!lines.some((l) => l.includes("图片")));
  assert.equal(formatBytes(1536), "1.5 KB");
});
