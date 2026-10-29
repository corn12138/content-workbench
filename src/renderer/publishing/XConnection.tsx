import { useEffect, useRef, useState } from "react";
import type { XAccount } from "../../shared/contracts";
import { api, errorMessage } from "../api";

export function XConnection({
  onAccount,
}: {
  onAccount?: (account: XAccount | null) => void;
}) {
  const [account, setAccount] = useState<XAccount | null>(null);
  const [clientId, setClientId] = useState("");
  const [setupOpen, setSetupOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const active = useRef(false);
  const connecting = useRef(false);
  const locked = useRef(false);
  const handler = useRef(onAccount);
  handler.current = onAccount;
  useEffect(() => {
    active.current = true;
    let cancelled = false;
    void api.xAccount!()
      .then((value) => {
        if (cancelled) return;
        setAccount(value);
        setClientId(value.clientId);
        setSetupOpen(!value.clientId);
        handler.current?.(value);
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
    setBusy(true);
    setMessage("");
    try {
      const next = await api.xConnect!(clientId.trim());
      if (active.current) {
        setAccount(next);
        handler.current?.(next);
        setMessage("已连接 X。发布前仍会让你确认内容。");
      }
    } catch (error) {
      if (active.current) setMessage(errorMessage(error));
    } finally {
      connecting.current = false;
      locked.current = false;
      if (active.current) setBusy(false);
    }
  };
  const disconnect = async () => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await api.xDisconnect!();
      if (active.current) {
        setAccount(null);
        handler.current?.(null);
        setMessage(result);
      }
    } catch (error) {
      if (active.current) setMessage(errorMessage(error));
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  };
  const open = (url: string) =>
    void api
      .openExternal(url)
      .catch((error) => setMessage(errorMessage(error)));
  return (
    <div className="x-connection">
      <div className="setting-row">
        <div>
          <strong>
            X {account?.connected ? `· @${account.username}` : "账号"}
          </strong>
          <p>
            {loading
              ? "正在读取连接状态…"
              : account?.connected
                ? "凭证保存在系统钥匙串"
                : "通过系统浏览器授权，无需提供账号密码"}
          </p>
        </div>
        {account?.connected && (
          <button
            className="button quiet"
            disabled={busy}
            onClick={() => void disconnect()}
          >
            断开
          </button>
        )}
      </div>
      {!loading && (
        <>
          {!account?.connected && (
            <details
              className="x-setup"
              open={setupOpen}
              onToggle={(event) => setSetupOpen(event.currentTarget.open)}
            >
              <summary>首次连接：配置 X 应用</summary>
              <p>
                在 X 开发者控制台创建 Native App，开启 OAuth 2.0
                与读写权限。此步骤只需配置一次。
              </p>
              <button
                className="button quiet"
                onClick={() => open("https://console.x.com/")}
              >
                打开开发者控制台
              </button>
              <label className="field">
                Client ID（公开标识）
                <input
                  className="input"
                  value={clientId}
                  disabled={busy}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="粘贴 Native App 的 Client ID"
                />
              </label>
              <p className="muted small">
                把以下地址填入应用的 Callback URL，需完全一致：
              </p>
              <code className="x-callback">
                {account?.callback || "http://127.0.0.1:34187/oauth/x/callback"}
              </code>
              <button
                className="button quiet"
                onClick={() =>
                  void api
                    .copyText(
                      account?.callback ||
                        "http://127.0.0.1:34187/oauth/x/callback",
                    )
                    .then(() => setMessage("回调地址已复制"))
                    .catch((e) => setMessage(errorMessage(e)))
                }
              >
                复制回调地址
              </button>
              <p className="muted small">
                不填写 Client Secret、Token 或 Cookie。X API
                按量计费，连接账号和发帖前请在控制台确认额度。
              </p>
            </details>
          )}
          <div className="settings-actions">
            <button
              className="button"
              disabled={busy || !clientId.trim()}
              onClick={() => void connect()}
            >
              {busy ? "处理中…" : account?.connected ? "重新授权" : "连接 X"}
            </button>
            {busy && connecting.current && (
              <button
                className="button quiet"
                onClick={() =>
                  void api.xCancel!().catch((e) => setMessage(errorMessage(e)))
                }
              >
                取消授权
              </button>
            )}
          </div>
        </>
      )}
      {message && (
        <p className="small" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
