import test from "node:test";
import assert from "node:assert/strict";
import { prepareJuejin } from "../src/renderer/publishing/juejin";

test("Juejin copy adjusts encoded, duplicate and reference headings without altering code or original", () => {
  const source =
    '[一](#%E4%B8%AD%E6%96%87) [二][ref]\n\n## 中文\n\n## 中文\n\n[ref]: #中文-1 "Title"\n\n```md\n[原样](#中文)\n## 中文\n```\n';
  const value = prepareJuejin(source);
  assert.equal(value.adjusted, 2);
  assert.match(value.body, /## <a id="cwb-heading-1"><\/a>中文/);
  assert.match(value.body, /\[ref\]: #user-content-cwb-heading-2 "Title"/);
  assert.match(value.body, /```md\n\[原样\]\(#中文\)\n## 中文\n```/);
  assert.doesNotMatch(source, /<a/);
});

test("setext and nested headings receive inline targets without creating paragraphs", () => {
  const value = prepareJuejin(
    "[A](#title) [B](#nested)\n\nTitle\n=====\n\n> ## Nested",
  );
  assert.equal(value.adjusted, 2);
  assert.match(value.body, /<a id="cwb-heading-1"><\/a>Title\n=====/);
  assert.match(value.body, /> ## <a id="cwb-heading-2"><\/a>Nested/);
});

test("missing anchors remain unchanged and report only relevant platform differences", () => {
  const value = prepareJuejin(
    "[Missing](#absent)\n\n![x][img]\n\n[img]: https://example.com/image.png\n\n```mermaid\ngraph LR\nA-->B\n```",
  );
  assert.equal(value.adjusted, 0);
  assert.equal(value.images, 1);
  assert.equal(value.differences.length, 2);
  assert.match(value.body, /\[Missing\]\(#absent\)/);
  assert.equal(prepareJuejin("plain").differences.length, 0);
});
