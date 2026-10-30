import { useRef, useState } from "react";
import type { Draft } from "../../shared/contracts";
import { api, errorMessage } from "../api";

export function JuejinImages({
  draft,
  busy,
  onBusy,
  onPrepared,
}: {
  draft: Draft;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onPrepared: (draft: Draft) => void;
}) {
  const pending = useRef(false);
  const [result, setResult] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const prepare = async () => {
    if (pending.current || !api.prepareImages) return;
    pending.current = true;
    onBusy(true);
    setResult("正在保存图片，完成后打开文件夹…");
    setWarnings([]);
    try {
      const value = await api.prepareImages(draft.id, draft.revision);
      onPrepared(value.draft);
      setResult(
        value.count
          ? `已准备 ${value.count} 张图片，按编号在掘金对应位置上传。`
          : "没有可用图片，请检查原始链接或重新插入。",
      );
      setWarnings(value.warnings);
    } catch (error) {
      setResult(errorMessage(error));
    } finally {
      pending.current = false;
      onBusy(false);
    }
  };
  return (
    <div className="notice image-preparation">
      <p>复制正文不会上传图片。先准备图片，再到掘金对应位置上传。</p>
      {api.prepareImages ? (
        <button
          className="button"
          disabled={busy}
          onClick={() => void prepare()}
        >
          准备图片
        </button>
      ) : (
        <p>图片准备请使用 Tauri 版。</p>
      )}
      <small>会下载文中的外链图片并随稿保存，原文可从历史版本找回。</small>
      {result && <p role="status">{result}</p>}
      {warnings.length > 0 && (
        <details open>
          <summary>还有 {warnings.length} 项需要处理</summary>
          {warnings.map((warning, i) => (
            <p key={i}>{warning}</p>
          ))}
        </details>
      )}
    </div>
  );
}
