import { test } from "node:test";
import assert from "node:assert/strict";
import type { Revision } from "../src/shared/contracts";
import { entrySummary, groupHistory } from "../src/renderer/historyGroups";

const at = (minute: number) => new Date(Date.UTC(2026, 10, 5, 3, minute)).toISOString();
const rev = (revision: number, minute: number, body: string, title = "标题"): Revision =>
  ({ revision, title, body, project: "", savedAt: at(minute) });

test("autosaves of one session collapse under their newest version; long pauses start a new one", () => {
  const items = [rev(1, 0, "", "未命名稿件"), rev(2, 1, "第一"), rev(3, 2, "第一段"), rev(4, 30, "第一段，后来补充")];
  const groups = groupHistory(items, 4, new Set());
  assert.deepEqual(
    groups.map((g) => [g.head.revision.revision, g.older.map((e) => e.revision.revision)]),
    [[4, []], [3, [2]]],
  );
  assert.equal(groups[1].startedAt, at(1));
  // The untouched empty version from 新建 is hidden; deltas still count against it.
  assert.equal(groups[1].older[0].delta, 2);
});

test("current and published versions are never hidden inside a session", () => {
  const items = [rev(1, 0, "a"), rev(2, 1, "ab"), rev(3, 2, "abc"), rev(4, 3, "abcd")];
  const groups = groupHistory(items, 4, new Set([2]));
  assert.deepEqual(
    groups.map((g) => [g.head.revision.revision, g.head.current, g.head.published, g.older.length]),
    [[4, true, false, 1], [2, false, true, 1]],
  );
});

test("an empty version stays visible when it is current or published", () => {
  const empty = rev(1, 0, "", "未命名稿件");
  assert.equal(groupHistory([empty], 1, new Set())[0].head.revision.revision, 1);
  assert.equal(groupHistory([empty, rev(2, 1, "x")], 2, new Set([1])).length, 2);
});

test("summaries show length and change", () => {
  const [head] = groupHistory([rev(1, 0, "abc"), rev(2, 1, "ab")], 2, new Set(), 0);
  assert.equal(entrySummary(head.head), "2 字符 · −1");
  const [same] = groupHistory([rev(1, 0, "ab"), rev(2, 1, "cd")], 2, new Set(), 0);
  assert.equal(entrySummary(same.head), "2 字符 · 字数不变");
  assert.equal(entrySummary(groupHistory([rev(1, 0, "abc")], 1, new Set())[0].head), "3 字符");
});
