import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, Copy, ExternalLink, Eye, Info, TriangleAlert } from "lucide-react";
import type { Draft, Platform, Preparation, XAccount } from "../shared/contracts";
import { api, errorMessage } from "./api";
import { XPublish } from "./publishing/XPublish";
import { sensitiveText } from "./publishing/text";
import { isStale, usePreparation } from "./publishing/usePreparation";
import { XWebAssist } from "./publishing/XWebAssist";
import { XTextField } from "./publishing/XTextField";
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
  preparations,
  registerFlush,
}: {
  draft: Draft;
  onClose: () => void;
  onRecorded: () => Promise<void>;
  onPrepared: (draft: Draft) => void;
  onBusy: (busy: boolean) => void;
  onViewRecords: () => void;
  notify: (message: string) => void;
  /** Saved preparation for this draft, if the user left one unfinished. */
  preparations: Preparation[];
  registerFlush: (flush: () => Promise<void>) => void;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const preparation = usePreparation(draft, preparations, registerFlush);
  const prepared = useMemo(() => prepareJuejin(draft.body), [draft.body]);
  const heading = useRef<HTMLHeadingElement>(null);
  const [busy, setBusyState] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  // Resume where the user left off: the most recently touched platform opens first.
  const [platform, setPlatform] = useState<Platform>(() => preparations[0]?.platform ?? "juejin");
  const [images, setImages] = useState<ImageState>("idle");
  const xText = preparation.local.x.xText;
  const setXText = (value: string) => preparation.update("x", { xText: value });
  // Set by the API path while the post must not change; the web path never locks the text.
  const [xTextLocked, setXTextLocked] = useState(false);
  const [xAccount, setXAccount] = useState<XAccount | null | undefined>(undefined);
  const sensitive = sensitiveText(`${draft.title}\n${draft.body}`);
  const [acknowledged, setAcknowledged] = useState(false);
  const stale = isStale(preparation.local[platform], draft);
  const canCopy = (!sensitive || acknowledged) && !isStale(preparation.local.juejin, draft);
  const xMode = preparation.local.x.xMode ?? (xAccount?.connected ? "api" : "web");
  const recorded = async (platformDone: Platform) => {
    await preparation.finish(platformDone);
    await onRecorded();
  };
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
                : "将发送到 X 的短帖，可以直接在这里修改"}
            </p>
            {platform === "juejin" ? (
              <>
                <h2 className="publish-title">{title}</h2>
                <Markdown text={prepared.body} />
              </>
            ) : (
              <>
                <XTextField
                  text={xText}
                  setText={setXText}
                  readOnly={xMode === "api" && xTextLocked}
                  help={
                    xMode === "api"
                      ? "长文默认只带入标题，请补充简介或文章链接。仅发布这段文字，不自动拆分或上传图片，也不改变原稿。"
                      : "长文默认只带入标题，可补充简介或文章链接。只复制这段文字，不拆分、不带图片，原稿不变。"
                  }
                />
                <section className="x-source" aria-labelledby="x-source-title">
                  <h2 id="x-source-title" className="x-source-title">
                    原稿《{title}》<span>只读，供压缩时参考；改动请返回编辑</span>
                  </h2>
                  {draft.body.trim() ? <Markdown text={draft.body} /> : <p className="field-help">原稿还没有正文。</p>}
                </section>
              </>
            )}
          </div>
        </div>
        <aside className="publish-rail" aria-label="发布设置">
          {preparation.error && (
            <div className="notice danger" role="alert">
              <TriangleAlert size={15} aria-hidden="true" />
              <div className="notice-body">
                <p>发布准备未能保存：{preparation.error} 输入仍保留，离开前会再次尝试。</p>
                <div className="notice-actions">
                  <button type="button" className="button" onClick={() => void preparation.flush().catch(() => {})}>
                    重试保存
                  </button>
                </div>
              </div>
            </div>
          )}
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
              disabled={busy}
              onClick={() => setPlatform("x")}
            >
              <strong>X</strong>
              <span className={xAccount?.connected ? "ok" : undefined}>
                {xAccount?.connected ? `网页辅助 · API ${xStatus}` : "网页辅助 · 无需开发者应用"}
              </span>
            </button>
          </div>

          {stale && (
            <div className="notice warning prep-stale" role="alert">
              <TriangleAlert size={15} aria-hidden="true" />
              <div className="notice-body">
                <span className="notice-title">原稿在准备后修改过，请重新核对</span>
                <p>
                  上次准备基于版本 {preparation.local[platform].revision}，现在是版本 {draft.revision}。
                  {platform === "x" ? "你编辑的短帖" : "待记录的链接"}已保留；核对左侧预览后再继续。
                </p>
                <div className="notice-actions">
                  <button type="button" className="button" disabled={busy} onClick={() => preparation.confirmCurrent(platform)}>
                    已核对，按当前版本继续
                  </button>
                </div>
              </div>
            </div>
          )}
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
                        saved={(() => {
                          const saved = preparations.find((item) => item.platform === "juejin");
                          return saved ? { images: saved.images, revision: saved.imagesRevision } : null;
                        })()}
                        draft={draft}
                        count={prepared.images}
                        busy={busy}
                        onBusy={setBusy}
                        onState={setImages}
                        onPrepared={(next) => {
                          setDraft(next);
                          onPrepared(next);
                          setCopied(false);
                          void onRecorded().catch(() => {});
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
                      busy={busy || isStale(preparation.local.juejin, draft)}
                      primary={copied}
                      onBusy={setBusy}
                      onRecorded={() => recorded("juejin")}
                      onViewRecords={onViewRecords}
                      value={preparation.local.juejin.pendingUrl}
                      onChange={(url) => preparation.update("juejin", { pendingUrl: url })}
                    />
                  </div>
                </li>
              </ol>
            </>
          ) : (
            <>
              <div className="segmented full" role="group" aria-label="X 发布方式">
                <button
                  type="button"
                  aria-pressed={xMode === "web"}
                  disabled={busy}
                  onClick={() => preparation.setMode("x", "web")}
                >
                  网页辅助发布
                </button>
                <button
                  type="button"
                  aria-pressed={xMode === "api"}
                  disabled={busy || !api.xPublish}
                  onClick={() => preparation.setMode("x", "api")}
                >
                  官方 API（实验性）
                </button>
              </div>
              {xMode === "web" ? (
                <XWebAssist
                  draft={draft}
                  text={xText}
                  locked={stale}
                  busy={busy}
                  onBusy={setBusy}
                  pendingUrl={preparation.local.x.pendingUrl}
                  setPendingUrl={(url) => preparation.update("x", { pendingUrl: url })}
                  onRecorded={() => recorded("x")}
                  onViewRecords={onViewRecords}
                />
              ) : api.xPublish ? (
                <XPublish
                  draft={draft}
                  text={xText}
                  onTextLocked={setXTextLocked}
                  locked={stale}
                  onAccount={(next) => setXAccount(next)}
                  onRecorded={onRecorded}
                  onPublished={() => void preparation.finish("x")}
                  onBusy={setBusy}
                  onViewRecords={onViewRecords}
                  notify={notify}
                />
              ) : (
                <p className="field-help">官方 API 发布请使用 Tauri 版；网页辅助发布可直接使用。</p>
              )}
            </>
          )}
          <p className="foot-note">
            {platform === "juejin"
              ? "工作台不会代你在掘金发布；只有你粘贴的链接会成为发布记录。"
              : xMode === "web"
                ? "网页辅助发布不读取 X 的登录状态或 Cookie，也不会代你发帖；只有你粘贴的链接会成为发布记录（人工确认）。"
                : "授权凭证保存在系统钥匙串，不进入文章、资料备份或开源代码。"}
          </p>
        </aside>
      </div>
    </section>
  );
}
