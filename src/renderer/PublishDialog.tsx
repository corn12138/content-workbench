import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, ExternalLink, X, Check } from "lucide-react";
import type { Draft } from "../shared/contracts";
import { api, errorMessage } from "./api";
import { XPublish } from "./publishing/XPublish";
import { sensitiveText } from "./publishing/text";
import "./publishing/publishing.css";
import { prepareJuejin } from "./publishing/juejin";
import { JuejinImages } from "./publishing/JuejinImages";
import { Markdown } from "./Markdown";

export function PublishDialog({
  draft: initialDraft,
  onClose,
  onRecorded,
  onPrepared,
  notify,
}: {
  draft: Draft;
  onClose: () => void;
  onRecorded: () => Promise<void>;
  onPrepared: (draft: Draft) => void;
  notify: (message: string) => void;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const prepared = useMemo(() => prepareJuejin(draft.body), [draft.body]);
  const dialog = useRef<HTMLDialogElement>(null);
  const [url, setURL] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [platform, setPlatform] = useState<"juejin" | "x">("juejin");
  const sensitive = sensitiveText(`${draft.title}\n${draft.body}`);
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
        !(
          platform === "juejin"
            ? /^https:\/\/juejin\.cn\/post\/[0-9]+\/?(?:[?#].*)?$/
            : /^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}\/status\/[0-9]+\/?(?:[?#].*)?$/
        ).test(url.trim())
      )
        throw new Error("请粘贴所选平台作品的完整链接。");
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
          <p className="muted small">
            {platform === "x"
              ? "原稿参考，实际发布内容请查看右侧短帖。"
              : "本地排版预览，最终效果请在掘金发布页核对。"}
          </p>
          <Markdown text={platform === "juejin" ? prepared.body : draft.body} />
        </div>
        <aside className="publish-actions">
          <div className="platform-tabs" aria-label="选择发布平台">
            <button
              className={`button ${platform === "juejin" ? "primary" : ""}`}
              disabled={busy}
              onClick={() => {
                setPlatform("juejin");
                setURL("");
                setError("");
              }}
            >
              掘金
            </button>
            <button
              className={`button ${platform === "x" ? "primary" : ""}`}
              disabled={busy}
              onClick={() => {
                setPlatform("x");
                setURL("");
                setError("");
              }}
            >
              X
            </button>
          </div>
          {platform === "x" ? (
            api.xPublish ? (
              <XPublish
                draft={draft}
                onRecorded={onRecorded}
                onBusy={setBusy}
                notify={notify}
              />
            ) : (
              <p>X 授权与发布请使用 Tauri 版。</p>
            )
          ) : (
            <>
              <div className="platform-heading">
                <span className="platform-icon">掘</span>
                <div>
                  <strong>掘金</strong>
                  <p>在原平台完成发布</p>
                </div>
              </div>
              <p className="muted">
                点击下方按钮即可复制正文并打开掘金。沿用浏览器登录状态，选择分类、补充图片后发布。
              </p>
              {prepared.images > 0 && (
                <JuejinImages
                  draft={draft}
                  busy={busy}
                  onBusy={setBusy}
                  onPrepared={(next) => {
                    setDraft(next);
                    onPrepared(next);
                    setCopied(false);
                  }}
                />
              )}
              {prepared.adjusted > 0 && (
                <p className="muted small">
                  已为掘金适配 {prepared.adjusted} 处目录链接，原稿不变。
                </p>
              )}
              {prepared.differences.length > 0 && (
                <details className="preview-differences">
                  <summary>发布时留意的排版差异</summary>
                  {prepared.differences.map((item) => (
                    <p className="small" key={item}>
                      {item}
                    </p>
                  ))}
                </details>
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
                disabled={!canCopy || busy}
                onClick={() =>
                  void api
                    .copyText(prepared.body)
                    .then(() => setCopied(true))
                    .catch((e) => setError(errorMessage(e)))
                }
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? "正文已复制" : "复制正文"}
              </button>
              <button
                className="button primary"
                disabled={!canCopy || busy}
                onClick={() =>
                  void api
                    .copyText(prepared.body)
                    .then(() => {
                      setCopied(true);
                      return api.openExternal(
                        "https://juejin.cn/editor/drafts/new?v=2",
                      );
                    })
                    .catch((e) => setError(errorMessage(e)))
                }
              >
                <ExternalLink size={16} />
                复制并打开掘金
              </button>
            </>
          )}
          <div className="record-link">
            <label className="field">
              发布后，把文章链接粘贴到这里
              <input
                className="input"
                aria-label="已发布的作品链接"
                value={url}
                onChange={(e) => setURL(e.target.value)}
                placeholder={
                  platform === "juejin"
                    ? "https://juejin.cn/post/…"
                    : "https://x.com/用户名/status/…"
                }
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
            <p>
              {platform === "juejin"
                ? "登录由掘金网页处理，工作台不读取你的密码或 Cookie。"
                : "授权凭证不会进入文章、资料备份或开源代码。"}
            </p>
          </div>
        </aside>
      </div>
    </dialog>
  );
}
