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
      return [...container.querySelectorAll("*")].filter(node => !node.id.includes("user-content-cwb-heading-")).map(node => {
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
  const tile = (platform) => document.querySelector(`.platform-tile[data-platform="${platform}"]`);
  const openNotes = async () => {
    await wait(() => document.querySelector('[aria-controls="reading-notes"]'), "notes toggle");
    if (!document.querySelector("#reading-note")) document.querySelector('[aria-controls="reading-notes"]').click();
    await wait(() => document.querySelector("#reading-note"), "notes panel");
  };
  const openReading = async (text) => {
    const item = () => [...document.querySelectorAll(".reading-item")].find((node) => node.textContent.includes(text));
    await wait(item, `reading item ${text}`);
    item().click();
    await wait(() => document.querySelector(".reader-title")?.textContent.includes(text), `reader ${text}`);
  };
  await wait(() => !!window.workbench && document.querySelector(".nav-item"), "React and native bridge");
  const api = window.workbench;
  const phase = await step("phase");
  if (phase === "menuQuit") {
    const before = await api.snapshot();
    assert(before.drafts.some((draft) => draft.title === "Tauri 测试样本 · 关闭时保存"), "Prior native close did not persist");
    await click("阅读");
    await openNotes();
    await step("complete", { reopenedPersistentData: true, applicationExitHandshake: true });
    fill("#reading-note", "Tauri 测试笔记 · 退出时保存");
    await step("close");
    return;
  }
  await wait(() => document.body.textContent.includes("把第一篇文章放进来"), "empty workspace");
  assert(typeof window.require === "undefined" && typeof window.process === "undefined", "Renderer exposes Node globals");
  await click("新建稿件");
  await wait(editor, "draft editor");
  fill('[aria-label="文章标题"]', "Tauri 本地测试样本 · 一次重构的记录");
  const imageReference = await step("library_fixture");
  fill('[aria-label="文章正文"]', window.__markdownFixture + "\n\n![Fixture](" + imageReference + ' "图片标题")');
  // Responsive sweep in the real WebView: the layout mode follows the actual width, nothing overflows
  // horizontally, and the long title and body re-fit their height whenever the column width changes.
  const layoutFor = (width) => (width >= 1280 ? "wide" : width >= 960 ? "standard" : "compact");
  const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const resizeTo = async (width, height) => {
    await step("resize_to", { width, height });
    await wait(() => Math.abs(window.innerWidth - width) <= 2, `window width ${width}`);
    await frames();
    await wait(() => document.querySelector(".app-shell")?.dataset.layout === layoutFor(window.innerWidth), `layout at ${width}`);
    assert(document.documentElement.scrollWidth <= window.innerWidth, `Horizontal overflow at ${width}`);
  };
  const fits = (selector) => {
    const node = document.querySelector(selector);
    return !!node && node.scrollHeight <= node.clientHeight + 1;
  };
  const fieldsFit = (label) => wait(() => fits('[aria-label="文章标题"]') && fits('[aria-label="文章正文"]'), `${label}: title and body fully visible`);
  fill('[aria-label="文章标题"]', "Tauri 本地测试样本 · 一次重构的记录 · " + "长标题需要在窄窗口中完整换行而不被截断，".repeat(3));
  const widths = [[1440, 900], [1280, 820], [1279, 820], [1180, 800], [1000, 760], [960, 720], [959, 720], [880, 680], [800, 620], [1180, 800]];
  for (const [width, height] of widths) {
    await resizeTo(width, height);
    await wait(editor, `editor at ${width}`);
    await fieldsFit(`list shown at ${width}`);
  }
  document.querySelector('[aria-label="收起稿件列表，专注写作"]').click();
  await wait(() => !document.querySelector('[aria-label="稿件列表"]'), "draft list collapsed");
  await fieldsFit("list collapsed");
  for (const [width, height] of [[1440, 900], [1000, 760], [1180, 800]]) {
    await resizeTo(width, height);
    await fieldsFit(`list collapsed at ${width}`);
  }
  document.querySelector('[aria-label="显示稿件列表"]').click();
  await wait(() => document.querySelector('[aria-label="稿件列表"]'), "draft list restored");
  await fieldsFit("list restored");
  await click("发布记录");
  await wait(() => document.querySelector(".records-page"), "publication records after edit");
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
  const observedTheme = [
    ["h1", "24px", "38px"], ["h2", "22px", "34px"], ["h3", "20px", "28px"],
    ["h4", "18px", "26px"], ["h5", "17px", "24px"], ["h6", "16px", "24px"],
    ["p", "16px", "28px"], ["table", "12px", "21px"], ["th", "12px", "24px"],
  ];
  for (const [selector, size, line] of observedTheme) {
    const style = getComputedStyle(md.querySelector(selector));
    assert(style.fontSize === size && style.lineHeight === line, `Juejin typography differs: ${selector}`);
  }
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
  await wait(() => document.querySelector(".publish-workspace"), "publication preparation");
  await wait(() => document.activeElement?.id === "publish-title", "publishing preparation focus");
  const preview = document.querySelector(".publish-preview .markdown");
  await wait(() => preview.querySelector(".local-image"), "publish image element");
  preview.querySelector(".local-image").scrollIntoView();
  await wait(() => preview.querySelector(".local-image")?.naturalWidth === 4, "publish image preview");
  await wait(() => diagramsReady(preview), "publish Mermaid rendered");
  // Mermaid sequence diagrams use process-global actor IDs; those inert image-local identifiers do not change pixels.
  const normalizePreview = (html, container) => {
    for (const target of container.querySelectorAll('[id*="user-content-cwb-heading-"]')) {
      assert(target.parentElement.matches("h1,h2,h3,h4,h5,h6"), "Generated anchor is not inline in heading");
      html = html.replaceAll(`href="#${target.id}"`, `href="#${target.parentElement.id}"`).replace(target.outerHTML, "");
    }
    return html
    .replace(/data:image\/svg\+xml;charset=utf-8,([^"]+)/g, (_, svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(decodeURIComponent(svg).replace(/id="(?:actor|root-)\d+"/g, 'id="participant"'))}`)
    .replaceAll(container.querySelector("h1").id.slice(0, -"markdown-预览验收".length), "md-SCOPE-");
  };
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
  tile("x").click();
  await wait(() => document.querySelector(".x-setup input"), "X setup without credentials");
  assert(button("连接 X")?.disabled, "X connection must require a public client ID");
  fill(".x-setup input", "invalid client id");
  await wait(() => document.querySelector(".x-setup input")?.value === "invalid client id", "X Client ID edit");
  assert(document.querySelector(".x-setup")?.open, "X setup collapsed while typing");
  await click("连接 X");
  await wait(() => document.querySelector(".x-connection")?.textContent.includes("不是 Client Secret"), "invalid Client ID blocked before browser authorization");
  assert(!button("发布到 X…") || button("发布到 X…").disabled, "X publish must require a connected account and valid text");
  let invalidClientBlocked = false;
  try { await api.xConnect(""); } catch { invalidClientBlocked = true; }
  assert(invalidClientBlocked, "Empty X client ID was not blocked locally");
  let localPublishBlocked = false;
  try { await api.xPublish({ draftId: "fixture", revision: 1, text: "assets/private.png", acknowledged: true, expectedUsername: "example" }); } catch { localPublishBlocked = true; }
  assert(localPublishBlocked, "Local assets reached publishing transport");
  tile("juejin").click();
  await wait(() => button("复制并打开掘金"), "Juejin steps");
  const clipboardAvailable = await step("clipboard_available");
  if (clipboardAvailable) {
    await step("clipboard_begin");
    await click("复制正文");
    await wait(() => button("正文已复制"), "clipboard success indicator");
    await step("clipboard");
  }
  fill('[aria-label="已发布的作品链接"]', "https://juejin.cn/post/1234567890123456789");
  await click("保存到发布记录");
  await wait(() => document.querySelector(".record-saved"), "publication recorded");
  snapshot = await api.snapshot();
  assert(snapshot.publications[0]?.confirmation === "manual", "Manual publication provenance lost");
  await click("返回编辑");
  await wait(editor, "editor after publishing preparation");
  await wait(() => document.activeElement === button("准备发布"), "focus returned to the publish action");
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
  await click("编辑");
  fill('[aria-label="文章正文"]', '![不可访问的图片](http://127.0.0.1/private.png)');
  await click("预览");
  await wait(() => button("加载这张图片"), "remote image opt-in");
  assert(!document.querySelector(".editor-content .markdown img"), "Remote image loaded without opt-in");
  await click("加载这张图片");
  await wait(() => document.querySelector(".image-placeholder")?.textContent.includes("外链图片无法读取"), "private remote image blocked");
  assert(!document.querySelector(".editor-content .markdown img"), "Private remote image rendered");
  await click("准备发布");
  await wait(() => document.querySelector(".image-preparation button:not(:disabled)"), "image preparation entry");
  document.querySelector(".image-preparation button").click();
  await wait(() => document.querySelector(".image-preparation")?.textContent.includes("没有可用图片"), "private image preparation rejected");
  assert(document.querySelector(".image-preparation")?.textContent.includes("第 1 张图片"), "Image failure must identify its position");
  await click("返回编辑");
  await click("设置");
  await wait(() => button("检查更新"), "updater settings");
  await click("检查更新");
  await wait(() => document.body.textContent.includes("开发预览版不检查线上更新"), "debug updater stays offline");
  assert(!button("升级到 0.4.0"), "A failed check must not offer installation");
  // Failure-state regressions. Bridge methods are replaced only inside this injected debug test and restored
  // afterwards; nothing is sent to X, and the fake restore never touches data.
  const original = { ...api };
  const fail = (message) => async () => { throw new Error(message); };
  const counted = (impl) => { const fn = async (...args) => { fn.calls += 1; return impl(...args); }; fn.calls = 0; return fn; };
  const outcome = () => document.querySelector(".x-outcome")?.dataset.outcome;
  const openX = async () => {
    await click("稿件");
    await wait(() => button("准备发布") && !button("准备发布").disabled, "draft ready to publish");
    await click("准备发布");
    await wait(() => tile("x") && !tile("x").disabled, "publish workspace");
    tile("x").click();
    await wait(() => document.querySelector("#x-post-text"), "X composer with test account");
    fill("#x-post-text", "回归测试短帖，不会发送");
    await click("发布到 X…");
    await wait(() => button("确认发布到 @example"), "final account confirmation");
    await click("确认发布到 @example");
  };
  try {
    api.xAccount = async () => ({ connected: true, username: "example", clientId: "fixture", callback: "http://127.0.0.1:34187/oauth/x/callback" });
    api.openExternal = fail("无法打开链接。");
    api.copyText = fail("复制未完成。");
    api.xPublish = fail("X 未返回明确发布结果，请到个人主页核实；不要重复发送。");
    await openX();
    await wait(() => outcome() === "uncertain", "unknown X result");
    await click("打开我的 X 主页");
    await wait(() => document.querySelector(".x-action-error"), "secondary action error");
    assert(outcome() === "uncertain", "Opening the profile changed the unknown result");
    assert(!button("发布到 X…") && !button("确认发布到 @example")?.offsetParent, "Unknown result offered a resend");
    assert(document.querySelector("#x-post-text").readOnly && document.querySelector("#record-x"), "Unknown result lost the manual record path");
    await click("返回编辑");
    api.xPublish = async () => ({ url: "https://x.com/example/status/1234567890", recorded: true, warning: null });
    await openX();
    await wait(() => outcome() === "published", "X receipt");
    for (const [label, message] of [["打开作品", "无法打开链接。"], ["复制作品链接", "复制未完成。"]]) {
      await click(label);
      await wait(() => document.querySelector(".x-action-error")?.textContent.includes(message), `${label} failure shown`);
      assert(outcome() === "published" && !document.body.textContent.includes("没有发布"), `${label} failure downgraded the receipt`);
    }
    await click("返回编辑");
    api.xPublish = fail("请先连接 X 账号。");
    await openX();
    await wait(() => outcome() === "failed", "local X failure");
    assert(!document.querySelector(".x-outcome").textContent.includes("拒绝"), "Local failure described as a platform rejection");
    await click("返回编辑");
    api.xPublish = fail("X 服务暂时不可用，请稍后重试。");
    await openX();
    await wait(() => outcome() === "failed", "ambiguous X service failure");
    assert(!document.querySelector(".x-outcome").textContent.includes("拒绝"), "Server failure described as a platform rejection");
    await click("返回编辑");

    let snapshotFailures = 1;
    api.restoreBackup = counted(async () => true);
    api.snapshot = counted(async () => {
      if (snapshotFailures-- > 0) throw new Error("资料暂时无法读取");
      return original.snapshot();
    });
    await click("设置");
    await click("恢复备份");
    await wait(() => document.querySelector(".restore-refresh")?.textContent.includes("资料已恢复，列表暂未刷新"), "restored but not refreshed");
    assert(!document.body.textContent.includes("恢复未完成"), "Completed restore reported as failed");
    await click("稿件");
    await wait(() => document.body.textContent.includes("资料已恢复，列表暂未刷新") && !editor(), "stale list blocked");
    await click("重新读取资料");
    await wait(() => document.querySelector(".list-item"), "data read after retry");
    assert(api.restoreBackup.calls === 1 && api.snapshot.calls >= 2, "Retry ran restore again or did not refresh");

    let checks = 0;
    api.checkUpdate = async () => { if (checks++ === 0) throw new Error("网络不可用"); return { version: "9.9.9", notes: "" }; };
    api.installUpdate = fail("安装未完成，升级前副本已保留；请查看升级备份。");
    await click("设置");
    await click("检查更新");
    await wait(() => document.querySelector(".update-failure")?.textContent.includes("检查更新未完成"), "check failure");
    await click("检查更新");
    await wait(() => button("升级到 9.9.9") && !document.querySelector(".update-failure"), "stale check error cleared");
    await click("升级到 9.9.9");
    await wait(() => document.querySelector(".update-failure")?.textContent.includes("升级没有完成"), "install failure");
    const failure = document.querySelector(".update-failure").textContent;
    assert(!/没有改动|未改动/.test(failure) && [...document.querySelectorAll(".update-failure button")].some((b) => b.textContent.includes("查看升级备份")), "Install failure overclaims or hides backups");
    api.installUpdate = fail("请先重新检查更新。");
    await click("重试升级");
    await wait(() => document.querySelector(".update-failure")?.textContent.includes("请先重新检查更新"), "pre-backup install failure");
    assert(!/已保留|没有改动|未改动/.test(document.querySelector(".update-failure").textContent), "Pre-backup install failure claims a kept backup");
  } finally {
    Object.assign(api, original);
  }
  await click("阅读");
  await wait(() => document.querySelector(".reading-workspace"), "reading workspace");
  await openReading("Subscription article");
  await wait(() => document.querySelector(".reader-content")?.textContent.includes("Offline subscription content"), "RSS cached content");
  const reading = document.querySelector(".reader-content .markdown");
  // Continuous reading: no clipped preview box and no expand step; the reader column is the only scroller.
  assert(!document.querySelector(".reading-preview-text") && !button("展开订阅内容"), "Article is still clipped behind an expand control");
  for (let node = reading; node && !node.classList.contains("reader-scroll"); node = node.parentElement)
    assert(getComputedStyle(node).maxHeight === "none" && !["auto", "scroll"].includes(getComputedStyle(node).overflowY), "Nested article scrolling");
  assert(document.querySelector(".content-kind")?.textContent.includes("订阅正文"), "Content kind missing");
  assert(reading?.querySelector("h2") && reading.querySelector("ol") && reading.querySelector("table"), "Rich RSS structure missing");
  assert(reading.querySelector("pre code")?.textContent.includes('\n    println!("hello");'), "RSS code whitespace changed");
  assert([...reading.querySelectorAll("a")].some((a) => a.href === "https://example.com/next"), "RSS relative link was not resolved against article URL");
  assert(reading.querySelector(".image-placeholder") && !reading.querySelector("img"), "RSS image loaded without opt-in");
  reading.querySelector('a[href^="#"]').click();
  assert(document.activeElement === reading.querySelector("h2"), "RSS heading anchor did not focus within article");
  await step("resize");
  await wait(() => window.innerWidth < 900, "narrow RSS window");
  assert(document.documentElement.scrollWidth <= window.innerWidth, "RSS layout overflows narrow window");
  fill('[aria-label="搜索标题、内容和笔记"]', "Offline subscription");
  await wait(() => document.querySelectorAll(".reading-item").length === 1, "cached content search");
  fill('[aria-label="搜索标题、内容和笔记"]', "a-query-with-no-matches");
  await wait(() => document.querySelectorAll(".reading-item").length === 0, "empty content search");
  fill('[aria-label="搜索标题、内容和笔记"]', "");
  let blocked = false;
  try { await api.addFeed("http://127.0.0.1/private"); } catch { blocked = true; }
  assert(blocked, "Native feed command allowed a private address");
  document.querySelector(".reading-list .more-menu").open = true;
  await click("添加文章链接");
  await wait(() => document.querySelector("#reading-url"), "add link form");
  fill("#reading-url", "https://example.com/engineering-notes");
  fill("#reading-title", "Tauri 测试资料 · 工程实践笔记");
  await click("保存链接");
  await wait(() => document.querySelector(".reader-url")?.textContent === "https://example.com/engineering-notes", "saved reading selected");
  await openNotes();
  await wait(() => !document.querySelector("#reading-note").disabled, "note editable");
  fill("#reading-note", "我的收获：先把保存失败和重试做好，再增加自动化。");
  // Notes survive layout changes: docked beside the list (wide), the list yields (standard), drawer (compact).
  const noteText = document.querySelector("#reading-note").value;
  for (const [width, height] of [[1180, 800], [1440, 900], [850, 680]]) {
    await resizeTo(width, height);
    await wait(() => document.querySelector("#reading-note")?.value === noteText, `note kept at ${width}`);
    const layout = layoutFor(window.innerWidth);
    const listHidden = document.querySelector(".reading-list").hidden;
    assert(layout === "wide" ? !listHidden : listHidden, `Article list visibility wrong for ${layout} with notes open`);
    const scroller = document.querySelector(".reader-scroll");
    assert(scroller && scroller.getBoundingClientRect().width > 0, `Reader hidden at ${width}`);
  }
  await click("发布记录");
  await wait(() => document.querySelector(".records-page"), "records after note");
  snapshot = await api.snapshot();
  assert(snapshot.readings[0]?.note.includes("保存失败"), "Navigation lost reading note");
  await click("阅读");
  await openReading("Tauri 测试资料");
  await openNotes();
  assert(document.querySelector("#reading-note").value.includes("保存失败"), "Reopened note lost text");
  await step("resize");
  await wait(() => window.innerWidth < 900, "narrow window");
  assert(document.documentElement.scrollWidth <= window.innerWidth, "Narrow window overflows horizontally");
  await click("用笔记开始写作");
  await wait(editor, "draft from reading note");
  snapshot = await api.snapshot();
  assert(snapshot.drafts.some((draft) => draft.body.includes("来源：https://example.com/engineering-notes")), "Converted note lost attribution");
  await step("full_backup_roundtrip");
  await step("complete", { imagePreparationFailureVisible: true, updateSettingsOfflineGuard: true, juejinInlineAnchorAdaptation: true, mermaidDiagramRendered: true, mermaidErrorsVisible: true, remoteImagesOptIn: true, privateRemoteImageBlocked: true, markdownHistoryParity: true, markdownEqualWidthAppearance: true, juejinMeasuredTypography: true, mermaidPixelParity: true, markdownFixtureRendered: true, markdownAnchorsScoped: true, markdownEditorPublishParity: true, markdownNarrowLayout: true, xSetupRendered: true, unauthenticatedPublishBlocked: true, cachedContentSearch: true, storedImageRendered: true, rssContentRendered: true, rssRichLayout: true, rssCodeWhitespace: true, rssRelativeLinks: true, rssAnchors: true, rssImagesOptIn: true, rssContinuousReading: true, publishFocusRestored: true, xOutcomeSurvivesSecondaryFailure: true, xLocalFailureNotRejection: true, restoreRefreshSeparated: true, restoreRetryRefreshOnly: true, updateFailureNeutral: true, updateCheckErrorCleared: true, updatePreBackupFailureNeutral: true, xServerFailureNotRejection: true, responsiveSweep: true, notesSurviveLayout: true, rssNarrowLayout: true, privateFeedBlocked: true, fullBackupRoundtrip: true, rendererIsolation: true, autosaveOnNavigation: true, markdownSanitized: true, nativeClipboard: clipboardAvailable, nativeClipboardSkipped: !clipboardAvailable, manualPublicationRecorded: true, readingNoteSaved: true, readingToDraft: true, narrowViewport: true });
  // Closing immediately exercises the pending-save barrier instead of waiting for debounce.
  fill('[aria-label="文章标题"]', "Tauri 测试样本 · 关闭时保存");
  await step("close");
})().catch((error) => window.__TAURI_INTERNALS__.invoke("comparison_step", { action: "fail", details: `${error?.message || error}\n${error?.stack || ""}` }));
