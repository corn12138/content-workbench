/**
 * Where the user stopped reading. This is a view preference kept in local storage, separate from
 * articles and notes: it never creates a content revision and is not part of content backups.
 */
export interface ReadingPosition {
  id: string;
  /** Fraction of the scrollable height, 0–1; re-applied with bounds after layout changes. */
  ratio: number;
}

const key = "workbench-reading-position";

export function loadPosition(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): ReadingPosition | null {
  try {
    const value = JSON.parse(storage?.getItem(key) ?? "null");
    if (
      value &&
      typeof value.id === "string" &&
      value.id.length <= 64 &&
      typeof value.ratio === "number" &&
      Number.isFinite(value.ratio)
    )
      return { id: value.id, ratio: Math.min(1, Math.max(0, value.ratio)) };
  } catch {
    /* A damaged preference only loses the position. */
  }
  return null;
}

export function savePosition(
  position: ReadingPosition,
  storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage,
) {
  try {
    storage?.setItem(key, JSON.stringify({ id: position.id, ratio: Math.round(position.ratio * 1000) / 1000 }));
  } catch {
    /* Reading continues to work without a stored position. */
  }
}

/** Scroll offset for a stored ratio, bounded by the current content height. */
export function offsetFor(ratio: number, scrollHeight: number, clientHeight: number) {
  const range = Math.max(0, scrollHeight - clientHeight);
  return Math.round(Math.min(1, Math.max(0, ratio)) * range);
}

/** Throttled writer: at most one write per interval and only after a meaningful change. */
export function positionWriter(write: (position: ReadingPosition) => void, interval = 1000) {
  let last: ReadingPosition | null = null;
  let pending: ReadingPosition | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const commit = () => {
    timer = null;
    if (!pending) return;
    if (!last || last.id !== pending.id || Math.abs(last.ratio - pending.ratio) >= 0.01) {
      last = pending;
      write(pending);
    }
    pending = null;
  };
  return {
    update(position: ReadingPosition) {
      pending = position;
      if (!timer) timer = setTimeout(commit, interval);
    },
    flush() {
      if (timer) clearTimeout(timer);
      commit();
    },
  };
}
