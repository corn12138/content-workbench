/**
 * Update check/install state. A failed install is reported neutrally: the native command only
 * guarantees that a pre-upgrade copy was kept, not that nothing was changed.
 */
export interface UpdateState {
  available: { version: string; notes: string } | null;
  checking: boolean;
  installing: boolean;
  message: string;
  error: "check" | "install" | null;
}

export type UpdateEvent =
  | { type: "checkStart"; quiet: boolean }
  | { type: "checkSucceeded"; value: { version: string; notes: string } | null }
  | { type: "checkFailed"; message: string; quiet: boolean }
  | { type: "installStart" }
  | { type: "installFailed"; message: string }
  | { type: "installSettled" };

export const initialUpdateState: UpdateState = {
  available: null,
  checking: false,
  installing: false,
  message: "",
  error: null,
};

export function updateReducer(state: UpdateState, event: UpdateEvent): UpdateState {
  switch (event.type) {
    case "checkStart":
      return event.quiet
        ? { ...state, checking: true }
        : { ...state, checking: true, message: "", error: state.error === "install" ? state.error : null };
    case "checkSucceeded":
      // A successful check (manual or background) replaces any earlier check failure.
      return {
        ...state,
        checking: false,
        available: event.value,
        message: event.value ? `发现新版本 ${event.value.version}` : "当前已是最新版本",
        error: state.error === "check" ? null : state.error,
      };
    case "checkFailed":
      // Background failures stay quiet and never overwrite what the user is looking at.
      return event.quiet
        ? { ...state, checking: false }
        : { ...state, checking: false, message: event.message, error: "check" };
    case "installStart":
      return { ...state, installing: true, error: null };
    case "installFailed":
      return { ...state, installing: false, message: event.message, error: "install" };
    case "installSettled":
      return { ...state, installing: false };
  }
}

export interface UpdateNotice {
  title: string;
  detail: string;
  /** Fixed guidance shown with the native message; must hold whichever stage failed. */
  guidance: string;
  retryLabel: string;
  showBackups: boolean;
}

/** Copy for the failure notice; never claims more than the native result proves. */
export function updateFailureNotice(state: UpdateState): UpdateNotice | null {
  if (state.error === "check")
    return { title: "检查更新未完成", detail: state.message, guidance: "", retryLabel: "重新检查", showBackups: false };
  if (state.error === "install")
    return {
      title: "升级没有完成",
      detail: state.message,
      // install_update can fail before or after update_backup::prepare (version, download, signature,
      // backup or install stage), so whether a backup exists is left to the native message and the folder.
      guidance: "升级只会在备份资料和旧版应用之后才开始安装。是否已经建立备份以上方说明为准，也可以在“升级备份”中查看。",
      retryLabel: "重试升级",
      showBackups: true,
    };
  return null;
}
