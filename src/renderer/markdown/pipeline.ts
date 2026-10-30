import type { Element, Root, RootContent } from "hast";
import GithubSlugger from "github-slugger";
import { defaultSchema } from "rehype-sanitize";

export const previewSchema = {
  ...defaultSchema,
  strip: [
    ...(defaultSchema.strip || []),
    "script",
    "style",
    "iframe",
    "object",
    "embed",
    "svg",
    "math",
    "form",
  ],
  attributes: {
    ...defaultSchema.attributes,
    code: [["className", /^language-./, "math-inline", "math-display"]],
  },
};

function elements(root: Root | Element, visit: (node: Element) => void) {
  for (const child of root.children) {
    if (child.type !== "element") continue;
    visit(child);
    elements(child, visit);
  }
}
const textContent = (node: RootContent): string =>
  node.type === "text"
    ? node.value
    : "children" in node
      ? node.children.map(textContent).join("")
      : "";

/** Namespace every anchor per preview so a dialog cannot jump into the editor underneath it. */
export function scopedAnchors({ prefix }: { prefix: string }) {
  return (tree: Root) => {
    const slugger = new GithubSlugger();
    const targets = new Map<string, string>();
    const used = new Set<string>();
    elements(tree, (node) => {
      const existing = String(node.properties.id || node.properties.name || "");
      const heading = /^h[1-6]$/.test(node.tagName);
      if (!existing && !heading) return;
      const original = existing || slugger.slug(textContent(node));
      let id = `${prefix}${original}`;
      let suffix = 1;
      while (used.has(id)) id = `${prefix}${original}-${suffix++}`;
      used.add(id);
      if (!targets.has(original)) targets.set(original, id);
      if (original.startsWith("user-content-")) {
        const alias = original.slice("user-content-".length);
        if (!targets.has(alias)) targets.set(alias, id);
      }
      node.properties.id = id;
      delete node.properties.name;
      node.properties.tabIndex = -1;
    });
    elements(tree, (node) => {
      const href = node.properties.href;
      if (typeof href === "string" && href.startsWith("#")) {
        try {
          const target = targets.get(decodeURIComponent(href.slice(1)));
          if (target) node.properties.href = `#${target}`;
        } catch {
          /* Malformed fragments stay inert in the click handler. */
        }
      }
      for (const property of ["ariaDescribedBy", "ariaLabelledBy"]) {
        const values = node.properties[property];
        if (Array.isArray(values))
          node.properties[property] = values.map(
            (value) => targets.get(String(value)) || value,
          );
      }
    });
  };
}

export function externalURL(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      value.length <= 2048
      ? url.href
      : null;
  } catch {
    return null;
  }
}
