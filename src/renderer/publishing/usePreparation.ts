import { useCallback, useEffect, useRef, useState } from "react";
import type { Draft, Platform, Preparation } from "../../shared/contracts";
import { api, errorMessage } from "../api";
import { initialLocal, type Local, type PlatformDraft } from "./preparationState";
export { isStale } from "./preparationState";

/**
 * Keeps unfinished publishing preparation (edited X text, mode, a link not yet recorded) in the
 * database, bound to the draft revision it was checked against. Saves are serialized and joined by
 * the app's navigation/close barrier, so leaving or quitting waits for them; a failed save keeps the
 * input and blocks leaving, like the draft editor.
 */
export function usePreparation(
  draft: Draft,
  saved: Preparation[],
  registerFlush: (flush: () => Promise<void>) => void,
) {
  const [local, setLocal] = useState<Local>(() => initialLocal(draft, saved));
  const [error, setError] = useState("");
  const latest = useRef(local);
  const dirty = useRef(new Set<Platform>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const draftId = draft.id;

  const flush = useCallback((): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const work = queue.current
      .catch(() => {})
      .then(async () => {
        if (!api.savePreparation) {
          dirty.current.clear();
          return;
        }
        while (dirty.current.size) {
          const [platform] = dirty.current;
          dirty.current.delete(platform);
          const value = latest.current[platform];
          try {
            await api.savePreparation({
              draftId,
              platform,
              revision: value.revision,
              xText: platform === "x" ? value.xText : null,
              xMode: platform === "x" ? value.xMode : null,
              pendingUrl: value.pendingUrl,
            });
            if (mounted.current) setError("");
          } catch (cause) {
            // Keep it dirty so the next attempt (retry, navigation, quit) saves the same input.
            dirty.current.add(platform);
            if (mounted.current) setError(errorMessage(cause));
            throw cause;
          }
        }
      });
    queue.current = work;
    return work;
  }, [draftId]);

  useEffect(() => {
    mounted.current = true;
    registerFlush(flush);
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [flush, registerFlush]);

  const write = (platform: Platform, next: PlatformDraft, immediate = false) => {
    latest.current = { ...latest.current, [platform]: next };
    setLocal(latest.current);
    dirty.current.add(platform);
    if (timer.current) clearTimeout(timer.current);
    if (immediate) void flush().catch(() => {});
    else timer.current = setTimeout(() => void flush().catch(() => {}), 500);
  };

  // Image preparation moves preparations bound to the previous revision along natively; mirror it.
  const previousRevision = useRef(draft.revision);
  useEffect(() => {
    const before = previousRevision.current;
    previousRevision.current = draft.revision;
    if (before === draft.revision) return;
    const next = { ...latest.current };
    for (const platform of ["x", "juejin"] as const)
      if (next[platform].revision === before) next[platform] = { ...next[platform], revision: draft.revision };
    latest.current = next;
    setLocal(next);
  }, [draft.revision]);

  return {
    local,
    error,
    flush,
    update(platform: Platform, patch: Partial<Omit<PlatformDraft, "touched" | "revision">>) {
      write(platform, { ...latest.current[platform], ...patch, touched: true });
    },
    /** Mode alone is a view choice; it is persisted only together with real preparation input. */
    setMode(platform: Platform, mode: "web" | "api") {
      const current = latest.current[platform];
      if (current.touched) write(platform, { ...current, xMode: mode });
      else {
        latest.current = { ...latest.current, [platform]: { ...current, xMode: mode } };
        setLocal(latest.current);
      }
    },
    /** The user re-checked the preparation against the current draft. */
    confirmCurrent(platform: Platform) {
      write(platform, { ...latest.current[platform], revision: draft.revision, touched: true }, true);
    },
    /** Finished (recorded) preparations are removed; failures only leave a stale entry behind. */
    async finish(platform: Platform) {
      dirty.current.delete(platform);
      const reset = initialLocal(draft, [])[platform];
      latest.current = { ...latest.current, [platform]: { ...reset, xMode: latest.current[platform].xMode } };
      setLocal(latest.current);
      await api.clearPreparation?.(draft.id, platform).catch(() => {});
    },
  };
}

export type PreparationState = ReturnType<typeof usePreparation>;
