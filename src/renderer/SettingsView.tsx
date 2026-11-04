import { useEffect, useState } from "react";
import {
  ChevronDown,
  CircleAlert,
  CircleCheckBig,
  Download,
  FolderOpen,
  HardDrive,
  Info,
  Link2,
  LoaderCircle,
  Upload,
} from "lucide-react";
import type { AppInfo } from "../shared/contracts";
import { XConnection } from "./publishing/XConnection";
import "./publishing/publishing.css";
import { api, errorMessage } from "./api";
import { UpdateSection } from "./updates/UpdateSection";
import type { Updates } from "./updates/useUpdates";
import { reloadAfterRestore, runBackup, runRestore, type DataOutcome } from "./restoreFlow";

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
  const [infoError, setInfoError] = useState("");
  const [outcome, setOutcome] = useState<DataOutcome | null>(null);
  const busy = outcome?.state === "running" || outcome?.state === "refreshing";
  useEffect(() => {
    let active = true;
    api
      .info()
      .then((value) => {
        if (active) setInfo(value);
      })
      .catch((error) => {
        if (active) setInfoError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, []);
  const run = async (kind: "backup" | "restore") => {
    if (busy) return;
    setOutcome({ kind, state: "running" });
    // Native commands own file selection and the restore confirmation; false means the user cancelled.
    setOutcome(
      kind === "backup"
        ? await runBackup(() => api.backup(), errorMessage)
        : await runRestore(() => api.restoreBackup(), onRestored, errorMessage),
    );
  };
  const reload = async () => {
    if (busy) return;
    setOutcome({ kind: "restore", state: "refreshing" });
    setOutcome(await reloadAfterRestore(onRestored, errorMessage));
  };
  const full = !!api.library;
  return (
    <section className="page settings-page" aria-labelledby="settings-title">
      <div className="page-inner settings-inner">
        <header className="page-heading" data-tauri-drag-region>
          <div>
            <h1 id="settings-title">设置</h1>
            <p>资料保存在这台电脑上，日常使用无需账号或模型配置。</p>
          </div>
        </header>

        <section className="settings-section" aria-labelledby="settings-data">
          <h2 id="settings-data">
            <HardDrive size={18} aria-hidden="true" />
            资料与备份
          </h2>
          <p>
            {full
              ? "稿件、历史版本、图片、订阅和阅读笔记会自动保存。一个备份文件可以带走全部内容；恢复前会自动保留现有资料的完整副本。"
              : "Electron 回退版备份文字资料、历史版本和发布记录，不含图片和订阅。"}
          </p>
          <div className="setting-row">
            <div className="setting-label">
              <strong>备份与恢复</strong>
              <span>备份时选择保存位置；恢复时选择备份文件并在系统对话框中确认。</span>
            </div>
            <div className="settings-actions">
              <button
                type="button"
                className="button"
                disabled={busy}
                aria-busy={busy && outcome?.kind === "backup"}
                onClick={() => void run("backup")}
              >
                {busy && outcome?.kind === "backup" ? (
                  <LoaderCircle size={15} className="spin" aria-hidden="true" />
                ) : (
                  <Download size={15} aria-hidden="true" />
                )}
                {busy && outcome?.kind === "backup" ? "正在备份…" : "备份资料"}
              </button>
              <button
                type="button"
                className="button"
                disabled={busy}
                aria-busy={busy && outcome?.kind === "restore"}
                onClick={() => void run("restore")}
              >
                {busy && outcome?.kind === "restore" ? (
                  <LoaderCircle size={15} className="spin" aria-hidden="true" />
                ) : (
                  <Upload size={15} aria-hidden="true" />
                )}
                {busy && outcome?.kind === "restore" ? "正在恢复…" : "恢复备份"}
              </button>
            </div>
          </div>
          {outcome?.state === "done" && (
            <div className="notice success" role="status">
              <CircleCheckBig size={16} aria-hidden="true" />
              <div className="notice-body">
                <p>
                  {outcome.kind === "backup"
                    ? full
                      ? "备份文件已保存到你选择的位置，包含全部资料、图片和订阅。"
                      : "备份文件已保存到你选择的位置，包含全部文字资料和历史版本。"
                    : "资料已恢复。恢复前的资料副本已保留在资料目录中。"}
                </p>
              </div>
            </div>
          )}
          {outcome?.state === "cancelled" && (
            <p className="field-help" role="status">
              {outcome.kind === "backup" ? "已取消，没有创建备份。" : "已取消，现有资料没有改动。"}
            </p>
          )}
          {outcome?.state === "failed" && (
            <div className="notice danger" role="alert">
              <CircleAlert size={16} aria-hidden="true" />
              <div className="notice-body">
                <span className="notice-title">
                  {outcome.kind === "backup" ? "备份未完成" : "恢复未完成，现有资料没有被替换"}
                </span>
                <p>{outcome.message}</p>
                <div className="notice-actions">
                  <button type="button" className="button" onClick={() => void run(outcome.kind)}>
                    {outcome.kind === "backup" ? "重新备份" : "选择其他备份文件"}
                  </button>
                </div>
              </div>
            </div>
          )}
          {(outcome?.state === "refreshFailed" || outcome?.state === "refreshing") && (
            <div className="notice warning restore-refresh" role="alert">
              <CircleAlert size={16} aria-hidden="true" />
              <div className="notice-body">
                <span className="notice-title">资料已恢复，列表暂未刷新</span>
                {outcome.state === "refreshFailed" && <p>{outcome.message}</p>}
                <p>恢复已经完成，无需再次恢复。重新读取资料后再继续编辑。</p>
                <div className="notice-actions">
                  <button
                    type="button"
                    className="button"
                    disabled={outcome.state === "refreshing"}
                    aria-busy={outcome.state === "refreshing"}
                    onClick={() => void reload()}
                  >
                    {outcome.state === "refreshing" ? "正在读取…" : "重新读取资料"}
                  </button>
                </div>
              </div>
            </div>
          )}
          <details className="disclosure">
            <summary>
              <FolderOpen size={14} aria-hidden="true" />
              数据位置与技术信息
              <ChevronDown size={14} className="chevron" aria-hidden="true" />
            </summary>
            <div className="disclosure-body">
              {infoError ? (
                <p className="field-error">{infoError}</p>
              ) : (
                <code className="data-path">{info?.dataPath || "正在读取…"}</code>
              )}
              <p>
                {full
                  ? "图片按内容哈希保存在数据库中；备份为带版本、大小和 SHA-256 清单的 .cwb 文件。"
                  : "Electron 回退版使用独立资料目录，不能直接打开新版资料。"}
              </p>
            </div>
          </details>
        </section>

        <section className="settings-section" aria-labelledby="settings-platforms">
          <h2 id="settings-platforms">
            <Link2 size={18} aria-hidden="true" />
            平台连接
          </h2>
          <div className="setting-row">
            <div className="setting-label">
              <strong>
                掘金 <span className="badge">辅助发布</span>
              </strong>
              <span>复制正文并在系统浏览器打开掘金，沿用浏览器的登录状态，无需连接。</span>
            </div>
            <span className="badge accent">
              <CircleCheckBig size={12} aria-hidden="true" />
              可用
            </span>
          </div>
          <div className="setting-label">
            <strong>
              X <span className="badge warning">实验性</span>
            </strong>
            <span>真实账号尚未完成验收。发布前仍会让你确认内容和账号。</span>
          </div>
          {api.xAccount ? (
            <XConnection />
          ) : (
            <p className="field-help">X 授权与发布请使用 Tauri 版。</p>
          )}
        </section>

        <UpdateSection updates={updates} install={installUpdate} notify={notify} version={info?.version} />

        <p className="foot-note">
          <Info size={13} aria-hidden="true" />
          <span>
            关闭窗口会退出应用，退出前先保存修改。没有后台任务：
            {full ? "订阅只在你添加或点击“更新订阅”时联网。" : "订阅功能请使用 Tauri 版。"}
            {info?.version ? ` · 内容工作台 ${info.version} · 无 AI` : ""}
          </span>
        </p>
      </div>
    </section>
  );
}
