import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The preview receives only this explicit API fixture; rendering must not fetch remote resources.
Object.defineProperty(globalThis, "window", {
  value: {
    workbench: { openExternal: async () => {}, copyText: async () => {} },
  },
  configurable: true,
});
const { MarkdownContent } =
  await import("../src/renderer/markdown/MarkdownContent");
const render = (text: string) =>
  renderToStaticMarkup(createElement(MarkdownContent, { text }));

test("CommonMark/GFM preserves headings, nested lists, alignment, hard breaks and escaped text", () => {
  const html = render(
    "# 标题\n\n## 子标题\n\n### 三级\n\n#### 四级\n\n##### 五级\n\n###### 六级\n\n3. three\n   - nested\n\n- [x] done\n- [ ] todo\n\n| L | C | R |\n|:--|:-:|--:|\n| **bold** | ~~old~~ | `x` |\n\nfirst  \nsecond\n\n\\*literal\\*\n\n> quoted",
  );
  for (const tag of [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "table",
    "blockquote",
    "strong",
    "del",
    "br",
  ])
    assert.match(html, new RegExp(`<${tag}\\b`));
  assert.match(html, /<ol start="3">/);
  assert.match(html, /type="checkbox" disabled="" checked=""/);
  assert.match(html, /text-align:right/);
  assert.match(html, /\*literal\*/);
});

test("code highlighting preserves whitespace, unknown language and literal HTML", () => {
  const html = render(
    '```typescript\nconst value = "中文";\n  console.log(value);\n```\n\n```unlisted-language\n<tag> & x\n```\n\n```mermaid\ngraph LR\nA --> B\n```',
  );
  assert.match(html, /hljs-keyword/);
  assert.match(html.replace(/<[^>]*>/g, ""), /  console/);
  assert.match(html, /&lt;tag&gt; &amp; x/);
  assert.match(html, /图表语法，当前显示源码/);
});

test("sanitized HTML keeps details and formatting without active content or remote image loading", () => {
  const html = render(
    '<details open><summary>展开</summary><p>HTML <strong>正文</strong><br>换行</p></details>\n\n<script>secret()</script><style>body{display:none}</style><iframe src="https://example.com"></iframe><form>hidden</form>\n\n<img src="https://example.com/tracker.png" onerror="alert(1)">\n\n<a href="javascript:alert(1)" onclick="alert(1)">evil</a>',
  );
  assert.match(html, /<details open="">/);
  assert.match(html, /<strong>正文<\/strong>/);
  assert.doesNotMatch(
    html,
    /<script|<style|<iframe|<form|onerror=|onclick=|src="https:|javascript:|secret\(\)/,
  );
  assert.match(html, /尚未保存在本机/);
});

test("headings and footnotes have resolvable scoped anchors including encoded Chinese fragments", () => {
  const html = render(
    '[目录](#%E4%B8%AD%E6%96%87)\n\n# 中文\n\n## 中文\n\n脚注[^one]\n\n[^one]: Footnote\n\n<a id="custom"></a>\n\n[custom](#custom)',
  );
  const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
  const refs = [...html.matchAll(/ href="#([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 4);
  for (const ref of refs) assert.ok(ids.has(ref), `missing ${ref}`);
  assert.equal(ids.size, [...html.matchAll(/ id="/g)].length);
  assert.match(html, /中文-1/);
  const pair = renderToStaticMarkup(
    createElement(
      "div",
      {},
      createElement(MarkdownContent, { text: "# Same" }),
      createElement(MarkdownContent, { text: "# Same" }),
    ),
  );
  const pairIds = [...pair.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(pairIds).size, 2);
});

test("inline and block formulas render with trust disabled; malformed TeX remains visible", () => {
  const html = render(
    "Inline $E=mc^2$.\n\n$$\n\\frac{a}{b} + \\sqrt{x}\n$$\n\n$\\frac{a$\n\n$\\href{javascript:alert(1)}{click}$",
  );
  assert.match(html, /class="katex"/);
  assert.match(html, /katex-display/);
  assert.match(html, /katex-error/);
  assert.doesNotMatch(html, /href="javascript:/);
});

test("blank input has an empty state and unsafe or relative URLs cannot navigate the app", () => {
  assert.match(render("  \n "), /正文还没有内容/);
  const html = render(
    "[file](file:///etc/passwd) [relative](./other.md) [credentials](https://name:pass@example.com) [web](https://example.com)",
  );
  assert.doesNotMatch(html, /href="file:|href="\.\/|href="https:\/\/name/);
  assert.match(html, /href="https:\/\/example.com\//);
});
