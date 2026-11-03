import { useState } from "react";
import { CircleCheckBig, CircleAlert } from "lucide-react";
import type { Draft } from "../../shared/contracts";
import { api, errorMessage } from "../api";
import { validPublicationURL } from "./text";

const examples = {
  juejin: "https://juejin.cn/post/…",
  x: "https://x.com/用户名/status/…",
};

/** Manual provenance only: it records a link the user confirmed on the platform, never publishes. */
export function RecordLink({
  platform,
  draft,
  busy,
  primary,
  onBusy,
  onRecorded,
  onViewRecords,
}: {
  platform: "juejin" | "x";
  draft: Draft;
  busy: boolean;
  primary: boolean;
  onBusy: (busy: boolean) => void;
  onRecorded: () => Promise<void>;
  onViewRecords: () => void;
}) {
  const [url, setURL] = useState("");
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const id = `record-${platform}`;
  const record = async () => {
    if (recording) return;
    setError("");
    if (!validPublicationURL(platform, url)) {
      setError(
        platform === "juejin"
          ? "请粘贴掘金文章的完整链接，形如 https://juejin.cn/post/7430…"
          : "请粘贴 X 作品的完整链接，形如 https://x.com/用户名/status/…",
      );
      return;
    }
    setRecording(true);
    onBusy(true);
    try {
      await api.recordPublication(draft.id, draft.revision, url.trim());
      setRecorded(true);
      await onRecorded().catch(() => undefined);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setRecording(false);
      onBusy(false);
    }
  };
  if (recorded)
    return (
      <div className="notice success record-saved" role="status">
        <CircleCheckBig size={16} aria-hidden="true" />
        <div className="notice-body">
          <span className="notice-title">已保存到发布记录</span>
          <p>确认方式：人工确认。</p>
          <div className="notice-actions">
            <button type="button" className="button" onClick={onViewRecords}>
              查看发布记录
            </button>
          </div>
        </div>
      </div>
    );
  return (
    <div className="field record-link">
      <label className="field-label" htmlFor={id}>
        {platform === "juejin" ? "掘金文章链接" : "X 作品链接"}
      </label>
      <input
        id={id}
        className="input"
        aria-label="已发布的作品链接"
        aria-invalid={!!error}
        aria-describedby={`${id}-help`}
        value={url}
        disabled={recording}
        onChange={(e) => {
          setURL(e.target.value);
          setError("");
        }}
        placeholder={examples[platform]}
      />
      {error && (
        <p className="field-error" role="alert">
          <CircleAlert size={13} aria-hidden="true" />
          {error}
        </p>
      )}
      <span className="field-help" id={`${id}-help`}>
        只记录链接，不会代你发布或修改文章。
      </span>
      <div>
        <button
          type="button"
          className={primary ? "button primary" : "button"}
          disabled={!url.trim() || busy}
          aria-busy={recording}
          onClick={() => void record()}
        >
          {recording ? "记录中…" : "保存到发布记录"}
        </button>
      </div>
    </div>
  );
}
