import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "./api";
import { LocalImage } from "./LocalImage";

const components: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        if (href && /^https?:\/\//i.test(href)) void api.openExternal(href);
      }}
    >
      {children}
    </a>
  ),
  // Imported content cannot silently load remote tracking pixels or access local filesystem paths.
  img: ({ src, alt }) => (
    <LocalImage
      reference={typeof src === "string" ? src : undefined}
      alt={alt}
    />
  ),
};

export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={components}
      >
        {text || "正文还没有内容。"}
      </ReactMarkdown>
    </div>
  );
}
