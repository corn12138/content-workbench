import {
  app,
  BrowserWindow,
  protocol,
  net,
  session,
  Menu,
  dialog,
} from "electron";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { WorkbenchStore } from "../core/store";
import { registerIPC } from "./ipc";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "workbench",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
let win: BrowserWindow | null = null;
let store: WorkbenchStore | null = null;
let canClose = false;
let closePending = false;
let recoveryOpen = false;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
const smoke = process.argv.includes("--workbench-smoke");

async function recoverClose() {
  if (recoveryOpen || canClose || !win || win.isDestroyed()) return;
  recoveryOpen = true;
  const choice = await dialog.showMessageBox(win, {
    type: "warning",
    title: "保存尚未完成",
    message: "暂时没有收到保存完成的回应。",
    detail: "可以继续等待并重试保存。直接退出可能丢失最近尚未保存的修改。",
    buttons: ["继续等待", "直接退出"],
    defaultId: 0,
    cancelId: 0,
  });
  recoveryOpen = false;
  closePending = false;
  if (choice.response === 1) {
    canClose = true;
    app.quit();
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    win?.show();
    win?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      const dataPath =
        process.env.WORKBENCH_DATA_DIR ||
        (app.isPackaged ? app.getPath("userData") : resolve(".local-data"));
      store = new WorkbenchStore(dataPath);
      const rendererPath = join(__dirname, "../renderer");
      protocol.handle("workbench", (request) => {
        const url = new URL(request.url);
        const target = resolve(
          rendererPath,
          "." + decodeURIComponent(url.pathname),
        );
        if (
          url.host !== "app" ||
          !target.startsWith(resolve(rendererPath) + sep)
        )
          return new Response("Not found", { status: 404 });
        return net.fetch(pathToFileURL(target).toString());
      });
      session.defaultSession.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      win = new BrowserWindow({
        width: 1180,
        height: 800,
        minWidth: 800,
        minHeight: 620,
        title: "内容工作台",
        backgroundColor: "#f7f8f7",
        titleBarStyle: "hiddenInset",
        show: false,
        webPreferences: {
          preload: join(__dirname, "preload.cjs"),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          spellcheck: false,
        },
      });
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", (event) => event.preventDefault());
      win.on("close", (event) => {
        if (canClose) return;
        // The renderer flushes pending edits before the native window is destroyed.
        event.preventDefault();
        if (!closePending) {
          closePending = true;
          win?.webContents.send("workbench:before-close");
          closeTimer = setTimeout(() => void recoverClose(), 6000);
        }
      });
      win.webContents.on("render-process-gone", () => void recoverClose());
      registerIPC(store, win, dataPath, () => {
        if (closeTimer) clearTimeout(closeTimer);
        canClose = true;
        app.quit();
      });
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: "内容工作台",
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { type: "separator" },
              {
                label: "退出内容工作台",
                accelerator: "CmdOrCtrl+Q",
                click: () => win?.close(),
              },
            ],
          },
          { role: "editMenu" },
          { role: "windowMenu" },
        ]),
      );
      const devURL = !app.isPackaged
        ? process.env.WORKBENCH_DEV_URL
        : undefined;
      if (devURL) await win.loadURL(devURL);
      else await win.loadURL("workbench://app/index.html");
      win.show();
      if (smoke) {
        const { smokeDesktop } = await import("./smoke");
        try {
          await smokeDesktop(win, store);
          win.once("closed", () => {
            if (
              store
                ?.snapshot()
                .drafts.some((item) => item.title === "测试样本 · 关闭时保存")
            ) {
              console.log("DESKTOP_CLOSE_SAVE_PASS");
              console.log("DESKTOP_SMOKE_PASS");
            } else console.error("Native close lost pending edits");
          });
          win.close();
        } catch (error) {
          console.error(error);
          process.exitCode = 1;
          canClose = true;
          app.quit();
        }
      }
    })
    .catch((error) => {
      console.error(error);
      app.exit(1);
    });
}
app.on("before-quit", (event) => {
  if (!canClose && !smoke && win && !win.isDestroyed()) {
    event.preventDefault();
    win.close();
  }
});
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => store?.close());
