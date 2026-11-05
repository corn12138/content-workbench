import {
  app,
  clipboard,
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
} from "electron";
import { readFile, writeFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { z } from "zod";
import type { WorkbenchStore } from "../core/store";

const id = z.string().min(1).max(200);
const revision = z.number().int().positive();
const text = z.string().max(2_000_000);

export function registerIPC(
  store: WorkbenchStore,
  win: BrowserWindow,
  dataPath: string,
  finishClose: () => void,
) {
  const handle = (name: string, action: (...args: any[]) => unknown) => {
    ipcMain.handle(`workbench:${name}`, async (event, ...args) => {
      try {
        const url = new URL(event.senderFrame?.url ?? "");
        const trustedOrigin =
          url.protocol === "workbench:" && url.host === "app";
        const devOrigin =
          !app.isPackaged && process.env.WORKBENCH_DEV_URL === url.origin;
        // Subframes cannot exercise desktop authority, even when their origin matches.
        if (
          event.sender !== win.webContents ||
          event.senderFrame !== win.webContents.mainFrame ||
          !(trustedOrigin || devOrigin)
        ) {
          throw new Error("无法从此页面执行本地操作。");
        }
        return { ok: true, data: await action(...args) };
      } catch (error) {
        const message =
          error instanceof z.ZodError
            ? "输入格式不正确，请检查后重试。"
            : error instanceof Error
              ? error.message
              : "操作未完成，请重试。";
        return { ok: false, error: message };
      }
    });
  };
  handle("snapshot", () => store.snapshot());
  handle("saveDraft", (input) => store.saveDraft(input));
  handle("archiveDraft", (key, archived) =>
    store.archiveDraft(id.parse(key), z.boolean().parse(archived)),
  );
  handle("revisions", (key) => store.revisions(id.parse(key)));
  handle("restoreRevision", (key, number, expected) =>
    store.restoreRevision(
      id.parse(key),
      revision.parse(number),
      revision.parse(expected),
    ),
  );
  handle("recordPublication", (key, number, url) =>
    store.recordPublication(
      id.parse(key),
      revision.parse(number),
      z.string().max(2048).parse(url),
    ),
  );
  handle("saveReading", (input) => store.saveReading(input));
  handle("deleteReading", (key) => store.deleteReading(id.parse(key)));
  handle("readingToDraft", (key) => store.readingToDraft(id.parse(key)));
  handle("copyText", (value) => clipboard.writeText(text.parse(value)));
  handle("openExternal", async (value) => {
    const url = new URL(z.string().max(2048).parse(value));
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error("只能打开普通网页链接。");
    await shell.openExternal(url.href);
  });
  handle("importMarkdown", async () => {
    const selected = await dialog.showOpenDialog(win, {
      title: "导入文章",
      properties: ["openFile"],
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
    });
    if (selected.canceled || !selected.filePaths[0]) return null;
    const path = selected.filePaths[0];
    if ((await stat(path)).size > 2_000_000)
      throw new Error("文章超过 2 MB，请拆分后导入。");
    return store.importMarkdown(basename(path), await readFile(path, "utf8"));
  });
  handle("exportDraft", async (key) => {
    const draft = store
      .snapshot()
      .drafts.find((item) => item.id === id.parse(key));
    if (!draft) throw new Error("找不到这篇稿件。");
    const filename =
      draft.title.replace(/[/\\:*?"<>|\x00-\x1f]/g, "-").slice(0, 100) ||
      "未命名稿件";
    const selected = await dialog.showSaveDialog(win, {
      title: "导出 Markdown",
      defaultPath: `${filename}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (selected.canceled || !selected.filePath) return false;
    await writeFile(selected.filePath, draft.body, "utf8");
    return true;
  });
  // Exports the editor's current content (possibly unsaved). The Electron build has no image library,
  // so stored image references are reported as missing rather than bundled.
  handle("exportCurrent", async (input) => {
    const value = z
      .object({ title: z.string().max(200), body: z.string().max(1_000_000), project: z.string().max(80) })
      .strict()
      .parse(input);
    const filename =
      value.title.replace(/[/\\:*?"<>|\x00-\x1f]/g, "-").slice(0, 100).trim() || "未命名稿件";
    const selected = await dialog.showSaveDialog(win, {
      title: "另存当前内容",
      defaultPath: `${filename}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (selected.canceled || !selected.filePath) return null;
    await writeFile(selected.filePath, value.body, "utf8");
    const images = [...value.body.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)/g)].map((m) => m[1]);
    return {
      filename: basename(selected.filePath),
      bundled: false,
      images: 0,
      missing: images.filter((src) => !/^https?:\/\//i.test(src)).length,
      remote: images.filter((src) => /^https?:\/\//i.test(src)).length,
    };
  });
  handle("backup", async () => {
    const selected = await dialog.showSaveDialog(win, {
      title: "备份全部资料",
      defaultPath: "内容工作台备份.json",
      filters: [{ name: "工作台备份", extensions: ["json"] }],
    });
    if (selected.canceled || !selected.filePath) return false;
    await writeFile(selected.filePath, store.exportBackup(), {
      encoding: "utf8",
      mode: 0o600,
    });
    return true;
  });
  handle("restoreBackup", async () => {
    const selected = await dialog.showOpenDialog(win, {
      title: "恢复资料",
      properties: ["openFile"],
      filters: [{ name: "工作台备份", extensions: ["json"] }],
    });
    if (selected.canceled || !selected.filePaths[0]) return false;
    if ((await stat(selected.filePaths[0])).size > 25_000_000)
      throw new Error("备份超过 25 MB，未修改当前资料。");
    const json = await readFile(selected.filePaths[0], "utf8");
    const decision = await dialog.showMessageBox(win, {
      type: "question",
      title: "恢复资料",
      message: "用这份备份恢复本地资料？",
      detail: "当前资料会先自动备份。线上文章不会被修改。",
      buttons: ["取消", "恢复"],
      defaultId: 0,
      cancelId: 0,
    });
    if (decision.response !== 1) return false;
    store.restoreBackup(json);
    return true;
  });
  handle("info", () => ({
    version: app.getVersion(),
    dataPath,
    platform: process.platform,
    mode: "desktop",
  }));
  handle("finishClose", finishClose);
}
