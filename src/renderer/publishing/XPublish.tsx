import { useRef, useState } from "react";
import type { Draft, PublishReceipt, XAccount } from "../../shared/contracts";
import { api, errorMessage } from "../api";
import { XConnection } from "./XConnection";
import { checkXText, sensitiveText, initialXText } from "./text";

export function XPublish({
  draft,
  onRecorded,
  onBusy,
  notify,
}: {
  draft: Draft;
  onRecorded: () => Promise<void>;
  onBusy: (busy: boolean) => void;
  notify: (message: string) => void;
}) {
  const [account, setAccount] = useState<XAccount | null>(null);
  const [text, setText] = useState(() => initialXText(draft.title, draft.body));
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<PublishReceipt | null>(null);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const check = checkXText(text);
  const sensitive = sensitiveText(text);
  const canPublish =
    account?.connected &&
    check.valid &&
    (!sensitive || acknowledged) &&
    !busy &&
    !receipt;
  const publish = async () => {
    if (!canPublish || locked.current) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    locked.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
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
        setError("作品已发出，列表暂未刷新。请保留下方链接。");
      }
      notify(
        result.recorded
          ? "已发布到 X，作品链接已记录"
          : "X 已返回作品链接，请查看保存提示",
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      locked.current = false;
      setBusy(false);
      onBusy(false);
      setConfirming(false);
    }
  };
  return (
    <section className="x-publish">
      <XConnection
        onAccount={(next) => {
          setAccount(next);
          setConfirming(false);
        }}
      />
      <label className="field">
        X 发布内容
        <textarea
          className="input x-post-text"
          value={text}
          disabled={busy || !!receipt}
          maxLength={10000}
          onChange={(e) => {
            setText(e.target.value);
            setAcknowledged(false);
            setConfirming(false);
          }}
        />
      </label>
      <p className={check.length > 280 ? "inline-error" : "muted small"}>
        {check.length} / 280 · 中文通常计 2，链接计 23
      </p>
      <p className="muted small">
        长文默认只带入标题，请补充简介或文章链接。仅发布上方文字，不自动拆分或上传图片，也不改变原稿。
      </p>
      {check.localAsset && (
        <p className="inline-error">请移除本机图片和文件路径后再发布。</p>
      )}
      {sensitive && (
        <label className="notice warning">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            disabled={busy}
          />{" "}
          内容可能含密钥或密码，我已核对可以公开。
        </label>
      )}
      {confirming && (
        <p className="notice">
          将向 @{account?.username} 公开发布上方内容。X API 可能扣除应用额度。
        </p>
      )}
      <button
        className="button primary"
        disabled={!canPublish}
        onClick={() => void publish()}
      >
        {busy
          ? "正在发布，请勿重复发送…"
          : confirming
            ? `确认发布到 @${account?.username}`
            : "发布到 X"}
      </button>
      {confirming && !busy && (
        <button className="button quiet" onClick={() => setConfirming(false)}>
          再看一下
        </button>
      )}
      {receipt && (
        <div className="notice" role="status">
          <strong>作品已发布</strong>
          <p>{receipt.warning || "平台回执已保存到“反馈”。"}</p>
          <code className="x-callback">{receipt.url}</code>
          <button
            className="button"
            onClick={() =>
              void api
                .copyText(receipt.url)
                .then(() => notify("作品链接已复制"))
                .catch((e) => setError(errorMessage(e)))
            }
          >
            复制作品链接
          </button>
        </div>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {account?.username && (
        <button
          className="button quiet"
          onClick={() =>
            void api
              .openExternal(`https://x.com/${account.username}`)
              .catch((e) => setError(errorMessage(e)))
          }
        >
          打开 X 个人主页
        </button>
      )}
    </section>
  );
}
