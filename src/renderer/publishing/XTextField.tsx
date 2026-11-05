import { CircleAlert } from "lucide-react";
import { checkXText } from "./text";

/** Short-post editor shared by the web-assisted and API paths. */
export function XTextField({
  text,
  setText,
  readOnly,
  help,
}: {
  text: string;
  setText: (text: string) => void;
  readOnly?: boolean;
  help: string;
}) {
  const check = checkXText(text);
  return (
    <>
      <div className="field">
        <label className="field-label" htmlFor="x-post-text">
          短帖内容
        </label>
        <textarea
          id="x-post-text"
          className="input x-post-text"
          value={text}
          readOnly={readOnly}
          maxLength={10000}
          aria-describedby="x-post-count x-post-help"
          onChange={(e) => setText(e.target.value)}
        />
        <p id="x-post-count" className={check.length > 280 ? "x-count over" : "x-count"}>
          <span className="num">{check.length} / 280</span>
          <span>中文通常计 2，链接计 23</span>
        </p>
        <span className="field-help" id="x-post-help">
          {help}
        </span>
      </div>
      {check.localAsset && (
        <p className="field-error" role="alert">
          <CircleAlert size={13} aria-hidden="true" />
          请移除本机图片和文件路径后再发布。
        </p>
      )}
    </>
  );
}
