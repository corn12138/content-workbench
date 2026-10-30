import { memo, useId, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import { api, errorMessage } from "../api";
import { LocalImage } from "../LocalImage";
import { CodeBlock } from "./CodeBlock";
import { externalURL, previewSchema, scopedAnchors } from "./pipeline";

export const MarkdownContent = memo(function MarkdownContent({
  text,
}: {
  text: string;
}) {
  const scope = useId();
  const prefix = `md-${scope.replace(/[^a-zA-Z0-9_-]/g, "")}-`;
  const root = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const components = useMemo<Components>(
    () => ({
      a: ({ href, children, node: _node, ...props }) => {
        if (!href && props.id) return <span {...props}>{children}</span>;
        const external = externalURL(href);
        const fragment = href?.startsWith("#");
        if (!external && !fragment)
          return (
            <span
              {...props}
              className="md-disabled-link"
              title="此链接不是可打开的网页或页内锚点"
            >
              {children}
            </span>
          );
        return (
          <a
            {...props}
            href={external || href}
            onClick={(event) => {
              event.preventDefault();
              setError("");
              if (fragment && href) {
                let id: string;
                try {
                  id = decodeURIComponent(href.slice(1));
                } catch {
                  setError("页内链接格式不正确。");
                  return;
                }
                const target = [
                  ...(root.current?.querySelectorAll<HTMLElement>("[id]") ||
                    []),
                ].find((node) => node.id === id);
                if (!target) {
                  setError("未找到页内链接对应的标题，请检查原文。");
                  return;
                }
                target.focus({ preventScroll: true });
                target.scrollIntoView({ block: "start" });
              } else if (external)
                void api
                  .openExternal(external)
                  .catch((error) => setError(errorMessage(error)));
            }}
          >
            {children}
          </a>
        );
      },
      img: ({ src, alt, title }) => (
        <LocalImage
          reference={typeof src === "string" ? src : undefined}
          alt={alt}
          title={title}
        />
      ),
      pre: CodeBlock,
      table: ({ node: _node, ...props }) => (
        <div
          className="md-table-scroll"
          role="region"
          aria-label="表格，可横向滚动"
          tabIndex={0}
        >
          <table {...props} />
        </div>
      ),
    }),
    [],
  );
  return (
    <div className="markdown" ref={root}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        remarkRehypeOptions={{
          footnoteLabel: "注释",
          footnoteBackLabel: "返回正文",
        }}
        rehypePlugins={[
          rehypeRaw,
          // Sanitize untrusted HTML first; later plugins only generate trusted highlight/math markup.
          [rehypeSanitize, previewSchema],
          [rehypeHighlight, { detect: false, ignoreMissing: true }],
          [
            rehypeKatex,
            { trust: false, strict: "warn", maxExpand: 1000, maxSize: 20 },
          ],
          [scopedAnchors, { prefix }],
        ]}
        components={components}
      >
        {text.trim() ? text : "正文还没有内容。"}
      </ReactMarkdown>
      {error && (
        <p className="md-link-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
});
