import type { Draft, Platform, Preparation } from "../../shared/contracts";
import { initialXText } from "./text";

export interface PlatformDraft {
  /** Revision the user's preparation was checked against. */
  revision: number;
  xText: string;
  xMode: "web" | "api" | null;
  pendingUrl: string;
  /** True once anything was entered here; untouched platforms are never persisted. */
  touched: boolean;
}

export type Local = Record<Platform, PlatformDraft>;

export function initialLocal(draft: Draft, saved: Preparation[]): Local {
  const find = (platform: Platform) => saved.find((item) => item.platform === platform);
  const x = find("x");
  const juejin = find("juejin");
  return {
    x: {
      revision: x?.revision ?? draft.revision,
      xText: x?.xText ?? initialXText(draft.title, draft.body),
      xMode: x?.xMode ?? null,
      pendingUrl: x?.pendingUrl ?? "",
      touched: !!x,
    },
    juejin: {
      revision: juejin?.revision ?? draft.revision,
      xText: "",
      xMode: null,
      pendingUrl: juejin?.pendingUrl ?? "",
      touched: !!juejin,
    },
  };
}

/** A preparation is stale when the draft changed after the user last checked it. */
export const isStale = (local: PlatformDraft, draft: Draft) =>
  local.touched && local.revision !== draft.revision;

