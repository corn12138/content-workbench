import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, CircleAlert, ExternalLink, LoaderCircle, RefreshCw, RotateCcw } from "lucide-react";
import { api, errorMessage } from "../api";
import type { Updates } from "./useUpdates";
import { updateNotices } from "./updateState";

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
  const notices = updateNotices(updates.state);
  const openBackups = () =>
    void api.openUpdateBackups?.().catch((e) => notify(errorMessage(e)));
  const openReleases = () =>
    void api.openExternal(releasePage).catch((e) => notify(errorMessage(e)));
  // Check and install results are shown on separate lines so one never reads as the other.
  const checkStatus = updates.checking
    ? "正在连接发行页…"
    : updates.state.check.error
      ? "检查未完成"
      : updates.state.check.message || (updates.automatic ? "自动更新已开启" : "自动更新已关闭");
  const stagedStatus = updates.installOnQuit
    ? `${updates.installOnQuit} 已下载并通过签名校验，将在退出时安装`
    : updates.state.downloading
      ? "正在后台下载新版本…"
      : "";
  const installStatus = updates.installing
    ? updates.progress || "正在升级…"
    : updates.state.install.error
      ? "上次升级没有完成"
      : "";
  return (
    <section className="settings-section" aria-labelledby="settings-updates">
      <h2 id="settings-updates">
        <RefreshCw size={18} aria-hidden="true" />
        应用更新
      </h2>
      <p>
        {updates.automatic
          ? "自动更新已开启：发现新版后在后台下载并校验签名，退出应用时先备份资料和旧版应用再安装；不会在你使用时自动重启。"
          : "自动更新已关闭：可以手动检查；点击升级后才会备份资料和旧版应用，再安装并重新打开。"}
      </p>
      <dl className="key-values">
        <dt>当前版本</dt>
        <dd>{version || "正在读取…"}</dd>
        <dt>可用版本</dt>
        <dd>{updates.available?.version || "—"}</dd>
        <dt>检查</dt>
        <dd role="status">{checkStatus}</dd>
        {stagedStatus && !installStatus && (
          <>
            <dt>下载</dt>
            <dd role="status">{stagedStatus}</dd>
          </>
        )}
        {installStatus && (
          <>
            <dt>升级</dt>
            <dd role="status">{installStatus}</dd>
          </>
        )}
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
            {updates.installOnQuit ? "立即重启并升级" : `升级到 ${updates.available.version}`}
          </button>
        )}
      </div>
      {notices.map((notice) => (
        <div className="notice danger update-failure" role="alert" key={notice.kind} data-kind={notice.kind}>
          <CircleAlert size={16} aria-hidden="true" />
          <div className="notice-body">
            <span className="notice-title">{notice.title}</span>
            <p>{notice.detail}</p>
            {notice.guidance && <p>{notice.guidance}</p>}
            <div className="notice-actions">
              <button
                type="button"
                className="button"
                disabled={updates.checking || updates.installing || (notice.kind === "install" && !updates.available)}
                onClick={() => (notice.kind === "install" ? install() : void updates.check())}
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
      ))}
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
          <strong>自动更新</strong>
          <span>每天最多检查一次，仅连接本项目发行页；下载的更新包须通过签名校验，在你退出应用时安装。不会上传稿件。</span>
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
