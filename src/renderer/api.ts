import type { WorkbenchAPI } from "../shared/contracts";

// There is deliberately no browser/localStorage fallback: a preview must not impersonate the desktop database.
export const api = window.workbench as WorkbenchAPI;
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "操作未完成，请重试。";
