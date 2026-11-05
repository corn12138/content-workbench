import { useRef, useState } from "react";
import { Check, FolderOpen, ImageDown, LoaderCircle, TriangleAlert } from "lucide-react";
import type { Draft, PreparedImage } from "../../shared/contracts";
import { api, errorMessage } from "../api";
import { imageSummary } from "./imageResults";

export type ImageState = "idle" | "preparing" | "ready" | "attention" | "failed";

/**
 * Local image preparation for Juejin: downloads remote images into the draft and writes numbered
 * upload copies. "已准备" means a local copy exists; uploading to Juejin is still done by the user.
 * Running it again reuses stored images and only retries the failed ones.
 */
export function JuejinImages({
  draft,
  count,
  busy,
  onBusy,
  onPrepared,
  onState,
  saved,
}: {
  draft: Draft;
  count: number;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onPrepared: (draft: Draft) => void;
  onState: (state: ImageState) => void;
  saved: { images: PreparedImage[]; revision: number | null } | null;
}) {
  const pending = useRef(false);
  const [preparing, setPreparing] = useState(false);
  const [results, setResults] = useState<{ images: PreparedImage[]; revision: number | null } | null>(
    saved && saved.images.length ? saved : null,
  );
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [folderMessage, setFolderMessage] = useState("");
  const summary = imageSummary(results?.images ?? [], results?.revision ?? null, draft.revision);

  const prepare = async () => {
    if (pending.current || !api.prepareImages) return;
    pending.current = true;
    onBusy(true);
    setPreparing(true);
    onState("preparing");
    setError("");
    setWarnings([]);
    setFolderMessage("");
    try {
      const value = await api.prepareImages(draft.id, draft.revision);
      const images = value.images ?? [];
      setResults({ images, revision: value.draft.revision });
      setWarnings(value.warnings);
      onPrepared(value.draft);
      const next = imageSummary(images, value.draft.revision, value.draft.revision);
      onState(next.allReady && !value.warnings.length ? "ready" : "attention");
    } catch (cause) {
      setError(errorMessage(cause));
      onState("failed");
    } finally {
      pending.current = false;
      setPreparing(false);
      onBusy(false);
    }
  };
  const openFolder = () => {
    setFolderMessage("");
    void api.openPreparedImages?.(draft.id).catch((cause) => setFolderMessage(errorMessage(cause)));
  };

  if (!api.prepareImages)
    return <p className="field-help">图片准备请使用 Tauri 版；复制正文不会上传图片。</p>;
  const label = preparing
    ? "正在准备图片…"
    : !results || summary.stale
      ? `准备 ${count} 张图片`
      : summary.failed
        ? `重试失败的 ${summary.failed} 张`
        : "重新检查图片";
  return (
    <div className="image-preparation">
      <div className="inline-actions">
        <button
          type="button"
          className="button"
          disabled={busy}
          aria-busy={preparing}
          onClick={() => void prepare()}
        >
          {preparing ? (
            <LoaderCircle size={14} className="spin" aria-hidden="true" />
          ) : (
            <ImageDown size={14} aria-hidden="true" />
          )}
          {label}
        </button>
        {summary.ready > 0 && !summary.stale && api.openPreparedImages && (
          <button type="button" className="button quiet" disabled={busy} onClick={openFolder}>
            <FolderOpen size={14} aria-hidden="true" />
            打开图片文件夹
          </button>
        )}
      </div>
      <span className="field-help">
        外链图片会下载并随稿保存，原文可从历史版本找回；已保存的图片直接复用，不会重复下载。
      </span>
      {error && (
        <div className="notice danger" role="alert">
          <TriangleAlert size={15} aria-hidden="true" />
          <div className="notice-body">
            <p>{error}</p>
          </div>
        </div>
      )}
      {results && (
        <div
          className={`notice ${summary.stale ? "warning" : summary.allReady ? "success" : "warning"}`}
          role={summary.allReady && !summary.stale ? "status" : "alert"}
        >
          {summary.allReady && !summary.stale ? (
            <Check size={15} aria-hidden="true" />
          ) : (
            <TriangleAlert size={15} aria-hidden="true" />
          )}
          <div className="notice-body">
            <p>{summary.text}</p>
            <ol className="image-results" aria-label="逐张图片结果">
              {results.images.map((image) => (
                <li key={image.position} data-status={image.status}>
                  <span className="num">第 {image.position} 张</span>
                  <span className="image-source" title={image.source}>
                    {image.status === "ready" ? image.filename : image.source}
                  </span>
                  <span className={image.status === "ready" ? "image-ok" : "image-failed"}>
                    {image.status === "ready" ? "本地已准备" : image.error || "未能准备"}
                  </span>
                </li>
              ))}
            </ol>
            {warnings.map((warning, i) => (
              <p key={i}>{warning}</p>
            ))}
            <p className="muted small">“本地已准备”只表示上传副本在这台电脑上，需在掘金对应位置自行上传。</p>
          </div>
        </div>
      )}
      {folderMessage && (
        <p className="field-error" role="alert">
          {folderMessage}
        </p>
      )}
    </div>
  );
}
