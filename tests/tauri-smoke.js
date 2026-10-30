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
  // Equal-width measurements catch inherited styles that markup comparison alone cannot detect.
  const appearance = async (container) => {
    await document.fonts.ready;
    const prior = container.getAttribute("style");
    container.style.width = "340px";
    container.style.maxWidth = "none";
    try {
      return [...container.querySelectorAll("*")].map(node => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return {
          style: ["fontFamily", "fontSize", "fontWeight", "lineHeight", "color", "whiteSpace", "textAlign", "padding", "borderWidth", "margin", "display"].map(key => style[key]).join("|"),
          width: rect.width, height: rect.height,
        };
      });
    } finally {
      if (prior === null) container.removeAttribute("style"); else container.setAttribute("style", prior);
    }
  };
  const sameAppearance = (actual, expected, label) => {
    assert(actual.length === expected.length, `${label}: element count differs`);
    actual.forEach((item, index) => {
      const other = expected[index];
      assert(item.style === other.style && Math.abs(item.width - other.width) < 0.05 && Math.abs(item.height - other.height) < 0.05, `${label}: element ${index} differs`);
    });
  };
  const diagramPixels = async (container) => Promise.all([...container.querySelectorAll(".mermaid-preview img")].map(async original => {
    // Decode at intrinsic size, independent of WKWebView's on-screen SVG raster cache and current column width.
    const img = new Image();
    img.src = original.src;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    assert(context.getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0), "Diagram image is empty");
    return canvas.toDataURL("image/png");
  }));
  const diagramsReady = (container) => {
    const diagrams = [...container.querySelectorAll(".mermaid-preview")];
    return diagrams.length === 4 && diagrams.slice(0, 2).every(node => node.querySelector("img")?.naturalWidth > 0)
      && diagrams.slice(2).every(node => node.textContent.includes("图表未能渲染"));
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
  fill('[aria-label="文章正文"]', window.__markdownFixture + "\n\n![Fixture](" + imageReference + ' "图片标题")');
  await click("反馈");
  await wait(() => document.querySelector(".feedback-page"), "feedback after edit");
  let snapshot = await api.snapshot();
  assert(snapshot.drafts[0]?.body.includes("const result") && snapshot.drafts[0]?.title.includes("Tauri 本地测试样本"), "Navigation lost draft edits");
  await click("稿件");
  await wait(editor, "return to editor");
  await click("预览");
  await wait(() => document.querySelector(".markdown"), "Markdown preview");
  assert(!window.__unsafeExecuted && !document.querySelector(".markdown script"), "Markdown allowed script execution");
  await wait(() => document.querySelector(".markdown .local-image"), "local image element");
  document.querySelector(".markdown .local-image").scrollIntoView();
  await wait(() => document.querySelector(".markdown .local-image")?.naturalWidth === 4, "native stored image preview");
  const md = document.querySelector(".editor-content .markdown");
  for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6", "table", "blockquote", "details", ".katex", ".hljs-keyword", "input[type=checkbox]"]) assert(md.querySelector(tag), `Missing Markdown construct: ${tag}`);
  assert(md.querySelector("ol").start === 3, "Ordered list start lost");
  assert(md.querySelector(".local-image").title === "图片标题", "Image title lost");
  assert([...md.querySelectorAll("img")].every(img => img.src.startsWith("data:")), "Remote image request allowed");
  await wait(() => diagramsReady(md), "Mermaid diagram rendered");
  const editorHTML = md.innerHTML;
  const editorAppearance = await appearance(md);
  const editorDiagrams = await diagramPixels(md);
  const anchor = [...md.querySelectorAll("a")].find(a => a.textContent === "跳到中文标题");
  anchor.click();
  assert(md.contains(document.activeElement) && document.activeElement.tagName === "H2", "Local heading anchor did not focus target");
  const footnote = md.querySelector("[data-footnote-ref]");
  footnote.click();
  assert(document.activeElement.tagName === "LI", "Footnote target unavailable");
  md.querySelector("[data-footnote-backref]").click();
  assert(document.activeElement.id === footnote.id, "Footnote backlink failed");
  await step("resize");
  await wait(() => window.innerWidth < 900, "narrow Markdown viewport");
  assert(document.documentElement.scrollWidth <= window.innerWidth, "Markdown overflows narrow viewport");
  assert(md.scrollWidth <= md.clientWidth + 1, "Markdown content escaped its column");
  assert(md.querySelector("pre").textContent.includes("  console.log"), "Code indentation lost");
  await click("准备发布");
  await wait(() => document.querySelector("dialog[open]"), "publication preview");
  const preview = document.querySelector(".publish-preview .markdown");
  await wait(() => preview.querySelector(".local-image"), "publish image element");
  preview.querySelector(".local-image").scrollIntoView();
  await wait(() => preview.querySelector(".local-image")?.naturalWidth === 4, "publish image preview");
  await wait(() => diagramsReady(preview), "publish Mermaid rendered");
  // Mermaid sequence diagrams use process-global actor IDs; those inert image-local identifiers do not change pixels.
  const normalizePreview = (html, container) => html
    .replace(/data:image\/svg\+xml;charset=utf-8,([^"]+)/g, (_, svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(decodeURIComponent(svg).replace(/id="(?:actor|root-)\d+"/g, 'id="participant"'))}`)
    .replaceAll(container.querySelector("h1").id.slice(0, -"markdown-预览验收".length), "md-SCOPE-");
  const compareMarkup = (actual, expected, label) => {
    if (actual === expected) return;
    const left = actual, right = expected;
    let index = 0;
    while (left[index] === right[index] && index < left.length) index++;
    throw new Error(`${label} at ${index}: ${left.slice(index - 40, index + 160)} / ${right.slice(index - 40, index + 160)}`);
  };
  compareMarkup(normalizePreview(preview.innerHTML, preview), normalizePreview(editorHTML, md), "Editor/publish output differs");
  assert(JSON.stringify(await diagramPixels(preview)) === JSON.stringify(editorDiagrams), "Editor/publish diagram pixels differ");
  sameAppearance(await appearance(preview), editorAppearance, "Editor/publish appearance");
  [...preview.querySelectorAll("a")].find(a => a.textContent === "跳到中文标题").click();
  assert(preview.contains(document.activeElement), "Publish anchor jumped into editor");
  assert(document.documentElement.scrollWidth <= window.innerWidth, "Publish preview overflows narrow viewport");
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
  document.querySelector(".more-menu").open = true;
  await click("历史版本");
  await wait(() => document.querySelector(".history-list button"), "saved revision list");
  document.querySelector(".history-list button").click();
  await wait(() => document.querySelector(".history-preview .markdown"), "history Markdown");
  const history = document.querySelector(".history-preview .markdown");
  await wait(() => history.querySelector(".local-image"), "history image element");
  history.querySelector(".local-image").scrollIntoView();
  await wait(() => history.querySelector(".local-image")?.naturalWidth === 4 && diagramsReady(history), "history images loaded");
  assert(normalizePreview(history.innerHTML, history) === normalizePreview(editorHTML, md), "History Markdown output differs");
  assert(JSON.stringify(await diagramPixels(history)) === JSON.stringify(editorDiagrams), "Editor/history diagram pixels differ");
  sameAppearance(await appearance(history), editorAppearance, "Editor/history appearance");
  document.querySelector('[aria-label="关闭历史版本"]').click();
  await click("正文");
  fill('[aria-label="文章正文"]', '![不可访问的图片](http://127.0.0.1/private.png)');
  await click("预览");
  await wait(() => button("加载这张图片"), "remote image opt-in");
  assert(!document.querySelector(".editor-content .markdown img"), "Remote image loaded without opt-in");
  await click("加载这张图片");
  await wait(() => document.querySelector(".image-placeholder")?.textContent.includes("外链图片无法读取"), "private remote image blocked");
  assert(!document.querySelector(".editor-content .markdown img"), "Private remote image rendered");
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
  await step("complete", { mermaidDiagramRendered: true, mermaidErrorsVisible: true, remoteImagesOptIn: true, privateRemoteImageBlocked: true, markdownHistoryParity: true, markdownEqualWidthAppearance: true, mermaidPixelParity: true, markdownFixtureRendered: true, markdownAnchorsScoped: true, markdownEditorPublishParity: true, markdownNarrowLayout: true, xSetupRendered: true, unauthenticatedPublishBlocked: true, cachedContentSearch: true, storedImageRendered: true, rssContentRendered: true, privateFeedBlocked: true, fullBackupRoundtrip: true, rendererIsolation: true, autosaveOnNavigation: true, markdownSanitized: true, nativeClipboard: clipboardAvailable, nativeClipboardSkipped: !clipboardAvailable, manualPublicationRecorded: true, readingNoteSaved: true, readingToDraft: true, narrowViewport: true });
  // Closing immediately exercises the pending-save barrier instead of waiting for debounce.
  fill('[aria-label="文章标题"]', "Tauri 测试样本 · 关闭时保存");
  await step("close");
})().catch((error) => window.__TAURI_INTERNALS__.invoke("comparison_step", { action: "fail", details: `${error?.message || error}\n${error?.stack || ""}` }));
