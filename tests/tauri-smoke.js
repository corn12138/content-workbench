// Injected only by the guarded debug harness into isolated local test fixtures.
(async () => {
  const step = (action, details = null) => window.__TAURI_INTERNALS__.invoke("comparison_step", { action, details });
  const wait = async (predicate, label) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    throw new Error(`Timed out: ${label}`);
  };
  const assert = (value, label) => { if (!value) throw new Error(label); };
  const button = (text) => [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === text || (item.classList.contains("nav-item") && item.querySelector("span")?.textContent === text));
  const click = async (text) => {
    await wait(() => button(text) && !button(text).disabled, `button ${text}`);
    button(text).click();
  };
  const fill = (selector, value) => {
    const input = document.querySelector(selector);
    assert(input, `Missing input ${selector}`);
    const prototype = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const editor = () => document.querySelector('[aria-label="文章正文"]');
  await wait(() => !!window.workbench && document.querySelector(".nav-item"), "React and native bridge");
  const api = window.workbench;
  const phase = await step("phase");
  if (phase === "menuQuit") {
    const before = await api.snapshot();
    assert(before.drafts.some((draft) => draft.title === "Tauri 测试样本 · 关闭时保存"), "Prior native close did not persist");
    await click("阅读");
    await wait(() => document.querySelector("#reading-note"), "reading note on reopen");
    await step("complete", { reopenedPersistentData: true, applicationExitHandshake: true });
    fill("#reading-note", "Tauri 测试笔记 · 退出时保存");
    await step("close");
    return;
  }
  await wait(() => document.body.textContent.includes("把第一篇文章放进来"), "empty workspace");
  assert(typeof window.require === "undefined" && typeof window.process === "undefined", "Renderer exposes Node globals");
  await click("新建");
  await wait(editor, "draft editor");
  fill('[aria-label="文章标题"]', "Tauri 本地测试样本 · 一次重构的记录");
  const imageReference = await step("library_fixture");
  fill('[aria-label="文章正文"]', "## 从一个小问题开始\n\n仅用于本机验收的文章。\n\n```ts\nconst result = await saveDraft(content);\n```\n\n<script>window.__unsafeExecuted = true</script>\n\n![Fixture](" + imageReference + ")");
  await click("反馈");
  await wait(() => document.querySelector(".feedback-page"), "feedback after edit");
  let snapshot = await api.snapshot();
  assert(snapshot.drafts[0]?.body.includes("const result") && snapshot.drafts[0]?.title.includes("Tauri 本地测试样本"), "Navigation lost draft edits");
  await click("稿件");
  await wait(editor, "return to editor");
  await click("预览");
  await wait(() => document.querySelector(".markdown"), "Markdown preview");
  assert(!window.__unsafeExecuted && !document.querySelector(".markdown script"), "Markdown allowed script execution");
  await wait(() => document.querySelector(".markdown img")?.naturalWidth === 4, "native stored image preview");
  await click("准备发布");
  await wait(() => document.querySelector("dialog[open]"), "publication preview");
  await click("X");
  await wait(() => document.querySelector(".x-setup input"), "X setup without credentials");
  assert(button("连接 X")?.disabled, "X connection must require a public client ID");
  fill(".x-setup input", "invalid client id");
  await wait(() => document.querySelector(".x-setup input")?.value === "invalid client id", "X Client ID edit");
  assert(document.querySelector(".x-setup")?.open, "X setup collapsed while typing");
  await click("连接 X");
  await wait(() => document.querySelector(".x-connection")?.textContent.includes("不是 Client Secret"), "invalid Client ID blocked before browser authorization");
  assert(button("发布到 X")?.disabled, "X publish must require a connected account and valid text");
  let invalidClientBlocked = false;
  try { await api.xConnect(""); } catch { invalidClientBlocked = true; }
  assert(invalidClientBlocked, "Empty X client ID was not blocked locally");
  let localPublishBlocked = false;
  try { await api.xPublish({ draftId: "fixture", revision: 1, text: "assets/private.png", acknowledged: true, expectedUsername: "example" }); } catch { localPublishBlocked = true; }
  assert(localPublishBlocked, "Local assets reached publishing transport");
  await click("掘金");
  const clipboardAvailable = await step("clipboard_available");
  if (clipboardAvailable) {
    await step("clipboard_begin");
    await click("复制正文");
    await wait(() => button("正文已复制"), "clipboard success indicator");
    await step("clipboard");
  }
  fill('[aria-label="已发布的作品链接"]', "https://juejin.cn/post/1234567890123456789");
  await click("记录发布链接");
  await wait(() => !document.querySelector("dialog[open]"), "publication recorded");
  snapshot = await api.snapshot();
  assert(snapshot.publications[0]?.confirmation === "manual", "Manual publication provenance lost");
  await click("阅读");
  await wait(() => document.querySelector(".reading-workspace"), "reading workspace");
  await wait(() => document.querySelector(".reading-excerpt")?.textContent.includes("Offline subscription content"), "RSS cached content");
  fill('[aria-label="搜索标题、内容和笔记"]', "Offline subscription");
  await wait(() => document.querySelectorAll(".reading-item").length === 1, "cached content search");
  fill('[aria-label="搜索标题、内容和笔记"]', "a-query-with-no-matches");
  await wait(() => document.querySelectorAll(".reading-item").length === 0, "empty content search");
  fill('[aria-label="搜索标题、内容和笔记"]', "");
  let blocked = false;
  try { await api.addFeed("http://127.0.0.1/private"); } catch { blocked = true; }
  assert(blocked, "Native feed command allowed a private address");
  await click("添加链接");
  fill("#reading-url", "https://example.com/engineering-notes");
  fill("#reading-title", "Tauri 测试资料 · 工程实践笔记");
  await click("保存链接");
  await wait(() => document.querySelector(".reading-url")?.textContent === "https://example.com/engineering-notes" && !document.querySelector("#reading-note")?.disabled, "saved reading selected");
  fill("#reading-note", "我的收获：先把保存失败和重试做好，再增加自动化。");
  await click("反馈");
  await wait(() => document.querySelector(".feedback-page"), "feedback after note");
  snapshot = await api.snapshot();
  assert(snapshot.readings[0]?.note.includes("保存失败"), "Navigation lost reading note");
  await click("阅读");
  await wait(() => document.querySelector("#reading-note"), "reading editor");
  await step("resize");
  await wait(() => window.innerWidth < 900, "narrow window");
  assert(document.documentElement.scrollWidth <= window.innerWidth, "Narrow window overflows horizontally");
  await click("用笔记开始写作");
  await wait(editor, "draft from reading note");
  snapshot = await api.snapshot();
  assert(snapshot.drafts.some((draft) => draft.body.includes("来源：https://example.com/engineering-notes")), "Converted note lost attribution");
  await step("full_backup_roundtrip");
  await step("complete", { xSetupRendered: true, unauthenticatedPublishBlocked: true, cachedContentSearch: true, storedImageRendered: true, rssContentRendered: true, privateFeedBlocked: true, fullBackupRoundtrip: true, rendererIsolation: true, autosaveOnNavigation: true, markdownSanitized: true, nativeClipboard: clipboardAvailable, nativeClipboardSkipped: !clipboardAvailable, manualPublicationRecorded: true, readingNoteSaved: true, readingToDraft: true, narrowViewport: true });
  // Closing immediately exercises the pending-save barrier instead of waiting for debounce.
  fill('[aria-label="文章标题"]', "Tauri 测试样本 · 关闭时保存");
  await step("close");
})().catch((error) => window.__TAURI_INTERNALS__.invoke("comparison_step", { action: "fail", details: `${error?.message || error}\n${error?.stack || ""}` }));
