import type { Reading } from "../../shared/contracts";

/**
 * The next article after `currentId` within the current search/source/filter results, following the
 * stable list order. If the current article dropped out of the results (for example it was just
 * marked read under "未读"), the search continues from its position in the full ordered list, so the
 * user never jumps outside the filter or back to the top.
 */
export function nextReading(
  ordered: Reading[],
  visible: Reading[],
  currentId: string | undefined,
  unreadOnly: boolean,
): Reading | null {
  const allowed = new Set(visible.map((item) => item.id));
  const start = currentId ? ordered.findIndex((item) => item.id === currentId) : -1;
  for (let index = start + 1; index < ordered.length; index++) {
    const item = ordered[index];
    if (allowed.has(item.id) && item.id !== currentId && (!unreadOnly || !item.read)) return item;
  }
  return null;
}
