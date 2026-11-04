import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, CircleAlert, ExternalLink, LoaderCircle, RefreshCw, RotateCcw } from "lucide-react";
import { api, errorMessage } from "../api";
import type { Updates } from "./useUpdates";
import { updateFailureNotice } from "./updateState";

const releasePage = "https://github.com/corn12138/content-workbench/releases";

export function UpdateSection({
  updates,
  install,
  notify,
  version,
}: {
  updates: Updates;
  install: () => void;
  notify: (text: string) => void;
  version?: string;
}) {
  if (!api.checkUpdate) return null;
  const notice = updateFailureNotice(updates);
  const openBackups = () =>
    void api.openUpdateBackups?.().catch((e) => notify(errorMessage(e)));
  const openReleases = () =>
    void api.openExternal(releasePage).catch((e) => notify(errorMessage(e)));
  const status = updates.checking
    ? "正在连接发行页…"
    : updates.installing
      ? "正在备份资料和旧版应用，然后安装…"
      : updates.error
        ? updates.error === "install"
          ? "升级没有完成"
          : "检查未完成"
        : updates.message || (updates.automatic ? "自动检查已开启" : "自动检查已关闭");
  return (
    <section className="settings-section" aria-labelledby="settings-updates">
      <h2 id="settings-updates">
        <RefreshCw size={18} aria-hidden="true" />
        应用更新
      </h2>
      <p>发现新版时提示你；只有点击升级后，才会自动备份资料和旧版应用，再安装并重新打开。</p>
      <dl className="key-values">
        <dt>当前版本</dt>
        <dd>{version || "正在读取…"}</dd>
        <dt>可用版本</dt>
        <dd>{updates.available?.version || "—"}</dd>
        <dt>状态</dt>
        <dd role="status">{status}</dd>
      </dl>
      <div className="settings-actions">
        <button
          type="button"
          className="button"
          disabled={updates.checking || updates.installing}
          aria-busy={updates.checking}
          onClick={() => void updates.check()}
        >
          {updates.checking && <LoaderCircle size={14} className="spin" aria-hidden="true" />}
          {updates.checking ? "检查中…" : "检查更新"}
        </button>
        {updates.available && (
          <button
            type="button"
            className="button primary"
            disabled={updates.checking || updates.installing}
            onClick={install}
          >
            升级到 {updates.available.version}
          </button>
        )}
      </div>
      {notice && (
        <div className="notice danger update-failure" role="alert">
          <CircleAlert size={16} aria-hidden="true" />
          <div className="notice-body">
            <span className="notice-title">{notice.title}</span>
            <p>{notice.detail}</p>
            {notice.showBackups && <p>升级前已保留资料和旧版应用的副本，可在“升级备份”中查看或回退。</p>}
            <div className="notice-actions">
              <button
                type="button"
                className="button"
                onClick={() => (updates.error === "install" ? install() : void updates.check())}
              >
                {notice.retryLabel}
              </button>
              {notice.showBackups && (
                <button type="button" className="button quiet" onClick={openBackups}>
                  <RotateCcw size={13} aria-hidden="true" />
                  查看升级备份
                </button>
              )}
              <button type="button" className="button quiet" onClick={openReleases}>
                <ExternalLink size={13} aria-hidden="true" />
                打开发行页
              </button>
            </div>
          </div>
        </div>
      )}
      {updates.available?.notes && (
        <details className="disclosure">
          <summary>
            这次更新了什么
            <ChevronDown size={14} className="chevron" aria-hidden="true" />
          </summary>
          <div className="disclosure-body release-notes">{updates.available.notes}</div>
        </details>
      )}
      <label className="switch" htmlFor="auto-update">
        <span className="setting-label">
          <strong>自动检查更新</strong>
          <span>每天最多自动检查一次，仅连接本项目发行页；不会上传稿件或自动安装。</span>
        </span>
        <input
          id="auto-update"
          type="checkbox"
          role="switch"
          checked={updates.automatic}
          onChange={(e) => updates.setAutomatic(e.target.checked)}
        />
      </label>
      <div className="setting-row">
        <div className="setting-label">
          <strong>回退到旧版</strong>
          <span>每次升级前都会自动备份资料和旧版应用。需要回退时，从升级备份中打开旧版。</span>
        </div>
        <div className="settings-actions">
          <button
            type="button"
            className="button"
            onClick={openBackups}
          >
            <RotateCcw size={14} aria-hidden="true" />
            查看升级备份
          </button>
          <button type="button" className="button quiet" onClick={openReleases}>
            <ExternalLink size={13} aria-hidden="true" />
            开源发行页
          </button>
        </div>
      </div>
    </section>
  );
}

export function UpdateProgress({ updates }: { updates: Updates }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (updates.installing) dialog.current?.showModal();
    else dialog.current?.close();
  }, [updates.installing]);
  return createPortal(
    <dialog
      ref={dialog}
      className="update-progress"
      onCancel={(event) => event.preventDefault()}
      aria-labelledby="update-title"
    >
      <h2 id="update-title">正在升级</h2>
      <p role="status">{updates.progress}</p>
      <p className="muted small">请保持应用打开。升级前的资料和旧版会保留在“升级备份”。</p>
    </dialog>,
    document.body,
  );
}
