import type { UpdateProgress } from "../../shared/contracts";

export type InstallStage = UpdateProgress["stage"];

/**
 * Update state. Check results and install results are stored apart: a later successful check (manual
 * or background) can never overwrite or soften an unresolved installation failure, and the UI only
 * says a backup exists after the native side reported that stage.
 */
export interface UpdateState {
  available: { version: string; notes: string } | null;
  checking: boolean;
  /** Version downloaded and signature-verified in the background, ready to install on quit. */
  staged: string | null;
  downloading: boolean;
  /** Set after install on quit failed, so the next quit closes normally instead of retrying. */
  skipInstallOnQuit: boolean;
  check: { message: string; error: string | null };
  install: {
    running: boolean;
    stage: InstallStage | null;
    progress: string;
    /** True only after the native "backedUp" event for the current attempt. */
    backedUp: boolean;
    error: string | null;
  };
}

export type UpdateEvent =
  | { type: "checkStart"; quiet: boolean }
  | { type: "checkSucceeded"; value: { version: string; notes: string } | null }
  | { type: "checkFailed"; message: string; quiet: boolean }
  | { type: "downloadStart" }
  | { type: "downloadSucceeded"; version: string }
  | { type: "downloadFailed" }
  | { type: "quitInstallFailed"; message: string }
  | { type: "installStart" }
  | { type: "installProgress"; progress: UpdateProgress }
  | { type: "installFailed"; message: string }
  | { type: "installSettled" };

export const initialUpdateState: UpdateState = {
  available: null,
  checking: false,
  staged: null,
  downloading: false,
  skipInstallOnQuit: false,
  check: { message: "", error: null },
  install: { running: false, stage: null, progress: "", backedUp: false, error: null },
};

export function updateReducer(state: UpdateState, event: UpdateEvent): UpdateState {
  switch (event.type) {
    case "checkStart":
      return event.quiet
        ? { ...state, checking: true }
        : { ...state, checking: true, check: { message: "", error: null } };
    case "checkSucceeded":
      // Replaces an earlier check failure only; the install result is untouched.
      return {
        ...state,
        checking: false,
        available: event.value,
        // A different (newer) version makes an earlier staged download irrelevant.
        staged: event.value && state.staged === event.value.version ? state.staged : null,
        check: {
          message: event.value ? `发现新版本 ${event.value.version}` : "当前已是最新版本",
          error: null,
        },
      };
    case "checkFailed":
      // Background failures stay quiet and never overwrite what the user is looking at.
      return event.quiet
        ? { ...state, checking: false }
        : { ...state, checking: false, check: { message: "", error: event.message } };
    case "downloadStart":
      return { ...state, downloading: true };
    case "downloadSucceeded":
      return {
        ...state,
        downloading: false,
        staged: state.available?.version === event.version ? event.version : state.staged,
      };
    case "downloadFailed":
      // Quiet: the manual "upgrade" path still works and downloads again when clicked.
      return { ...state, downloading: false };
    case "quitInstallFailed":
      return {
        ...state,
        skipInstallOnQuit: true,
        staged: null,
        install: { ...state.install, running: false, error: event.message },
      };
    case "installStart":
      return {
        ...state,
        install: { running: true, stage: null, progress: "正在准备升级…", backedUp: false, error: null },
      };
    case "installProgress":
      if (!state.install.running) return state;
      return {
        ...state,
        install: {
          ...state.install,
          stage: event.progress.stage,
          progress: event.progress.message,
          backedUp: state.install.backedUp || event.progress.stage === "backedUp",
        },
      };
    case "installFailed":
      return { ...state, install: { ...state.install, running: false, error: event.message } };
    case "installSettled":
      return { ...state, install: { ...state.install, running: false } };
  }
}

const stageLabel: Record<InstallStage, string> = {
  download: "下载更新包",
  verify: "校验签名",
  backup: "备份资料和旧版应用",
  backedUp: "安装前（备份已完成）",
  install: "安装",
  restart: "重新打开",
  unknown: "升级",
};

/** The version to install when the user quits, if automatic updates staged one; never after an unresolved install failure. */
export function installOnQuit(state: UpdateState, automatic: boolean) {
  return automatic && state.staged && !state.skipInstallOnQuit && !state.install.running && !state.install.error
    ? state.staged
    : null;
}

export interface UpdateNotice {
  kind: "check" | "install";
  title: string;
  detail: string;
  /** Fixed guidance; states only what the received stage events prove. */
  guidance: string;
  retryLabel: string;
  showBackups: boolean;
}

export function installFailureNotice(state: UpdateState): UpdateNotice | null {
  const { install } = state;
  if (!install.error) return null;
  const reached = install.stage ? `停在“${stageLabel[install.stage]}”阶段。` : "在开始下载前停止。";
  return {
    kind: "install",
    title: "升级没有完成",
    detail: install.error,
    guidance: install.backedUp
      ? `${reached}安装前已建立升级备份，升级前的资料和旧版应用保存在“升级备份”中。`
      : `${reached}没有收到备份完成的结果；是否有备份以“升级备份”文件夹为准。`,
    retryLabel: "重试升级",
    showBackups: true,
  };
}

export function checkFailureNotice(state: UpdateState): UpdateNotice | null {
  if (!state.check.error) return null;
  return {
    kind: "check",
    title: "检查更新未完成",
    detail: state.check.error,
    guidance: "",
    retryLabel: "重新检查",
    showBackups: false,
  };
}

/** Notices to show, install first; both can be present at once and never merge. */
export function updateNotices(state: UpdateState): UpdateNotice[] {
  return [installFailureNotice(state), checkFailureNotice(state)].filter(
    (notice): notice is UpdateNotice => !!notice,
  );
}
