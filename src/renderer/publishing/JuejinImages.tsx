import { useRef, useState } from "react";
import { Check, ImageDown, LoaderCircle, TriangleAlert } from "lucide-react";
import type { Draft } from "../../shared/contracts";
import { api, errorMessage } from "../api";

export type ImageState = "idle" | "preparing" | "ready" | "attention" | "failed";

export function JuejinImages({
  draft,
  count,
  busy,
  onBusy,
  onPrepared,
  onState,
}: {
  draft: Draft;
  count: number;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onPrepared: (draft: Draft) => void;
  onState: (state: ImageState) => void;
}) {
  const pending = useRef(false);
  const [state, setState] = useState<ImageState>("idle");
  const [result, setResult] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const update = (next: ImageState) => {
    setState(next);
    onState(next);
  };
  const prepare = async () => {
    if (pending.current || !api.prepareImages) return;
    pending.current = true;
    onBusy(true);
    update("preparing");
    setResult("");
    setWarnings([]);
    try {
      const value = await api.prepareImages(draft.id, draft.revision);
      onPrepared(value.draft);
      setWarnings(value.warnings);
      setResult(
        value.count
          ? `已准备 ${value.count} 张图片，按编号在掘金对应位置上传。`
          : "没有可用图片，请检查原始链接或重新插入。",
      );
      update(value.count && !value.warnings.length ? "ready" : "attention");
    } catch (error) {
      setResult(errorMessage(error));
      update("failed");
    } finally {
      pending.current = false;
      onBusy(false);
    }
  };
  if (!api.prepareImages)
    return <p className="field-help">图片准备请使用 Tauri 版；复制正文不会上传图片。</p>;
  return (
    <div className="image-preparation">
      <div>
        <button
          type="button"
          className="button"
          disabled={busy}
          aria-busy={state === "preparing"}
          onClick={() => void prepare()}
        >
          {state === "preparing" ? (
            <LoaderCircle size={14} className="spin" aria-hidden="true" />
          ) : (
            <ImageDown size={14} aria-hidden="true" />
          )}
          {state === "preparing"
            ? "正在保存图片，完成后打开文件夹…"
            : state === "idle"
              ? `准备 ${count} 张图片`
              : "重新准备图片"}
        </button>
      </div>
      <span className="field-help">会下载文中的外链图片并随稿保存，原文可从历史版本找回。</span>
      {result && (
        <div
          className={`notice ${state === "ready" ? "success" : state === "failed" ? "danger" : "warning"}`}
          role={state === "ready" ? "status" : "alert"}
        >
          {state === "ready" ? (
            <Check size={15} aria-hidden="true" />
          ) : (
            <TriangleAlert size={15} aria-hidden="true" />
          )}
          <div className="notice-body">
            <p>{result}</p>
            {warnings.length > 0 && (
              <>
                <span className="notice-title">还有 {warnings.length} 项需要处理：</span>
                {warnings.map((warning, i) => (
                  <p key={i}>{warning}</p>
                ))}
                <p>处理后可重新准备；也可以先复制正文，在掘金手动上传这些图片。</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
