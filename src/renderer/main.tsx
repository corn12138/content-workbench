import { createRoot } from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import "./styles.css";

async function mount() {
  if (isTauri()) {
    const { createTauriAPI } = await import("./tauri-api");
    window.workbench = await createTauriAPI();
  }
  const { App } = await import("./App");
  createRoot(document.getElementById("root")!).render(
    window.workbench ? (
      <App />
    ) : (
      <main className="standalone-message">
        <h1>请从桌面应用打开</h1>
        <p>内容工作台将资料保存在本机。使用 npm run dev 启动桌面开发版。</p>
      </main>
    ),
  );
}
void mount().catch((error: unknown) => {
  createRoot(document.getElementById("root")!).render(
    <main className="standalone-message">
      <h1>工作台未能打开</h1>
      <p>{error instanceof Error ? error.message : "请重新打开应用。"}</p>
    </main>,
  );
});
