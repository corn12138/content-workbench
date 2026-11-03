import type { Element, Root } from "hast";
import { fromHtml } from "hast-util-from-html";
import { unified } from "unified";
import rehypeSanitize from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";
import {
  externalURL,
  previewSchema,
  scopedAnchors,
} from "../markdown/pipeline";

/** Feed-relative URLs belong to the source article, never to local assets or the application origin. */
export function feedHtml(value: string, baseURL: string, prefix: string): Root {
  if (value.length > 400_000 || !externalURL(baseURL))
    throw new Error("订阅内容不可预览");
  const article = new URL(baseURL);
  article.hash = "";
  const tree = fromHtml(value, { fragment: true });
  const queue: Array<{ node: Root | Element; depth: number }> = [
    { node: tree, depth: 0 },
  ];
  let count = 0;
  while (queue.length) {
    const { node, depth } = queue.pop()!;
    // Bound recursion before passing the tree to sanitizers and React's recursive visitors.
    if (++count > 10_000 || depth > 64) throw new Error("订阅排版过于复杂");
    for (const child of node.children) {
      if (child.type !== "element") continue;
      for (const key of ["href", "src"] as const) {
        const raw = child.properties[key];
        if (typeof raw !== "string") continue;
        if (key === "href" && raw.startsWith("#")) continue;
        let resolved: string | null = null;
        try {
          const target = new URL(raw, baseURL);
          const fragment = target.hash;
          target.hash = "";
          // Feeds often expand footnotes to absolute self-links; keep those jumps inside the reader.
          resolved =
            key === "href" && fragment && target.href === article.href
              ? fragment
              : externalURL(new URL(raw, baseURL).href);
        } catch {
          /* Invalid URLs remain inert. */
        }
        if (resolved) child.properties[key] = resolved;
        else delete child.properties[key];
      }
      queue.push({ node: child, depth: depth + 1 });
    }
  }
  return unified()
    .use(rehypeSanitize, previewSchema)
    .use(rehypeHighlight, { detect: false, ignoreMissing: true })
    .use(scopedAnchors, { prefix })
    .runSync(tree) as Root;
}
