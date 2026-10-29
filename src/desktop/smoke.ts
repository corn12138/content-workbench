import type { BrowserWindow } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { WorkbenchStore } from "../core/store";

export async function smokeDesktop(win: BrowserWindow, store: WorkbenchStore) {
  if (!process.env.WORKBENCH_DATA_DIR)
    throw new Error("Smoke checks require an isolated data directory.");
  const evaluate = <T = unknown>(source: string): Promise<T> =>
    win.webContents.executeJavaScript(source, true);
  const waitFor = async (predicate: string) => {
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      if (await evaluate<boolean>(predicate)) return;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    throw new Error(`Desktop condition failed: ${predicate}`);
  };
  const click = async (text: string) => {
    const literal = JSON.stringify(text);
    const lookup = `[...document.querySelectorAll('button')].find(x => x.textContent.trim() === ${literal} || (x.classList.contains('nav-item') && x.querySelector('span')?.textContent === ${literal}))`;
    await waitFor(
      `(() => { const el = ${lookup}; return !!el && !el.disabled; })()`,
    );
    const done = await evaluate<boolean>(
      `(() => { const el = ${lookup}; if (!el || el.disabled) return false; el.click(); return true; })()`,
    );
    if (!done) throw new Error(`Missing actionable button: ${text}`);
  };
  const fill = async (selector: string, value: string) => {
    await evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('Missing input'); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', {bubbles:true})); })()`,
    );
  };
  const artifacts = resolve(
    process.env.WORKBENCH_ARTIFACT_DIR || "artifacts/desktop-smoke",
  );
  const painted = () =>
    evaluate(
      `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
    );
  await mkdir(artifacts, { recursive: true });
  await waitFor(`document.body.textContent.includes('把第一篇文章放进来')`);
  const isolated = await evaluate<boolean>(
    `typeof window.require === 'undefined' && typeof window.process === 'undefined' && !!window.workbench`,
  );
  if (!isolated) throw new Error("Renderer sandbox or bridge unavailable");
  await click("新建");
  await waitFor(`!!document.querySelector('[aria-label="文章正文"]')`);
  await fill('[aria-label="文章标题"]', "本地测试样本 · 一次重构的记录");
  await fill(
    '[aria-label="文章正文"]',
    "## 从一个小问题开始\n\n这是一篇仅用于桌面验收的测试文章。\n\n- 记录背景与取舍\n- 保留可复现的结果\n\n```ts\nconst result = await saveDraft(content);\n```\n\n<script>window.__unsafeExecuted = true</script>",
  );
  // Navigating immediately after input exercises the flush barrier rather than waiting for debounce.
  await click("反馈");
  await waitFor(`document.querySelector('.feedback-page') !== null`);
  const draft = store.snapshot().drafts[0];
  if (
    !draft?.body.includes("const result") ||
    !draft.title.includes("测试样本")
  )
    throw new Error("Navigation lost draft edits");
  await click("稿件");
  await waitFor(`!!document.querySelector('[aria-label="文章正文"]')`);
  await click("预览");
  await waitFor(`document.querySelector('.markdown') !== null`);
  if (
    await evaluate<boolean>(
      `!!window.__unsafeExecuted || !!document.querySelector('.markdown script')`,
    )
  )
    throw new Error("Unsafe Markdown rendered executable content");
  await painted();
  await writeFile(
    resolve(artifacts, "draft-desktop.png"),
    (await win.webContents.capturePage()).toPNG(),
  );
  await click("准备发布");
  await waitFor(`!!document.querySelector('dialog[open]')`);
  await fill(
    '[aria-label="已发布的掘金文章链接"]',
    "https://juejin.cn/post/1234567890123456789",
  );
  await click("记录发布链接");
  await waitFor(`!document.querySelector('dialog[open]')`);
  if (store.snapshot().publications[0]?.confirmation !== "manual")
    throw new Error("Manual publication provenance lost");
  await click("阅读");
  await waitFor(`!!document.querySelector('.reading-workspace')`);
  await click("添加链接");
  await fill("#reading-url", "https://example.com/engineering-notes");
  await fill("#reading-title", "测试资料 · 工程实践笔记");
  await click("保存链接");
  await waitFor(`!!document.querySelector('#reading-note')`);
  await fill(
    "#reading-note",
    "我的收获：先把保存失败和重试做好，再增加自动化。",
  );
  await click("反馈");
  await waitFor(`!!document.querySelector('.feedback-page')`);
  if (!store.snapshot().readings[0]?.note.includes("保存失败"))
    throw new Error("Navigation lost reading note");
  await click("阅读");
  await waitFor(`!!document.querySelector('#reading-note')`);
  win.setSize(850, 680);
  await waitFor(`window.innerWidth < 900`);
  const overflow = await evaluate<boolean>(
    `document.documentElement.scrollWidth > window.innerWidth`,
  );
  if (overflow) throw new Error("Narrow desktop layout overflows");
  await painted();
  await writeFile(
    resolve(artifacts, "reading-narrow.png"),
    (await win.webContents.capturePage()).toPNG(),
  );
  await click("用笔记开始写作");
  await waitFor(`!!document.querySelector('[aria-label="文章正文"]')`);
  if (
    !store
      .snapshot()
      .drafts.some((item) =>
        item.body.includes("https://example.com/engineering-notes"),
      )
  )
    throw new Error("Reading source missing from converted draft");
  await writeFile(
    resolve(artifacts, "result.json"),
    JSON.stringify(
      {
        passed: true,
        rendererSandbox: true,
        autosaveOnNavigation: true,
        markdownSanitized: true,
        manualPublicationRecorded: true,
        readingToDraft: true,
        narrowViewport: "850x680",
        versions: process.versions,
        screenshotsContain: "isolated local test fixtures only",
      },
      null,
      2,
    ),
  );
  // Leave a pending edit for the real native close handshake to flush.
  await fill('[aria-label="文章标题"]', "测试样本 · 关闭时保存");
}
