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
import type { AppInfo, BackupPreview, BackupReceipt } from "../shared/contracts";
import { backupSummaryLines, formatBytes } from "./backupText";
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
  const [receipt, setReceipt] = useState<BackupReceipt | null>(null);
  const [revealError, setRevealError] = useState("");
  const [preview, setPreview] = useState<BackupPreview | null>(null);
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
    void api.lastBackup?.().then(
      (value) => active && setReceipt(value),
      () => {},
    );
    return () => {
      active = false;
    };
  }, []);
  const run = async (kind: "backup" | "restore") => {
    if (busy) return;
    setRevealError("");
    if (kind === "backup" && api.createBackup) {
      setOutcome({ kind, state: "running" });
      // The receipt is returned only after the file is written; cancel and failure keep the previous one.
      let written: BackupReceipt | null = null;
      const next = await runBackup(async () => {
        written = await api.createBackup!();
        return !!written;
      }, errorMessage);
      if (written) setReceipt(written);
      setOutcome(next);
      return;
    }
    if (kind === "restore" && api.inspectBackup) {
      // Preflight: choose and validate the file without changing anything, then confirm inline.
      setOutcome({ kind, state: "running" });
      setPreview(null);
      try {
        const value = await api.inspectBackup();
        if (!value) return setOutcome({ kind, state: "cancelled" });
        setPreview(value);
        setOutcome(null);
      } catch (error) {
        setOutcome({ kind, state: "failed", message: errorMessage(error) });
      }
      return;
    }
    setOutcome({ kind, state: "running" });
    // Older bridges own file selection and the restore confirmation; false means the user cancelled.
    setOutcome(
      kind === "backup"
        ? await runBackup(() => api.backup(), errorMessage)
        : await runRestore(() => api.restoreBackup(), onRestored, errorMessage),
    );
  };
  const confirmRestore = async () => {
    if (!preview || busy) return;
    const token = preview.token;
    setPreview(null);
    setOutcome({ kind: "restore", state: "running" });
    setOutcome(await runRestore(() => api.restoreInspected!(token), onRestored, errorMessage));
  };
  const cancelRestore = () => {
    setPreview(null);
    setOutcome({ kind: "restore", state: "cancelled" });
    void api.cancelRestore?.().catch(() => {});
  };
  const reveal = () => {
    setRevealError("");
    void api.revealBackup?.().catch((error) => {
      setRevealError(errorMessage(error));
      setReceipt((current) => (current ? { ...current, exists: false } : current));
    });
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
              <span>
                {api.inspectBackup
                  ? "备份时选择保存位置；恢复时先选择备份文件，核对内容后再确认。"
                  : "备份时选择保存位置；恢复时选择备份文件并在系统对话框中确认。"}
              </span>
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
                {busy && outcome?.kind === "restore" ? (preview ? "正在恢复…" : "正在读取…") : "恢复备份"}
              </button>
            </div>
          </div>
          {receipt && (
            <div className="backup-receipt" role="status">
              <span>
                上次备份：<strong>{receipt.filename}</strong> · {formatBytes(receipt.size)} ·{" "}
                {new Date(receipt.savedAt).toLocaleString("zh-CN")}
              </span>
              {receipt.exists ? (
                api.revealBackup && (
                  <button type="button" className="link-button" onClick={reveal}>
                    在访达中显示
                  </button>
                )
              ) : (
                <span className="field-help">文件已被移动或删除，需要时请重新备份。</span>
              )}
              {revealError && <span className="field-error">{revealError}</span>}
            </div>
          )}
          {preview && (
            <div className="notice warning restore-preview" role="alert">
              <CircleAlert size={16} aria-hidden="true" />
              <div className="notice-body">
                <span className="notice-title">用这份备份恢复本地资料？</span>
                <p>
                  {preview.filename} · {formatBytes(preview.size)} · {preview.summary.format}
                </p>
                <ul className="restore-counts">
                  {backupSummaryLines(preview.summary).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p>
                  恢复会用这份备份替换当前全部本地资料。替换前会先在资料目录保存现有资料的完整副本；线上文章、X
                  授权和发布去重记录不受影响。
                </p>
                <div className="notice-actions">
                  <button type="button" className="button primary" onClick={() => void confirmRestore()}>
                    恢复这份备份
                  </button>
                  <button type="button" className="button quiet" onClick={cancelRestore}>
                    取消
                  </button>
                </div>
              </div>
            </div>
          )}
          {outcome?.state === "done" && (
            <div className="notice success" role="status">
              <CircleCheckBig size={16} aria-hidden="true" />
              <div className="notice-body">
                <p>
                  {outcome.kind === "backup"
                    ? full
                      ? "备份已完成，包含稿件与历史、图片、订阅与笔记、发布记录、发布准备和反馈记录。"
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
            <span>
              不需要开发者应用也能用网页辅助发布（复制、打开 X、手动记录链接）。官方 API 发布与读取数据为实验性，真实账号尚未验收；发布前仍会让你确认内容和账号。
            </span>
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
