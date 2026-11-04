import type { PublishReceipt } from "../../shared/contracts";

/**
 * X publishing outcome, kept apart from secondary actions (open profile, open/copy the work).
 * A failed secondary action must never downgrade a receipt or an unknown result.
 */
export type XOutcome =
  | { kind: "idle" }
  | { kind: "publishing" }
  | { kind: "published"; receipt: PublishReceipt }
  /** Request may have reached X; the native journal blocks resending until the user verifies. */
  | { kind: "uncertain"; message: string }
  /** X answered with a definite client error; nothing was published. */
  | { kind: "rejected"; message: string }
  /** Failed before or around sending for a local reason; phrased neutrally. */
  | { kind: "failed"; message: string };

export interface XPublishState {
  outcome: XOutcome;
  /** Error from a secondary action; shown on its own and never affects `outcome`. */
  actionError: string;
}

export type XPublishEvent =
  | { type: "publish" }
  | { type: "published"; receipt: PublishReceipt }
  | { type: "publishFailed"; message: string }
  | { type: "actionFailed"; message: string }
  | { type: "clearActionError" }
  | { type: "edited" };

// Fixed 4xx messages from src-tauri/src/publishing/http.rs `error()`. x_publish returns them for a
// definite 4xx answer to the publish request (journal marked rejected) or to the token refresh that
// precedes it (nothing sent); either way X refused and nothing was published.
// "X 服务暂时不可用，请稍后重试。" is deliberately absent: the same text covers 5xx answers to the token
// refresh, which are server failures rather than refusals, so it is reported neutrally.
const providerRejections = new Set([
  "X 授权已失效，请重新连接账号。",
  "X API 额度不足，请在开发者控制台检查费用与余额。",
  "X 拒绝访问，请检查应用写入权限、账号和 API 额度。",
  "X 请求过于频繁，请稍后再试。",
  "X 未接受请求，请检查应用配置或发布内容。",
]);

/** Unknown outcomes are reported with an instruction to verify on X (journal claims, timeouts, incomplete receipts). */
export const uncertainPublishError = (message: string) => message.includes("核实");

export function classifyPublishError(message: string): XOutcome {
  if (uncertainPublishError(message)) return { kind: "uncertain", message };
  if (providerRejections.has(message)) return { kind: "rejected", message };
  return { kind: "failed", message };
}

export const initialXPublishState: XPublishState = { outcome: { kind: "idle" }, actionError: "" };

export function xPublishReducer(state: XPublishState, event: XPublishEvent): XPublishState {
  switch (event.type) {
    case "publish":
      // Only a state that permits sending can start another request.
      return canSend(state.outcome) ? { outcome: { kind: "publishing" }, actionError: "" } : state;
    case "published":
      return { outcome: { kind: "published", receipt: event.receipt }, actionError: "" };
    case "publishFailed":
      return { outcome: classifyPublishError(event.message), actionError: "" };
    case "actionFailed":
      return { ...state, actionError: event.message };
    case "clearActionError":
      return { ...state, actionError: "" };
    case "edited":
      // Editing after a definite rejection or local failure returns to a fresh attempt; receipts and unknown results stay.
      return state.outcome.kind === "rejected" || state.outcome.kind === "failed"
        ? { outcome: { kind: "idle" }, actionError: state.actionError }
        : state;
  }
}

/** Whether the UI may offer a send action for this outcome. */
export function canSend(outcome: XOutcome) {
  return outcome.kind === "idle" || outcome.kind === "rejected" || outcome.kind === "failed";
}

/** Text stays editable only while another attempt is legitimate. */
export const textLocked = (outcome: XOutcome) => !canSend(outcome);
