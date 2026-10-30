import { useState, type ComponentProps } from "react";
import type { ExtraProps } from "react-markdown";
import { MermaidPreview } from "./MermaidPreview";
import { api, errorMessage } from "../api";

export function CodeBlock({
  children,
  node,
  ...props
}: ComponentProps<"pre"> & ExtraProps) {
  const [message, setMessage] = useState("");
  const code = node?.children.find(
    (child) => child.type === "element" && child.tagName === "code",
  );
  const language =
    code?.type === "element"
      ? code.properties.className?.toString().match(/language-([^,\s]+)/)?.[1]
      : undefined;
  const sourceText = (value: typeof node): string =>
    value?.children
      .map((child) =>
        child.type === "text"
          ? child.value
          : child.type === "element"
            ? sourceText(child)
            : "",
      )
      .join("") || "";
  const source = sourceText(node);
  return (
    <figure className="md-code-block">
      <figcaption>
        <span>
          {language || "代码"}
          {language === "mermaid" ? " · 图表与源码" : ""}
        </span>
        <span role="status">{message}</span>
        <button
          type="button"
          onClick={(event) => {
            // textContent preserves source whitespace even after syntax highlighting adds spans.
            const text =
              event.currentTarget.closest("figure")?.querySelector("pre")
                ?.textContent || "";
            void api
              .copyText(text.replace(/\n$/, ""))
              .then(() => setMessage("已复制"))
              .catch((error) => setMessage(errorMessage(error)));
          }}
        >
          复制代码
        </button>
      </figcaption>
      {language === "mermaid" ? (
        <>
          <MermaidPreview source={source} />
          <details className="mermaid-source">
            <summary>查看图表源码</summary>
            <pre {...props} tabIndex={0}>
              {children}
            </pre>
          </details>
        </>
      ) : (
        <pre {...props} tabIndex={0}>
          {children}
        </pre>
      )}
    </figure>
  );
}
