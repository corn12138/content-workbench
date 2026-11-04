/**
 * Backup and restore outcomes. `restoreBackup()` returning true means the native transaction
 * already replaced the data; a later list refresh failure must not be reported as a failed restore,
 * and retrying the refresh must never run the restore command again.
 */
export type DataOutcome =
  | { kind: "backup" | "restore"; state: "running" | "done" | "cancelled" }
  | { kind: "backup" | "restore"; state: "failed"; message: string }
  | { kind: "restore"; state: "refreshFailed"; message: string }
  | { kind: "restore"; state: "refreshing" };

export async function runBackup(backup: () => Promise<boolean>, describe: (error: unknown) => string): Promise<DataOutcome> {
  try {
    return { kind: "backup", state: (await backup()) ? "done" : "cancelled" };
  } catch (error) {
    return { kind: "backup", state: "failed", message: describe(error) };
  }
}

export async function runRestore(
  restore: () => Promise<boolean>,
  reload: () => Promise<void>,
  describe: (error: unknown) => string,
): Promise<DataOutcome> {
  let restored: boolean;
  try {
    restored = await restore();
  } catch (error) {
    return { kind: "restore", state: "failed", message: describe(error) };
  }
  if (!restored) return { kind: "restore", state: "cancelled" };
  return reloadAfterRestore(reload, describe);
}

/** Reads the restored data again; used for the first refresh and for every retry. */
export async function reloadAfterRestore(
  reload: () => Promise<void>,
  describe: (error: unknown) => string,
): Promise<DataOutcome> {
  try {
    await reload();
    return { kind: "restore", state: "done" };
  } catch (error) {
    return { kind: "restore", state: "refreshFailed", message: describe(error) };
  }
}
