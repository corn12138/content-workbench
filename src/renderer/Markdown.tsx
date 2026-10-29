import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "./api";

export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(event) => {
                event.preventDefault();
                if (href && /^https?:\/\//i.test(href))
                  void api.openExternal(href);
              }}
            >
              {children}
            </a>
          ),
          // Imported content cannot silently load remote tracking pixels or access local filesystem paths.
          img: ({ alt }) => (
            <span className="image-placeholder">
              图片：{alt || "未命名"}（资源导入待接入）
            </span>
          ),
        }}
      >
        {text || "正文还没有内容。"}
      </ReactMarkdown>
    </div>
  );
}
