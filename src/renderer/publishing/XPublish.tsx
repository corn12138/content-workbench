import { useEffect, useReducer, useRef, useState } from "react";
import { CircleAlert, CircleCheckBig, ExternalLink, LoaderCircle, Send, TriangleAlert } from "lucide-react";
import type { Draft, XAccount } from "../../shared/contracts";
import { api, errorMessage } from "../api";
import { XConnection } from "./XConnection";
import { checkXText, sensitiveText } from "./text";
import { RecordLink } from "./RecordLink";
import { XTextField } from "./XTextField";
import { canSend, initialXPublishState, textLocked, xPublishReducer } from "./xOutcome";

export function XPublish({
  draft,
  text,
  setText,
  onAccount,
  onRecorded,
  onBusy,
  onViewRecords,
  notify,
  locked: stale = false,
  onPublished,
}: {
  draft: Draft;
  text: string;
  setText: (text: string) => void;
  onAccount: (account: XAccount | null) => void;
  onRecorded: () => Promise<void>;
  onBusy: (busy: boolean) => void;
  onViewRecords: () => void;
  notify: (message: string) => void;
  /** True while the preparation must be re-checked against the current draft. */
  locked?: boolean;
  /** Called after X returned a receipt, so the finished preparation can be cleared. */
  onPublished?: () => void;
}) {
  const [account, setAccount] = useState<XAccount | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [state, dispatch] = useReducer(xPublishReducer, initialXPublishState);
  const [refreshWarning, setRefreshWarning] = useState("");
  const locked = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const status = useRef<HTMLDivElement>(null);
  const { outcome, actionError } = state;
  const busy = outcome.kind === "publishing";
  const check = checkXText(text);
  const sensitive = sensitiveText(text);
  const canPublish =
    !!account?.connected && !stale && check.valid && (!sensitive || acknowledged) && canSend(outcome);

  useEffect(() => {
    if (confirming) dialog.current?.showModal();
    else if (dialog.current?.open) dialog.current.close();
  }, [confirming]);
  useEffect(() => {
    if (outcome.kind !== "idle" && outcome.kind !== "publishing") status.current?.focus();
  }, [outcome.kind]);

  /** Secondary actions report their own failure without touching the publication outcome. */
  const secondary = (task: () => Promise<unknown>, success?: string) => {
    dispatch({ type: "clearActionError" });
    void task().then(
      () => success && notify(success),
      (error) => dispatch({ type: "actionFailed", message: errorMessage(error) }),
    );
  };
  const closeConfirm = () => {
    if (busy) return;
    setConfirming(false);
    trigger.current?.focus();
  };
  const publish = async () => {
    if (!canPublish || locked.current) return;
    locked.current = true;
    dispatch({ type: "publish" });
    onBusy(true);
    setConfirming(false);
    try {
      const result = await api.xPublish!({
        draftId: draft.id,
        revision: draft.revision,
        text: text.trim(),
        acknowledged,
        expectedUsername: account!.username!,
      });
      dispatch({ type: "published", receipt: result });
      onPublished?.();
      try {
        await onRecorded();
      } catch {
        setRefreshWarning("作品已发出，列表暂未刷新。请保留下方链接。");
      }
      notify(result.recorded ? "已发布到 X，作品链接已记录" : "X 已返回作品链接，请查看保存提示");
    } catch (error) {
      dispatch({ type: "publishFailed", message: errorMessage(error) });
    } finally {
      locked.current = false;
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
          <XTextField
            text={text}
            readOnly={textLocked(outcome)}
            setText={(value) => {
              setText(value);
              setAcknowledged(false);
              dispatch({ type: "edited" });
            }}
            help="长文默认只带入标题，请补充简介或文章链接。仅发布上方文字，不自动拆分或上传图片，也不改变原稿。"
          />
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
          {(canSend(outcome) || busy) && (
            <button
              type="button"
              ref={trigger}
              className="button primary large block"
              disabled={!canPublish}
              aria-busy={busy}
              onClick={() => setConfirming(true)}
            >
              {busy ? <LoaderCircle size={15} className="spin" aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
              {busy ? "正在发布，请勿重复发送…" : "发布到 X…"}
            </button>
          )}
        </>
      )}
      {outcome.kind === "published" && (
        <div className="notice success x-outcome" data-outcome="published" role="status" tabIndex={-1} ref={status}>
          <CircleCheckBig size={16} aria-hidden="true" />
          <div className="notice-body">
            <span className="notice-title">已发布到 X</span>
            <p>{outcome.receipt.warning || refreshWarning || "平台回执已保存到“发布记录”。"}</p>
            <code className="x-callback">{outcome.receipt.url}</code>
            <div className="notice-actions">
              <button type="button" className="button" onClick={() => secondary(() => api.openExternal(outcome.receipt.url))}>
                <ExternalLink size={13} aria-hidden="true" />
                打开作品
              </button>
              <button
                type="button"
                className="button quiet"
                onClick={() => secondary(() => api.copyText(outcome.receipt.url), "作品链接已复制")}
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
      {outcome.kind === "uncertain" && (
        <>
          <div className="notice warning x-outcome" data-outcome="uncertain" role="alert" tabIndex={-1} ref={status}>
            <TriangleAlert size={16} aria-hidden="true" />
            <div className="notice-body">
              <span className="notice-title">结果未确认，请先不要重发</span>
              <p>{outcome.message}</p>
              {account?.username && (
                <div className="notice-actions">
                  <button
                    type="button"
                    className="button"
                    onClick={() => secondary(() => api.openExternal(`https://x.com/${account.username}`))}
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
      {outcome.kind === "rejected" && (
        <div className="notice danger x-outcome" data-outcome="rejected" role="alert" tabIndex={-1} ref={status}>
          <CircleAlert size={16} aria-hidden="true" />
          <div className="notice-body">
            <span className="notice-title">X 拒绝了这次请求</span>
            <p>{outcome.message}</p>
            <p>平台明确返回拒绝，这条内容没有发布。处理上述问题后可以重新发布。</p>
          </div>
        </div>
      )}
      {outcome.kind === "failed" && (
        <div className="notice danger x-outcome" data-outcome="failed" role="alert" tabIndex={-1} ref={status}>
          <CircleAlert size={16} aria-hidden="true" />
          <div className="notice-body">
            <span className="notice-title">发布没有完成</span>
            <p>{outcome.message}</p>
            <p>处理后可以再次尝试；若上次请求结果不明，工作台会阻止重复发送并提示你核实。</p>
          </div>
        </div>
      )}
      {actionError && (
        <p className="field-error x-action-error" role="alert">
          <CircleAlert size={13} aria-hidden="true" />
          {actionError}
        </p>
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
