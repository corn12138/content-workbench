import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { toString } from "mdast-util-to-string";
import type { Nodes } from "mdast";
import GithubSlugger from "github-slugger";

export function prepareJuejin(markdown: string) {
  const tree = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .parse(markdown);
  const slugger = new GithubSlugger();
  const headings = new Map<string, { offset: number; anchor: string }>();
  const changes: { start: number; end: number; value: string }[] = [];
  let prefix = "cwb-heading-";
  while (markdown.includes(prefix)) prefix = `cwb-${prefix}`;
  let count = 0;
  let images = 0;
  const differences = new Set<string>();
  const walk = (node: Nodes, visit: (node: Nodes) => void) => {
    visit(node);
    if ("children" in node)
      node.children.forEach((child) => walk(child, visit));
  };
  walk(tree, (node) => {
    if (node.type === "heading") {
      const slug = slugger.slug(
        toString(node, { includeHtml: false, includeImageAlt: false }),
      );
      const offset = node.children[0]?.position?.start.offset;
      // Inline targets add no paragraph spacing and also work inside lists and quotes.
      if (offset !== undefined)
        headings.set(slug, { offset, anchor: `${prefix}${++count}` });
    }
    if (node.type === "image" || node.type === "imageReference") images++;
    if (node.type === "html" && /<img\b/i.test(node.value)) {
      images++;
      differences.add("HTML 图片需在掘金手动核对，建议改用 Markdown 图片。");
    }
    if (node.type === "code")
      differences.add("代码高亮、行号及图表样式由掘金主题决定。");
    if (node.type === "footnoteReference")
      differences.add("掘金编辑器的脚注回跳可能失效，请在发布页复核。");
    if (node.type === "math" || node.type === "inlineMath")
      differences.add("公式的字体和排版可能受平台版本影响，请核对掘金预览。");
  });
  const inserted = new Set<string>();
  let adjusted = 0;
  walk(tree, (node) => {
    if (
      (node.type !== "link" && node.type !== "definition") ||
      !node.url.startsWith("#")
    )
      return;
    let slug: string;
    try {
      slug = decodeURIComponent(node.url.slice(1));
    } catch {
      return;
    }
    const heading = headings.get(slug);
    if (!heading) {
      differences.add("有自定义或未匹配的目录链接，请在掘金检查跳转。");
      return;
    }
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    const source = markdown.slice(start, end);
    const marker = node.type === "definition" ? /\]:\s*<?#/ : /\]\(\s*<?#/;
    const match = marker.exec(source);
    if (!match) return;
    const offset = start + match.index + match[0].length - 1;
    const destination = markdown.slice(offset, end).match(/^#[^\s)>]*/)?.[0];
    if (!destination) return;
    // Juejin's sanitizer prefixes raw HTML ids, but leaves link fragments unchanged.
    changes.push({
      start: offset,
      end: offset + destination.length,
      value: `#user-content-${heading.anchor}`,
    });
    if (!inserted.has(heading.anchor)) {
      inserted.add(heading.anchor);
      changes.push({
        start: heading.offset,
        end: heading.offset,
        value: `<a id="${heading.anchor}"></a>`,
      });
    }
    adjusted++;
  });
  let body = markdown;
  for (const change of changes.sort((a, b) => b.start - a.start))
    body = body.slice(0, change.start) + change.value + body.slice(change.end);
  return { body, images, adjusted, differences: [...differences] };
}
