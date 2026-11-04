import { useEffect, useRef, useState } from "react";
import { ChevronDown, Copy, LoaderCircle } from "lucide-react";
import type { XAccount } from "../../shared/contracts";
import { api, errorMessage } from "../api";

const fallbackCallback = "http://127.0.0.1:34187/oauth/x/callback";

export function XConnection({
  onAccount,
  onBusy,
}: {
  onAccount?: (account: XAccount | null) => void;
  onBusy?: (busy: boolean) => void;
}) {
  const [account, setAccount] = useState<XAccount | null>(null);
  const [clientId, setClientId] = useState("");
  const [setupOpen, setSetupOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const [message, setMessage] = useState("");
  const active = useRef(false);
  const connecting = useRef(false);
  const locked = useRef(false);
  const handler = useRef({ onAccount, onBusy });
  handler.current = { onAccount, onBusy };
  const working = (value: boolean) => {
    setBusy(value);
    handler.current.onBusy?.(value);
  };
  useEffect(() => {
    active.current = true;
    let cancelled = false;
    void api.xAccount!()
      .then((value) => {
        if (cancelled) return;
        setAccount(value);
        setClientId(value.clientId);
        setSetupOpen(!value.clientId);
        handler.current.onAccount?.(value);
      })
      .catch((error) => {
        if (!cancelled) setMessage(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      active.current = false;
      if (connecting.current) void api.xCancel!().catch(() => {});
    };
  }, []);
  const connect = async () => {
    if (locked.current) return;
    locked.current = true;
    connecting.current = true;
    working(true);
    setAuthorizing(true);
    setMessage("");
    try {
      const next = await api.xConnect!(clientId.trim());
      if (active.current) {
        setAccount(next);
        handler.current.onAccount?.(next);
        setMessage("已连接 X。发布前仍会让你确认内容和账号。");
      }
    } catch (error) {
      if (active.current) setMessage(errorMessage(error));
    } finally {
      connecting.current = false;
      locked.current = false;
      if (active.current) {
        setAuthorizing(false);
        working(false);
      }
    }
  };
  const save = async () => {
    if (locked.current || !api.xSaveClientId) return;
    locked.current = true;
    working(true);
    setMessage("");
    try {
      const next = await api.xSaveClientId(clientId.trim());
      if (active.current) {
        setAccount(next);
        setClientId(next.clientId);
        handler.current.onAccount?.(next);
        setMessage(next.clientId ? "已保存 Client ID。准备好后点“连接 X”授权。" : "已清除保存的 Client ID。");
        if (next.clientId) setSetupOpen(false);
      }
    } catch (error) {
      if (active.current) setMessage(errorMessage(error));
    } finally {
      locked.current = false;
      if (active.current) working(false);
    }
  };
  const disconnect = async () => {
    if (locked.current) return;
    locked.current = true;
    working(true);
    setMessage("");
    try {
      const result = await api.xDisconnect!();
      if (active.current) {
        setAccount((current) => (current ? { ...current, connected: false, username: null } : current));
        handler.current.onAccount?.(null);
        setMessage(result);
      }
    } catch (error) {
      if (active.current) setMessage(errorMessage(error));
    } finally {
      locked.current = false;
      if (active.current) working(false);
    }
  };
  const open = (url: string) =>
    void api.openExternal(url).catch((error) => setMessage(errorMessage(error)));
  const connected = !!account?.connected && !account?.needsReconnect;
  const expired = !!account?.connected && !!account?.needsReconnect;
  const configured = !!account?.clientId;
  const source = account?.clientSource;
  const edited = clientId.trim() !== (account?.clientId ?? "");
  const callback = account?.callback || fallbackCallback;
  return (
    <div className="x-connection">
      <div className="account-card" aria-live="polite">
        <span className="avatar" aria-hidden="true">
          X
        </span>
        <div className="account-text">
          <strong>
            {loading
              ? "正在读取连接状态…"
              : connected
                ? `@${account!.username}`
                : expired
                  ? `@${account!.username} · 授权已过期`
                  : authorizing
                    ? "等待浏览器授权…"
                    : configured
                      ? "未连接"
                      : "还没有连接 X"}
          </strong>
          <span>
            {connected
              ? "凭证保存在系统钥匙串"
              : expired
                ? "请重新连接后再用官方 API 发布。"
                : authorizing
                  ? "已在系统浏览器打开 X 授权页，完成后会自动返回；最多等待 3 分钟。"
                  : source === "default"
                    ? "使用本版本内置的应用，通过系统浏览器授权，无需提供账号密码。"
                    : configured
                      ? "已保存你的应用配置。通过系统浏览器授权，无需提供账号密码。"
                      : "这个版本没有内置 X 应用。官方 API 发布需要你自己的开发者应用；不想注册也可以使用网页辅助发布。"}
          </span>
        </div>
        {authorizing && <LoaderCircle size={16} className="spin" aria-hidden="true" />}
        {(connected || expired) && (
          <button type="button" className="button quiet small" disabled={busy} onClick={() => void disconnect()}>
            断开
          </button>
        )}
      </div>
      {!loading && (!connected || expired) && (
        <>
          <details
            className="disclosure x-setup"
            open={setupOpen}
            onToggle={(event) => setSetupOpen(event.currentTarget.open)}
          >
            <summary>
              {source === "default"
                ? "高级：改用自己的 X 应用"
                : configured
                  ? "修改 X 应用配置"
                  : "配置自己的 X 应用（高级）"}
              <ChevronDown size={14} className="chevron" aria-hidden="true" />
            </summary>
            <div className="disclosure-body">
              <ol className="steps">
                <li>
                  <span className="step-number">1</span>
                  <span>
                    在 X 开发者控制台创建 Native App，开启 OAuth 2.0 与读写权限。
                    <button type="button" className="link-button" onClick={() => open("https://console.x.com/")}>
                      打开开发者控制台
                    </button>
                  </span>
                </li>
                <li>
                  <span className="step-number">2</span>
                  <span className="x-step">
                    把以下地址填入应用的 Callback URL，需完全一致：
                    <code className="x-callback">{callback}</code>
                    <button
                      type="button"
                      className="button small"
                      onClick={() =>
                        void api
                          .copyText(callback)
                          .then(() => setMessage("回调地址已复制"))
                          .catch((e) => setMessage(errorMessage(e)))
                      }
                    >
                      <Copy size={13} aria-hidden="true" />
                      复制回调地址
                    </button>
                  </span>
                </li>
                <li>
                  <span className="step-number">3</span>
                  <span className="x-step">
                    <label className="field-label" htmlFor="x-client-id">
                      Client ID（公开标识，不是密钥）
                    </label>
                    <input
                      id="x-client-id"
                      className="input mono"
                      value={clientId}
                      disabled={busy}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(e) => setClientId(e.target.value)}
                      placeholder="粘贴 Native App 的 Client ID"
                    />
                  </span>
                </li>
              </ol>
              <p>不填写 Client Secret、Token 或 Cookie。X API 按量计费，连接账号和发帖前请在控制台确认额度。</p>
              {api.xSaveClientId && (
                <div className="inline-actions">
                  <button
                    type="button"
                    className="button small"
                    disabled={busy || !edited}
                    onClick={() => void save()}
                  >
                    保存配置
                  </button>
                  <span className="field-help">只保存在这台电脑，不会开始授权。</span>
                </div>
              )}
            </div>
          </details>
          <div className="inline-actions">
            <button
              type="button"
              className="button primary"
              disabled={busy || !clientId.trim()}
              aria-busy={authorizing}
              onClick={() => void connect()}
            >
              {authorizing ? "等待授权…" : expired ? "重新连接 X" : "连接 X"}
            </button>
            {authorizing && (
              <button
                type="button"
                className="button quiet"
                onClick={() => void api.xCancel!().catch((e) => setMessage(errorMessage(e)))}
              >
                取消授权
              </button>
            )}
          </div>
        </>
      )}
      {message && (
        <p className="x-message" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
