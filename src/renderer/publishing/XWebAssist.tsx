import { useState } from "react";
import { Check, Copy, ExternalLink, Info, TriangleAlert } from "lucide-react";
import type { Draft } from "../../shared/contracts";
import { api, errorMessage } from "../api";
import { RecordLink } from "./RecordLink";
import { XTextField } from "./XTextField";
import { checkXText, sensitiveText } from "./text";
import { X_INTENT, xIntentURL } from "./xWeb";

/**
 * Browser-assisted X publishing for people without a developer app: check and copy the text, open X's
 * normal composer, then record the link by hand. Copying or opening never counts as publishing and
 * never creates an API receipt; the workbench does not read X cookies or call private endpoints.
 */
export function XWebAssist({
  draft,
  text,
  setText,
  locked,
  busy,
  onBusy,
  pendingUrl,
  setPendingUrl,
  onRecorded,
  onViewRecords,
}: {
  draft: Draft;
  text: string;
  setText: (text: string) => void;
  /** True while the preparation must be re-checked against the current draft. */
  locked: boolean;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  pendingUrl: string;
  setPendingUrl: (url: string) => void;
  onRecorded: () => Promise<void>;
  onViewRecords: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [openError, setOpenError] = useState("");
  const check = checkXText(text);
  const sensitive = sensitiveText(text);
  const ready = check.valid && !!text.trim() && (!sensitive || acknowledged) && !locked;
  const prefill = xIntentURL(text);

  const open = async (url: string) => {
    setOpenError("");
    try {
      await api.openExternal(url);
    } catch (error) {
      // Copy already succeeded; only the browser step failed and can be repeated on its own.
      setOpenError(errorMessage(error));
    }
  };
  const copy = async (then?: string) => {
    setCopyError("");
    setOpenError("");
    try {
      await api.copyText(text.trim());
      setCopied(true);
    } catch (error) {
      setCopied(false);
      setCopyError(errorMessage(error));
      return;
    }
    if (then) await open(then);
  };

  return (
    <ol className="publish-steps x-web">
      <li className="publish-step">
        <span className="step-number" aria-hidden="true">1</span>
        <div className="publish-step-main">
          <h2>检查短帖</h2>
          <XTextField
            text={text}
            setText={(value) => {
              setText(value);
              setAcknowledged(false);
              setCopied(false);
            }}
            help="长文默认只带入标题，可补充简介或文章链接。只复制这段文字，不拆分、不带图片，原稿不变。"
          />
          {sensitive && (
            <label className="notice warning check">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              内容可能含密钥或密码，我已核对可以公开。
            </label>
          )}
        </div>
      </li>
      <li className="publish-step">
        <span className={copied ? "step-number done" : "step-number"} aria-hidden="true">
          {copied ? <Check size={12} /> : 2}
        </span>
        <div className="publish-step-main">
          <h2>复制并打开 X</h2>
          <p className="field-help">在系统浏览器打开 X 的撰写页，使用你自己的登录；粘贴短帖后由你在 X 上发布。</p>
          <div className="inline-actions">
            <button
              type="button"
              className={copied ? "button" : "button primary large"}
              disabled={!ready || busy}
              onClick={() => void copy(X_INTENT)}
            >
              <ExternalLink size={14} aria-hidden="true" />
              {copied ? "再次复制并打开" : "复制并打开 X"}
            </button>
            <button type="button" className="button quiet" disabled={!ready || busy} onClick={() => void copy()}>
              {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
              {copied ? "短帖已复制" : "仅复制短帖"}
            </button>
          </div>
          <details className="disclosure">
            <summary>更多打开方式</summary>
            <div className="disclosure-body">
              <p>
                也可以让 X 的撰写框直接带入短帖（X 官方 Web Intent，文字会出现在浏览器地址中）。
              </p>
              <button
                type="button"
                className="button small"
                disabled={!ready || busy || !prefill}
                onClick={() => prefill && void open(prefill)}
              >
                <ExternalLink size={13} aria-hidden="true" />
                打开并预填短帖
              </button>
              {!prefill && <p className="field-help">短帖较长，无法放入链接，请使用复制后粘贴。</p>}
            </div>
          </details>
          {copied && (
            <div className="notice info" role="status">
              <Info size={15} aria-hidden="true" />
              <div className="notice-body">
                <p>短帖已复制。这还不算发布——在 X 发布后，把作品链接粘贴到下方保存。</p>
              </div>
            </div>
          )}
          {openError && (
            <div className="notice warning" role="alert">
              <TriangleAlert size={15} aria-hidden="true" />
              <div className="notice-body">
                <p>短帖已复制，但浏览器没有打开：{openError}</p>
                <div className="notice-actions">
                  <button type="button" className="button" onClick={() => void open(X_INTENT)}>
                    重新打开 X
                  </button>
                </div>
              </div>
            </div>
          )}
          {copyError && (
            <p className="field-error" role="alert">
              未能复制：{copyError}
            </p>
          )}
        </div>
      </li>
      <li className="publish-step">
        <span className="step-number" aria-hidden="true">3</span>
        <div className="publish-step-main">
          <h2>记录作品链接</h2>
          <RecordLink
            platform="x"
            draft={draft}
            busy={busy || locked}
            primary={copied}
            onBusy={onBusy}
            onRecorded={onRecorded}
            onViewRecords={onViewRecords}
            value={pendingUrl}
            onChange={setPendingUrl}
          />
        </div>
      </li>
    </ol>
  );
}
