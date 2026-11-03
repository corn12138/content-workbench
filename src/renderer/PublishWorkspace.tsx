import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, Copy, ExternalLink, Eye, Info, TriangleAlert } from "lucide-react";
import type { Draft, XAccount } from "../shared/contracts";
import { api, errorMessage } from "./api";
import { XPublish } from "./publishing/XPublish";
import { initialXText, sensitiveText } from "./publishing/text";
import { prepareJuejin } from "./publishing/juejin";
import { JuejinImages, type ImageState } from "./publishing/JuejinImages";
import { RecordLink } from "./publishing/RecordLink";
import { Markdown } from "./Markdown";
import "./publishing/publishing.css";

/**
 * Publishing preparation replaces the editor in place. The draft revision is fixed when it opens
 * (the editor flushed first), so every copy, image preparation and record refers to that version.
 */
export function PublishWorkspace({
  draft: initialDraft,
  onClose,
  onRecorded,
  onPrepared,
  onBusy,
  onViewRecords,
  notify,
}: {
  draft: Draft;
  onClose: () => void;
  onRecorded: () => Promise<void>;
  onPrepared: (draft: Draft) => void;
  onBusy: (busy: boolean) => void;
  onViewRecords: () => void;
  notify: (message: string) => void;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const prepared = useMemo(() => prepareJuejin(draft.body), [draft.body]);
  const heading = useRef<HTMLHeadingElement>(null);
  const [busy, setBusyState] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [platform, setPlatform] = useState<"juejin" | "x">("juejin");
  const [images, setImages] = useState<ImageState>("idle");
  const [xText, setXText] = useState(() => initialXText(draft.title, draft.body));
  const [xAccount, setXAccount] = useState<XAccount | null | undefined>(undefined);
  const sensitive = sensitiveText(`${draft.title}\n${draft.body}`);
  const [acknowledged, setAcknowledged] = useState(false);
  const canCopy = !sensitive || acknowledged;
  const setBusy = (value: boolean) => {
    setBusyState(value);
    onBusy(value);
  };

  useEffect(() => {
    heading.current?.focus();
    let active = true;
    // Only for the platform tile label; the X panel loads its own authoritative state.
    void api.xAccount?.().then(
      (value) => active && setXAccount(value),
      () => active && setXAccount(null),
    );
    return () => {
      active = false;
      onBusy(false);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = async (open: boolean) => {
    setError("");
    try {
      await api.copyText(prepared.body);
      setCopied(true);
      if (open) await api.openExternal("https://juejin.cn/editor/drafts/new?v=2");
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const xStatus =
    xAccount === undefined
      ? "实验性"
      : xAccount?.connected
        ? `已连接 @${xAccount.username}`
        : xAccount?.clientId
          ? "未连接 · 需要连接"
          : "未配置 · 需要设置";
  let step = 0;
  const imageDone = images === "ready";
  const title = draft.title || "未命名稿件";

  return (
    <section
      className="publish-workspace detail-pane"
      aria-labelledby="publish-title"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented && !busy) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header className="pane-header publish-header" data-tauri-drag-region>
        <button type="button" className="button quiet small" disabled={busy} onClick={onClose}>
          <ChevronLeft size={15} aria-hidden="true" />
          返回编辑
        </button>
        <h1 id="publish-title" tabIndex={-1} ref={heading}>
          准备发布
        </h1>
        <span className="publish-of">{title}</span>
        <span className="kbd" aria-hidden="true">
          Esc 返回
        </span>
      </header>
      <div className="publish-body">
        <div className="publish-preview" tabIndex={0} aria-label="发布内容预览">
          <div className="editor-column">
            <p className="publish-preview-label">
              <Eye size={13} aria-hidden="true" />
              {platform === "juejin"
                ? `将复制到掘金的内容${prepared.adjusted ? ` · 已适配 ${prepared.adjusted} 处目录链接` : ""} · 本地排版预览，最终效果以掘金发布页为准`
                : "将发送到 X 的短帖 · 只发送这段文字，不拆分、不上传图片，原稿不变"}
            </p>
            {platform === "juejin" ? (
              <>
                <h2 className="publish-title">{title}</h2>
                <Markdown text={prepared.body} />
              </>
            ) : (
              <>
                <div className="post-card">{xText.trim() || "（短帖内容为空）"}</div>
                <p className="field-help">原稿《{title}》保持不变，可随时返回编辑。</p>
              </>
            )}
          </div>
        </div>
        <aside className="publish-rail" aria-label="发布设置">
          <div className="platform-tiles" role="group" aria-label="选择发布平台">
            <button
              type="button"
              className="platform-tile"
              data-platform="juejin"
              aria-pressed={platform === "juejin"}
              disabled={busy}
              onClick={() => setPlatform("juejin")}
            >
              <strong>掘金</strong>
              <span>辅助发布 · 浏览器登录</span>
            </button>
            <button
              type="button"
              className="platform-tile"
              data-platform="x"
              aria-pressed={platform === "x"}
              disabled={busy || !api.xPublish}
              onClick={() => setPlatform("x")}
            >
              <strong>
                X <span className="badge warning">实验性</span>
              </strong>
              <span className={xAccount?.connected ? "ok" : "attention"}>
                {api.xPublish ? xStatus : "请使用 Tauri 版"}
              </span>
            </button>
          </div>

          {platform === "juejin" ? (
            <>
              <div className="account-card">
                <span className="avatar" aria-hidden="true">
                  掘
                </span>
                <div className="account-text">
                  <strong>使用浏览器中的掘金登录</strong>
                  <span>登录由掘金网页处理，工作台不读取你的密码或 Cookie。</span>
                </div>
              </div>
              {prepared.differences.length > 0 && (
                <details className="disclosure">
                  <summary>
                    <Info size={14} aria-hidden="true" />
                    {prepared.differences.length} 处排版差异，发布后请核对
                    <ChevronDown size={14} className="chevron" aria-hidden="true" />
                  </summary>
                  <ul className="disclosure-body">
                    {prepared.adjusted > 0 && (
                      <li>已为掘金适配 {prepared.adjusted} 处目录链接，原稿不变。</li>
                    )}
                    {prepared.differences.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </details>
              )}
              {sensitive && (
                <div className="notice warning">
                  <TriangleAlert size={15} aria-hidden="true" />
                  <div className="notice-body">
                    <span className="notice-title">正文可能包含密钥或密码</span>
                    <p>请核对原文。此检查无法发现所有敏感信息。</p>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={acknowledged}
                        onChange={(e) => setAcknowledged(e.target.checked)}
                      />
                      我已确认这些内容可以公开
                    </label>
                  </div>
                </div>
              )}
              <ol className="publish-steps">
                {prepared.images > 0 && (
                  <li className="publish-step">
                    <span className={imageDone ? "step-number done" : "step-number"} aria-hidden="true">
                      {imageDone ? <Check size={12} /> : ++step}
                    </span>
                    <div className="publish-step-main">
                      <h2>准备图片</h2>
                      <p className="field-help">
                        文中有 {prepared.images} 张图片。复制正文不会上传图片，需要按编号在掘金对应位置上传。
                      </p>
                      <JuejinImages
                        draft={draft}
                        count={prepared.images}
                        busy={busy}
                        onBusy={setBusy}
                        onState={setImages}
                        onPrepared={(next) => {
                          setDraft(next);
                          onPrepared(next);
                          setCopied(false);
                        }}
                      />
                    </div>
                  </li>
                )}
                <li className="publish-step">
                  <span className={copied ? "step-number done" : "step-number"} aria-hidden="true">
                    {copied ? <Check size={12} /> : ++step}
                  </span>
                  <div className="publish-step-main">
                    <h2>复制并打开掘金</h2>
                    <p className="field-help">
                      复制适配后的正文，在系统浏览器打开掘金编辑器，粘贴后选择分类再发布。
                    </p>
                    <div className="inline-actions">
                      <button
                        type="button"
                        className={copied ? "button" : "button primary large"}
                        disabled={!canCopy || busy}
                        onClick={() => void copy(true)}
                      >
                        <ExternalLink size={14} aria-hidden="true" />
                        {copied ? "再次复制并打开" : "复制并打开掘金"}
                      </button>
                      <button
                        type="button"
                        className="button quiet"
                        disabled={!canCopy || busy}
                        onClick={() => void copy(false)}
                      >
                        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                        {copied ? "正文已复制" : "复制正文"}
                      </button>
                    </div>
                    {copied && (
                      <div className="notice info" role="status">
                        <Info size={15} aria-hidden="true" />
                        <div className="notice-body">
                          <p>正文已复制。这还不算发布成功——在掘金完成发布后，回到这里记录链接。</p>
                        </div>
                      </div>
                    )}
                    {error && (
                      <p className="field-error" role="alert">
                        {error}
                      </p>
                    )}
                  </div>
                </li>
                <li className="publish-step">
                  <span className="step-number" aria-hidden="true">
                    {++step}
                  </span>
                  <div className="publish-step-main">
                    <h2>记录发布链接</h2>
                    <RecordLink
                      platform="juejin"
                      draft={draft}
                      busy={busy}
                      primary={copied}
                      onBusy={setBusy}
                      onRecorded={onRecorded}
                      onViewRecords={onViewRecords}
                    />
                  </div>
                </li>
              </ol>
            </>
          ) : api.xPublish ? (
            <XPublish
              draft={draft}
              text={xText}
              setText={setXText}
              onAccount={(next) => setXAccount(next)}
              onRecorded={onRecorded}
              onBusy={setBusy}
              onViewRecords={onViewRecords}
              notify={notify}
            />
          ) : (
            <p className="field-help">X 授权与发布请使用 Tauri 版。</p>
          )}
          <p className="foot-note">
            {platform === "juejin"
              ? "工作台不会代你在掘金发布；只有你粘贴的链接会成为发布记录。"
              : "授权凭证保存在系统钥匙串，不进入文章、资料备份或开源代码。"}
          </p>
        </aside>
      </div>
    </section>
  );
}
