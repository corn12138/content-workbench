import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { api, errorMessage } from "../api";
import type { Updates } from "./useUpdates";

export function UpdateSection({
  updates,
  install,
  notify,
}: {
  updates: Updates;
  install: () => void;
  notify: (text: string) => void;
}) {
  if (!api.checkUpdate) return null;
  return (
    <section className="settings-section">
      <h2>应用更新</h2>
      <p>
        发现新版时提示你，点击升级后自动备份资料和旧版应用，再安装并重新打开。
      </p>
      <label>
        <input
          type="checkbox"
          checked={updates.automatic}
          onChange={(e) => updates.setAutomatic(e.target.checked)}
        />{" "}
        自动检查更新
      </label>
      <p className="muted small">
        每天最多自动检查一次，仅连接本项目发行页；不会上传稿件或自动安装。
      </p>
      <div className="settings-actions">
        <button
          className="button"
          disabled={updates.checking || updates.installing}
          onClick={() => void updates.check()}
        >
          {updates.checking ? "检查中…" : "检查更新"}
        </button>
        {updates.available && (
          <button
            className="button primary"
            disabled={updates.checking || updates.installing}
            onClick={install}
          >
            升级到 {updates.available.version}
          </button>
        )}
        <button
          className="button quiet"
          onClick={() =>
            void api.openUpdateBackups?.().catch((e) => notify(errorMessage(e)))
          }
        >
          查看升级备份
        </button>
      </div>
      {updates.message && <p role="status">{updates.message}</p>}
      {updates.available?.notes && (
        <details>
          <summary>这次更新了什么</summary>
          <p style={{ whiteSpace: "pre-wrap" }}>{updates.available.notes}</p>
        </details>
      )}
      <button
        className="button quiet"
        onClick={() =>
          void api
            .openExternal(
              "https://github.com/corn12138/content-workbench/releases",
            )
            .catch((e) => notify(errorMessage(e)))
        }
      >
        查看开源发行页
      </button>
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
      <p className="muted small">
        请保持应用打开。升级前的资料和旧版会保留在“升级备份”。
      </p>
    </dialog>,
    document.body,
  );
}
