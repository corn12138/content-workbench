import { useEffect, useRef, useState } from "react";
import { CircleAlert, CircleCheckBig, ExternalLink, LoaderCircle, Send, TriangleAlert } from "lucide-react";
import type { Draft, PublishReceipt, XAccount } from "../../shared/contracts";
import { api, errorMessage } from "../api";
import { XConnection } from "./XConnection";
import { checkXText, sensitiveText, uncertainPublishError } from "./text";
import { RecordLink } from "./RecordLink";

export function XPublish({
  draft,
  text,
  setText,
  onAccount,
  onRecorded,
  onBusy,
  onViewRecords,
  notify,
}: {
  draft: Draft;
  text: string;
  setText: (text: string) => void;
  onAccount: (account: XAccount | null) => void;
  onRecorded: () => Promise<void>;
  onBusy: (busy: boolean) => void;
  onViewRecords: () => void;
  notify: (message: string) => void;
}) {
  const [account, setAccount] = useState<XAccount | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<PublishReceipt | null>(null);
  const [error, setError] = useState("");
  const [refreshWarning, setRefreshWarning] = useState("");
  const locked = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const status = useRef<HTMLDivElement>(null);
  const check = checkXText(text);
  const sensitive = sensitiveText(text);
  const uncertain = !!error && uncertainPublishError(error);
  const canPublish =
    !!account?.connected &&
    check.valid &&
    (!sensitive || acknowledged) &&
    !busy &&
    !receipt &&
    !uncertain;

  useEffect(() => {
    if (confirming) dialog.current?.showModal();
    else if (dialog.current?.open) dialog.current.close();
  }, [confirming]);
  useEffect(() => {
    if (receipt || error) status.current?.focus();
  }, [receipt, error]);

  const closeConfirm = () => {
    if (busy) return;
    setConfirming(false);
    trigger.current?.focus();
  };
  const publish = async () => {
    if (!canPublish || locked.current) return;
    locked.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    setConfirming(false);
    try {
      const result = await api.xPublish!({
        draftId: draft.id,
        revision: draft.revision,
        text: text.trim(),
        acknowledged,
        expectedUsername: account!.username!,
      });
      setReceipt(result);
      try {
        await onRecorded();
      } catch {
        setRefreshWarning("作品已发出，列表暂未刷新。请保留下方链接。");
      }
      notify(result.recorded ? "已发布到 X，作品链接已记录" : "X 已返回作品链接，请查看保存提示");
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      locked.current = false;
      setBusy(false);
      onBusy(false);
    }
  };
  return (
    <section className="x-publish" aria-label="发布到 X">
      <XConnection
        onBusy={onBusy}
        onAccount={(next) => {
          setAccount(next);
          onAccount(next);
          setConfirming(false);
        }}
      />
      {account?.connected && (
        <>
          <div className="field">
            <label className="field-label" htmlFor="x-post-text">
              短帖内容
            </label>
            <textarea
              id="x-post-text"
              className="input x-post-text"
              value={text}
              readOnly={busy || !!receipt || uncertain}
              maxLength={10000}
              aria-describedby="x-post-count x-post-help"
              onChange={(e) => {
                setText(e.target.value);
                setAcknowledged(false);
              }}
            />
            <p
              id="x-post-count"
              className={check.length > 280 ? "x-count over" : "x-count"}
            >
              <span className="num">{check.length} / 280</span>
              <span>中文通常计 2，链接计 23</span>
            </p>
            <span className="field-help" id="x-post-help">
              长文默认只带入标题，请补充简介或文章链接。仅发布上方文字，不自动拆分或上传图片，也不改变原稿。
            </span>
          </div>
          {check.localAsset && (
            <p className="field-error" role="alert">
              <CircleAlert size={13} aria-hidden="true" />
              请移除本机图片和文件路径后再发布。
            </p>
          )}
          {sensitive && (
            <label className="notice warning check">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                disabled={busy}
              />
              内容可能含密钥或密码，我已核对可以公开。
            </label>
          )}
          {!receipt && !uncertain && (
            <button
              type="button"
              ref={trigger}
              className="button primary large block"
              disabled={!canPublish}
              aria-busy={busy}
              onClick={() => setConfirming(true)}
            >
              {busy ? (
                <LoaderCircle size={15} className="spin" aria-hidden="true" />
              ) : (
                <Send size={15} aria-hidden="true" />
              )}
              {busy ? "正在发布，请勿重复发送…" : "发布到 X…"}
            </button>
          )}
        </>
      )}
      {receipt && (
        <div className="notice success" role="status" tabIndex={-1} ref={status}>
          <CircleCheckBig size={16} aria-hidden="true" />
          <div className="notice-body">
            <span className="notice-title">已发布到 X</span>
            <p>{receipt.warning || refreshWarning || "平台回执已保存到“发布记录”。"}</p>
            <code className="x-callback">{receipt.url}</code>
            <div className="notice-actions">
              <button
                type="button"
                className="button"
                onClick={() =>
                  void api.openExternal(receipt.url).catch((e) => setError(errorMessage(e)))
                }
              >
                <ExternalLink size={13} aria-hidden="true" />
                打开作品
              </button>
              <button
                type="button"
                className="button quiet"
                onClick={() =>
                  void api
                    .copyText(receipt.url)
                    .then(() => notify("作品链接已复制"))
                    .catch((e) => setError(errorMessage(e)))
                }
              >
                复制作品链接
              </button>
              <button type="button" className="button quiet" onClick={onViewRecords}>
                查看发布记录
              </button>
            </div>
          </div>
        </div>
      )}
      {error && uncertain && (
        <>
          <div className="notice warning" role="alert" tabIndex={-1} ref={status}>
            <TriangleAlert size={16} aria-hidden="true" />
            <div className="notice-body">
              <span className="notice-title">结果未确认，请先不要重发</span>
              <p>{error}</p>
              {account?.username && (
                <div className="notice-actions">
                  <button
                    type="button"
                    className="button"
                    onClick={() =>
                      void api
                        .openExternal(`https://x.com/${account.username}`)
                        .catch((e) => setError(errorMessage(e)))
                    }
                  >
                    <ExternalLink size={13} aria-hidden="true" />
                    打开我的 X 主页
                  </button>
                </div>
              )}
            </div>
          </div>
          <p className="field-help">在 X 上看到了这条作品？粘贴链接即可记录，来源为人工确认。</p>
          <RecordLink
            platform="x"
            draft={draft}
            busy={busy}
            primary
            onBusy={onBusy}
            onRecorded={onRecorded}
            onViewRecords={onViewRecords}
          />
        </>
      )}
      {error && !uncertain && (
        <div className="notice danger" role="alert" tabIndex={-1} ref={status}>
          <CircleAlert size={16} aria-hidden="true" />
          <div className="notice-body">
            <span className="notice-title">发布失败</span>
            <p>{error}</p>
            <p>X 明确拒绝了这次请求，内容没有发出。修正后可以重新发布。</p>
          </div>
        </div>
      )}
      <dialog
        ref={dialog}
        className="dialog"
        aria-labelledby="x-confirm-title"
        aria-describedby="x-confirm-description"
        onKeyDown={(event) => {
          // Escape belongs to this dialog; it must not also leave publishing preparation.
          if (event.key === "Escape") event.stopPropagation();
        }}
        onCancel={(event) => {
          event.preventDefault();
          closeConfirm();
        }}
      >
        <h2 id="x-confirm-title">确认发布到 X</h2>
        <p id="x-confirm-description">
          将以 <strong>@{account?.username}</strong> 公开发布以下内容。发布后无法在工作台撤回，可在 X 上删除。X API 可能扣除应用额度。
        </p>
        <div className="post-card">{text.trim()}</div>
        <p className="x-count">
          <span className="num">{check.length} / 280</span>
          <span>仅文字，不含图片</span>
        </p>
        <div className="dialog-actions">
          <button type="button" className="button" autoFocus onClick={closeConfirm}>
            再看一下
          </button>
          <button type="button" className="button primary" disabled={!canPublish} onClick={() => void publish()}>
            <Send size={14} aria-hidden="true" />
            确认发布到 @{account?.username}
          </button>
        </div>
      </dialog>
    </section>
  );
}
