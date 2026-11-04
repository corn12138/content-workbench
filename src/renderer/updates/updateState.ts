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
  retryLabel: string;
  showBackups: boolean;
}

/** Copy for the failure notice; never claims more than the native result proves. */
export function updateFailureNotice(state: UpdateState): UpdateNotice | null {
  if (state.error === "check")
    return { title: "检查更新未完成", detail: state.message, retryLabel: "重新检查", showBackups: false };
  if (state.error === "install")
    return {
      title: "升级没有完成",
      detail: state.message,
      retryLabel: "重试升级",
      // Upgrade backups are made before installing; they are the recovery path whatever stage failed.
      showBackups: true,
    };
  return null;
}
