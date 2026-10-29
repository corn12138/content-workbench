import { useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, X, Check } from "lucide-react";
import type { Draft } from "../shared/contracts";
import { api, errorMessage } from "./api";
import { Markdown } from "./Markdown";

export function PublishDialog({
  draft,
  onClose,
  onRecorded,
  notify,
}: {
  draft: Draft;
  onClose: () => void;
  onRecorded: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [url, setURL] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const sensitive =
    /(?:sk-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_-]?key|password|token)\s*[:=]\s*["'][^"']{8,}["'])/i.test(
      draft.body,
    );
  const [acknowledged, setAcknowledged] = useState(false);
  const canCopy = !sensitive || acknowledged;
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const record = async () => {
    setBusy(true);
    setError("");
    try {
      if (
        !/^https:\/\/juejin\.cn\/post\/[0-9]+\/?(?:[?#].*)?$/.test(url.trim())
      )
        throw new Error("请粘贴掘金文章的完整链接。");
      await api.recordPublication(draft.id, draft.revision, url);
      await onRecorded();
      notify("发布链接已记录，来源为人工确认");
      onClose();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="publish-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      aria-labelledby="publish-title"
    >
      <header className="dialog-header">
        <div>
          <p className="eyebrow">发布前看一眼</p>
          <h2 id="publish-title">把这篇文章分享出去</h2>
        </div>
        <button
          className="icon-button"
          aria-label="关闭发布预览"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      <div className="publish-layout">
        <div className="publish-preview">
          <h2>{draft.title || "未命名稿件"}</h2>
          <Markdown text={draft.body} />
        </div>
        <aside className="publish-actions">
          <div className="platform-heading">
            <span className="platform-icon">掘</span>
            <div>
              <strong>掘金</strong>
              <p>在原平台完成发布</p>
            </div>
          </div>
          <p className="muted">
            正文已经准备好。复制后打开掘金，选择分类、补充图片并发布。
          </p>
          {/!\[|<img\b/i.test(draft.body) && (
            <p className="notice">
              这篇文章包含图片。当前版本只复制文字，请在掘金检查并补充图片。
            </p>
          )}
          {sensitive && (
            <div className="notice warning">
              <strong>正文可能包含密钥或密码</strong>
              <p>请核对原文。此检查无法发现所有敏感信息。</p>
              <label>
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                我已确认这些内容可以公开
              </label>
            </div>
          )}
          <button
            className="button"
            disabled={!canCopy}
            onClick={() =>
              void api
                .copyText(draft.body)
                .then(() => setCopied(true))
                .catch((e) => setError(errorMessage(e)))
            }
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? "正文已复制" : "复制正文"}
          </button>
          <button
            className="button primary"
            disabled={!canCopy}
            onClick={() =>
              void api
                .openExternal("https://juejin.cn/editor/drafts/new?v=2")
                .catch((e) => setError(errorMessage(e)))
            }
          >
            <ExternalLink size={16} />
            打开掘金发布
          </button>
          <div className="record-link">
            <label className="field">
              发布后，把文章链接粘贴到这里
              <input
                className="input"
                aria-label="已发布的掘金文章链接"
                value={url}
                onChange={(e) => setURL(e.target.value)}
                placeholder="https://juejin.cn/post/…"
              />
            </label>
            <button
              className="button"
              disabled={!url.trim() || busy}
              onClick={() => void record()}
            >
              {busy ? "记录中…" : "记录发布链接"}
            </button>
            <small>只记录链接，不会代你发布或修改文章。</small>
          </div>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <div className="coming-platform">
            <strong>X</strong>
            <p>自动发布将在账号授权与预算验证后开放。当前不会向 X 发送内容。</p>
          </div>
        </aside>
      </div>
    </dialog>
  );
}
