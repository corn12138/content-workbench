import { useEffect, useState } from "react";
import { Download, Upload, HardDrive, ArrowUpRight } from "lucide-react";
import type { AppInfo } from "../shared/contracts";
import { XConnection } from "./publishing/XConnection";
import "./publishing/publishing.css";
import { api, errorMessage } from "./api";
import { UpdateSection } from "./updates/UpdateSection";
import type { Updates } from "./updates/useUpdates";

export function SettingsView({
  onRestored,
  notify,
  updates,
  installUpdate,
}: {
  onRestored: () => Promise<void>;
  notify: (message: string) => void;
  updates: Updates;
  installUpdate: () => void;
}) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    api
      .info()
      .then((value) => {
        if (active) setInfo(value);
      })
      .catch((error) => {
        if (active) notify(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [notify]);
  const run = async (kind: "backup" | "restore") => {
    setBusy(true);
    try {
      const done =
        kind === "backup" ? await api.backup() : await api.restoreBackup();
      if (done) {
        if (kind === "restore") await onRestored();
        notify(
          kind === "backup"
            ? api.library
              ? "全部资料、图片和订阅已备份"
              : "全部文字资料和历史版本已备份"
            : "资料已恢复",
        );
      }
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="settings-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">按你的习惯</p>
          <h1>设置</h1>
          <p className="muted">资料在本机，无需注册账号或配置 AI。</p>
        </div>
      </header>
      <section className="settings-section">
        <div className="settings-section-title">
          <HardDrive size={19} />
          <h2>本地资料</h2>
        </div>
        <p>草稿、历史版本、发布链接和阅读笔记会自动保存。</p>
        <div className="settings-actions">
          <button
            className="button"
            disabled={busy}
            onClick={() => void run("backup")}
          >
            <Download size={16} />
            备份资料
          </button>
          <button
            className="button quiet"
            disabled={busy}
            onClick={() => void run("restore")}
          >
            <Upload size={16} />
            恢复备份
          </button>
        </div>
        <p className="muted small">
          {api.library
            ? "一个备份文件带走文字、历史版本、已保存的图片、订阅和阅读笔记。恢复前会自动保留完整副本。"
            : "Electron 回退版备份文字资料，不含图片和订阅。"}
        </p>
        <details>
          <summary>查看数据位置</summary>
          <code className="data-path">{info?.dataPath || "正在读取…"}</code>
        </details>
      </section>
      <section className="settings-section">
        <h2>平台连接</h2>
        <div className="setting-row">
          <div>
            <strong>掘金</strong>
            <p>复制并打开掘金，沿用系统浏览器的登录状态。</p>
          </div>
          <span className="badge">辅助发布</span>
        </div>
        {api.xAccount ? (
          <XConnection />
        ) : (
          <p className="muted">X 授权与发布请使用 Tauri 版。</p>
        )}
      </section>
      <section className="settings-section">
        <h2>运行方式</h2>
        <p>关闭窗口会退出应用，退出前先保存修改。当前没有后台采集任务。</p>
        <p className="muted small">
          {api.library
            ? "订阅仅在添加或点击“更新订阅”时联网。关闭应用后不会继续更新。"
            : "订阅功能请使用 Tauri 版。"}
        </p>
      </section>
      <UpdateSection
        updates={updates}
        install={installUpdate}
        notify={notify}
      />
      <footer className="settings-footer">
        内容工作台 {info?.version || "0.1.0"} · 本地基础版{" "}
        <ArrowUpRight size={13} />
        <span>无 AI</span>
      </footer>
    </section>
  );
}
