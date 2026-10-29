import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { WorkbenchStore } from "../src/core/store";

function fixture(t: test.TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "workbench-core-"));
  let store = new WorkbenchStore(directory);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    directory,
    get store() {
      return store;
    },
    reopen() {
      store.close();
      store = new WorkbenchStore(directory);
      return store;
    },
  };
}

test("content and immutable revisions survive close and reopen", (t) => {
  const f = fixture(t);
  const first = f.store.saveDraft({
    title: "首篇文章",
    body: "# 内容",
    project: "",
  });
  const second = f.store.saveDraft({
    id: first.id,
    title: first.title,
    body: "新的正文",
    project: "编辑器",
    expectedRevision: 1,
  });
  assert.equal(second.revision, 2);
  const store = f.reopen();
  assert.deepEqual(store.snapshot().drafts, [second]);
  assert.equal(store.revisions(first.id)[1].body, "# 内容");
  const restored = store.restoreRevision(first.id, 1, 2);
  assert.equal(restored.revision, 3);
  assert.equal(restored.body, first.body);
  assert.equal(store.revisions(first.id)[1].body, second.body);
});

test("stale saves and stale restores do not overwrite newer text", (t) => {
  const { store } = fixture(t);
  const first = store.saveDraft({ title: "", body: "第一版", project: "" });
  const second = store.saveDraft({
    id: first.id,
    title: first.title,
    body: "第二版",
    project: "",
    expectedRevision: 1,
  });
  assert.throws(
    () =>
      store.saveDraft({
        id: first.id,
        title: "过期编辑",
        body: "旧内容",
        project: "",
        expectedRevision: 1,
      }),
    /稿件已发生变化/,
  );
  assert.throws(
    () =>
      store.saveDraft({ id: first.id, title: "无版本", body: "", project: "" }),
    /稿件已发生变化/,
  );
  assert.throws(() => store.restoreRevision(first.id, 1, 1), /稿件已发生变化/);
  assert.deepEqual(store.snapshot().drafts, [second]);
  assert.equal(store.revisions(first.id).length, 2);
});

test("same content import is deduplicated and archived content becomes visible again", (t) => {
  const { store } = fixture(t);
  const original = store.importMarkdown("notes.md", "# 我的技术文章\n\n正文");
  assert.equal(original.draft.title, "我的技术文章");
  store.archiveDraft(original.draft.id, true);
  const repeated = store.importMarkdown(
    "different-file.md",
    "# 我的技术文章\n\n正文",
  );
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.draft.id, original.draft.id);
  assert.equal(repeated.draft.archived, false);
  assert.equal(store.revisions(original.draft.id).length, 1);
  const changed = store.importMarkdown(
    "notes.md",
    "# 我的技术文章\n\n另一段正文",
  );
  assert.notEqual(changed.draft.id, original.draft.id);
});

test("import warns that image assets are not copied in this development batch", (t) => {
  const { store } = fixture(t);
  assert.equal(
    store.importMarkdown("image.md", "# 图\n![截图](./shot.png)").warnings
      .length,
    1,
  );
  assert.equal(
    store.importMarkdown("html.md", '<img src="./shot.png">').warnings.length,
    1,
  );
  assert.equal(store.importMarkdown("plain.md", "# 纯文字").warnings.length, 0);
});

test("saving unchanged text does not create a redundant history entry", (t) => {
  const { store } = fixture(t);
  const draft = store.saveDraft({
    title: "文章",
    body: "同样的正文",
    project: "",
  });
  const saved = store.saveDraft({
    id: draft.id,
    title: draft.title,
    body: draft.body,
    project: "",
    expectedRevision: 1,
  });
  assert.deepEqual(saved, draft);
  assert.equal(store.revisions(draft.id).length, 1);
});

test("manual publications preserve the actual selected revision and stable platform identity", (t) => {
  const { store } = fixture(t);
  const first = store.saveDraft({
    title: "发布前标题",
    body: "最初文章",
    project: "",
  });
  store.saveDraft({
    id: first.id,
    title: "修改后标题",
    body: "后续文章",
    project: "",
    expectedRevision: 1,
  });
  const publication = store.recordPublication(
    first.id,
    1,
    "https://juejin.cn/post/123456?utm_source=test#comment",
  );
  assert.equal(publication.title, first.title);
  assert.equal(publication.draftRevision, 1);
  assert.equal(publication.confirmation, "manual");
  assert.equal(publication.url, "https://juejin.cn/post/123456");
  assert.deepEqual(
    store.recordPublication(first.id, 1, "https://juejin.cn/post/123456/"),
    publication,
  );
  assert.throws(
    () => store.recordPublication(first.id, 2, "https://juejin.cn/post/123456"),
    /已关联/,
  );
  const x = store.recordPublication(
    first.id,
    1,
    "https://x.com/first/status/9876",
  );
  assert.equal(
    store.recordPublication(first.id, 1, "https://x.com/renamed/status/9876")
      .id,
    x.id,
  );
  assert.throws(
    () => store.recordPublication(first.id, 99, "https://x.com/test/status/12"),
    /版本/,
  );
});

test("publication links reject lookalike hosts, credentials, insecure URLs and non-post pages", (t) => {
  const { store } = fixture(t);
  const draft = store.saveDraft({ title: "文章", body: "内容", project: "" });
  for (const url of [
    "https://juejin.cn.evil.example/post/123",
    "https://user:pw@juejin.cn/post/123",
    "http://juejin.cn/post/123",
    "https://juejin.cn/editor/drafts/new",
    "https://x.com/home",
    "https://juejin.cn:123/post/123",
    "javascript:alert(1)",
  ])
    assert.throws(() => store.recordPublication(draft.id, 1, url));
  assert.equal(store.snapshot().publications.length, 0);
});

test("bookmark duplicates preserve existing notes and reading status", (t) => {
  const { store } = fixture(t);
  const reading = store.saveReading({
    url: "https://Example.COM:443/docs?q=a#section",
    title: "参考",
    note: "保留这条结论",
    read: true,
  });
  const duplicate = store.saveReading({
    url: "https://example.com/docs?q=a#section",
    title: "",
    note: "",
    read: false,
  });
  assert.deepEqual(duplicate, reading);
  assert.equal(store.snapshot().readings.length, 1);
  assert.throws(() =>
    store.saveReading({
      url: "file:///etc/passwd",
      title: "",
      note: "",
      read: false,
    }),
  );
});

test("reading notes become an attributed draft without duplicating repeated conversion", (t) => {
  const { store } = fixture(t);
  const reading = store.saveReading({
    url: "https://example.com/article",
    title: "阅读笔记",
    note: "这个实验值得尝试。",
    read: true,
  });
  const draft = store.readingToDraft(reading.id);
  assert.match(draft.body, /这个实验值得尝试/);
  assert.match(draft.body, /来源：https:\/\/example.com\/article/);
  assert.equal(store.readingToDraft(reading.id).id, draft.id);
  const empty = store.saveReading({
    url: "https://example.com/empty",
    title: "",
    note: "",
    read: false,
  });
  assert.throws(() => store.readingToDraft(empty.id), /先写下一条收获/);
});

test("backup roundtrip preserves archived drafts, history, publication references and notes", (t) => {
  const f = fixture(t);
  const draft = f.store.saveDraft({
    title: "保留文章",
    body: "原文",
    project: "",
  });
  f.store.saveDraft({
    id: draft.id,
    title: draft.title,
    body: "新版",
    project: "",
    expectedRevision: 1,
  });
  f.store.recordPublication(draft.id, 1, "https://juejin.cn/post/778899");
  f.store.archiveDraft(draft.id, true);
  f.store.saveReading({
    url: "https://example.com/",
    title: "资料",
    note: "笔记",
    read: false,
  });
  const snapshot = f.store.snapshot();
  const backup = f.store.exportBackup();
  f.store.saveDraft({
    title: "恢复前新增",
    body: "需要被恢复前副本保护",
    project: "",
  });
  f.store.restoreBackup(backup);
  assert.deepEqual(f.store.snapshot(), snapshot);
  assert.equal(f.store.revisions(draft.id).length, 2);
  const recovery = readdirSync(f.directory).find((name) =>
    name.startsWith("before-restore-"),
  );
  assert.ok(recovery);
  assert.equal(
    JSON.parse(readFileSync(join(f.directory, recovery), "utf8")).drafts.length,
    2,
  );
  assert.deepEqual(f.reopen().snapshot(), snapshot);
});

test("malformed, unsupported and relationally corrupt backups leave current data intact", (t) => {
  const f = fixture(t);
  const draft = f.store.saveDraft({
    title: "不能丢失",
    body: "重要内容",
    project: "",
  });
  f.store.recordPublication(draft.id, 1, "https://x.com/test/status/12345");
  const before = f.store.snapshot();
  const baseline = f.store.exportBackup();
  const variants: unknown[] = [
    { ...JSON.parse(baseline), version: 2 },
    { ...JSON.parse(baseline), revisions: [] },
    { ...JSON.parse(baseline), drafts: [] },
    { ...JSON.parse(baseline), credentials: { token: "unsupported-secret" } },
  ];
  const duplicate = JSON.parse(baseline);
  duplicate.revisions.push(duplicate.revisions[0]);
  variants.push(duplicate);
  const wrongTitle = JSON.parse(baseline);
  wrongTitle.publications[0].title = "不属于对应版本";
  variants.push(wrongTitle);
  for (const input of [
    "{",
    ...variants.map((value) => JSON.stringify(value)),
  ]) {
    assert.throws(() => f.store.restoreBackup(input));
    assert.deepEqual(f.store.snapshot(), before);
  }
  assert.equal(
    readdirSync(f.directory).filter((name) =>
      name.startsWith("before-restore-"),
    ).length,
    0,
  );
});

test("a write failure during restore rolls back deletions and preserves the recovery copy", (t) => {
  const f = fixture(t);
  f.store.saveDraft({ title: "原始资料", body: "不能丢失", project: "" });
  const backup = f.store.exportBackup();
  f.store.saveDraft({ title: "恢复前新增", body: "也应保留", project: "" });
  const before = f.store.snapshot();
  // Inject a storage failure after restore starts deleting rows, exercising actual transaction rollback.
  const connection = new DatabaseSync(join(f.directory, "workbench.sqlite"));
  connection.exec(
    "CREATE TRIGGER fail_restore BEFORE INSERT ON drafts BEGIN SELECT RAISE(ABORT, 'storage failure'); END;",
  );
  connection.close();
  assert.throws(() => f.store.restoreBackup(backup), /storage failure/);
  assert.deepEqual(f.store.snapshot(), before);
  assert.equal(
    readdirSync(f.directory).filter((name) =>
      name.startsWith("before-restore-"),
    ).length,
    1,
  );
});
