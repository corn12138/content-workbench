# X、掘金发布与订阅展现试验

日期：2026-11-02（America/New_York）。基线：v0.4.0，提交 `0e3ddca76edbfe277427a3d14356e481345e8213`。

本次是现有功能试验和下一步方案，未修改正式业务代码、数据库结构、已发布版本或回退包。没有向 X 或掘金公开发布测试内容。掘金新增了一份明确标记“不发布”的公开样例草稿；RSS 仅写入独立试验资料。

## 结论与证据

| 项目 | 本次验证 | 当前边界 |
| --- | --- | --- |
| X 应用配置 | 正式版设置页显示 Client ID 为空，“连接 X”禁用 | 真实授权和自动发帖 Blocked，不能把代码实现视为平台已打通 |
| X 网页辅助入口 | 当前浏览器已登录；公开测试短帖自动填入，“发帖”按钮可用，页面保留在发送前 | 未点击发帖，未验证平台作品或回执；这不是工作台内置能力 |
| X 发布逻辑 | 当前实现包含 OAuth PKCE、短帖确认、回执、防重日志；针对短帖计数和本机图片拒绝的测试通过 | 真实回调、权限、余额、发帖、刷新和撤销仍未验收 |
| 掘金草稿 | 通过浏览器正常编辑控件填入公开样例，平台显示保存成功；25 行 Markdown 正常预览 | 这是浏览器辅助试验，不是工作台新增的内置自动发布功能 |
| 掘金目录和发布前流程 | 目标锚点存在；点击后 URL 指向正确片段；已打开发布面板，看到分类、标签、摘要、最终确认按钮 | 短样例不需要明显滚动；未点击“确定并发布”，不能认定已验证发布成功 |
| RSS 联网和存储 | 调用 0.4.0 编译库中的公网获取、解析、SQLite 订阅存储逻辑：Rust Blog 10 篇，sorrycc 20 篇 | 仅为源站提供的订阅内容，不是任意网页全文抓取 |
| RSS 重复刷新 | 两个源各再次获取并写入，新增重复文章均为 0 | 数据保存在独立试验目录，未写入正式资料库 |
| 阅读组件 | 复用正式 ReadingList / ReadingDetail，服务端渲染 30 行、来源筛选和展开按钮通过；生成独立 HTML | 没有完成本轮浏览器交互/视觉验收，也没有完成本轮原生阅读页验收 |

桌面工具在成功读取正式版设置页后，读取窗口遇到系统画面捕获错误。浏览器工具另外拒绝了 `file:` 本地预览地址（仅允许 HTTP/HTTPS）；没有绕过限制。独立 HTML 可由用户在本机打开。原生设置页的 X 未配置状态是本轮观察，其他原生功能不能沿用历史结果当作本轮通过。

## 本轮补验

用户确认尚无 X 开发者应用，本轮仅准备配置步骤，见 [第一次连接 X](x-first-connection.md)。

在独立资料副本上进一步验证：30 篇文章跨进程重开保留；真实刷新保留笔记和已读状态；笔记转稿件带来源；取消订阅保留文章、缓存内容和笔记；完整备份恢复后核心资料和订阅资料逐项一致。证据为本机 `artifacts/publishing-reading-trial-2026-11-02/lifecycle-verification.json`，不是原生 UI 验收。原只读展现样例和正式资料未写入试验笔记。

## 需要补齐的产品能力

### P1：真实 X 发布尚未连通

现有代码入口：`src/renderer/publishing/XConnection.tsx`、`XPublish.tsx`、`src-tauri/src/publishing/`。

最短用户流程应为：连接 X → 核对短帖和账号 → 确认发布 → 显示作品链接。维护者可以配置公开 Client ID，避免普通用户都去创建开发者应用；当前发行包尚未配置。凭证保持在系统钥匙串，应用配置与平台权限不能由本地预览模拟。

没有开发者应用时，可使用浏览器辅助路径先把文字送到已登录的发帖页。本轮已验证该路径的填充和发布前可用状态；后续可以评估为工作台提供明确标注的辅助入口。它不等于官方 API 授权、后台自动发帖或已收到平台发布回执。

官方 API 真实测试前需要：

1. 在 [X 开发者控制台](https://console.x.com/) 创建 Native App/public client，启用 OAuth 2.0。
2. Callback URL 精确为 `http://127.0.0.1:34187/oauth/x/callback`；公开 Client ID 在工作台本机填写。
3. 确认用户授权、读写权限、额度及费用；不在聊天中索要 Secret、Token、Cookie，不自动购买额度。
4. 核对账号和具体测试短帖，发送一次后核对平台作品及本机回执；超时不得盲目重发。

本轮核对的 [X OAuth 官方文档](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code)支持 Native App/public client 与 PKCE；[发帖接口](https://docs.x.com/x-api/posts/create-post)提供 `POST /2/tweets`。按[当前官方价格](https://docs.x.com/x-api/getting-started/pricing)，普通发帖为 $0.015/次，含 URL 的帖子为 $0.200/次；账号读取也可能计费，执行时以控制台价格和可用额度为准。

### P1：掘金需要独立的浏览器发布适配

本轮未找到可验证的、用于普通文章的官方 OAuth 发文接口文档。检索到“码上掘金作品发布 Token”页面，但不能据此认定它适用于普通文章。不要把第三方 Cookie 接口教程视为官方长期契约。

实际编辑器试验表明可以通过正常浏览器操作填入 Markdown、自动保存草稿、检查预览并到达发布面板。因此下一步可单独验证“送入草稿”的确定性浏览器适配器：

- 用户保持系统浏览器登录；工具不收集 Cookie，不调用未验证的私有发文 API。
- 用户选稿件后，填标题、正文与已准备图片，核对目录、代码、表格和图片结果。
- 分类和标签应记住用户选择，摘要可使用可编辑的首段文字；均不依赖 AI。
- 第一阶段停在发布前确认，用户确认后再执行最终发布并记录真实文章链接。
- 登录失效、验证挑战和页面结构变化要明确暂停；部分成功或超时不可重复创建/发布。

当前桌面版仍是“复制并打开掘金”，本轮浏览器试验没有把该适配器写入发行包。

### P1：订阅内容有了，但技术文章排版被丢弃

`src-tauri/src/feed_parse.rs:18` 的纯文字转换会删除 HTML 标签，并对每行调用 `split_whitespace()`：标题层级、列表结构、链接目标、图片和代码缩进都会丢失。`src/renderer/reading/ReadingDetail.tsx:81` 直接展示该文本，不是富文本阅读器。只修改前端 CSS 无法恢复已丢失的语义。

最短流程保持：添加订阅 → 点击文章 → 阅读；“打开原文”和笔记放在同一页。

下一步先做独立原型：

- 保留摘要用于列表和搜索；正文另存净化后的结构化内容，明确区分“全文”“摘要”“无正文”。
- 保留标题、段落、列表、表格、代码换行缩进和正常链接；禁止脚本、事件处理器、嵌入执行及任意样式。
- 图片使用用户触发的受限加载，不把订阅 HTML 中的图片直接交给浏览器联网。
- 源站只提供摘要时明确显示摘要并保留原文入口，不宣称已抓到全文。
- 旧纯文字缓存继续可读；格式升级前备份并保留旧版回退，不能让新库被旧版错误解释。

第一轮仍采用手动更新。后台刷新、定时发布、任意掘金作者或 X 时间线订阅是另外的能力，不是 RSS 地址输入框已经支持的功能。

## 本机体验材料

以下都在被 Git 忽略的 `artifacts/publishing-reading-trial-2026-11-02/` 下，仅供本机验证，不作为开源附件发布：

- `reading-preview.html`：可直接打开的只读预览，复用 0.4.0 阅读组件和本次真实抓取数据；支持文章选择、搜索、来源筛选、展开。编辑和保存操作禁用。
- `feed-verification.json`：真实抓取条数与二次刷新去重结果。
- `render-verification.json`：组件服务端渲染结果及未验收边界。
- `reading-data.json`、`isolated-reading-data/`：独立试验数据。
- `juejin-preview.png`、`juejin-before-publish.png`：掘金实际预览及发布前面板。
- `x-before-publish.png`：X 网页测试短帖与发布前按钮；未发送。
- `feed-probe.rs`、`reading-preview.tsx`、`build-reading-preview.mjs`：实验复现脚本，不进入正式应用。

真实来源：[Rust Blog RSS](https://blog.rust-lang.org/feed.xml)、[sorrycc RSS](https://blog.sorrycc.com/api/feed)。后者订阅地址来自博客首页的 RSS alternate 链接。

验证命令：`node --import tsx --test tests/publishing-reading.test.ts tests/juejin*.test.ts`，6 项通过。本轮未重跑全量发行 CI，也未发布新版本。

## 下一轮任务顺序

1. 阅读正文保留结构的原型与新旧数据兼容验证；用本次中文、英文真实源做展示对照。
2. X 开发者应用配置完成后进行一次有明确内容的真实发帖验收。
3. 掘金“送入草稿”适配器独立验证，保留现有复制方式回退；把自动填充、最终发布与回执核对分别验收。

开发交接：Read AGENTS.md and this document first. Keep the no-AI desktop workflow simple. Build a structured RSS reading prototype while preserving plain-text caches, user notes, backups and rollback. Do not claim native/browser acceptance from server-rendered evidence. X live publishing depends on a configured public client and an approved test post. Treat Juejin browser draft preparation separately from final publication; do not collect browser cookies or retry uncertain writes automatically. Keep experiments and third-party feed contents out of public release artifacts.

后续实现：0.5.0-dev.1 已完成订阅正文结构保留与兼容验证，结果见[订阅排版预览版](rss-rich-reading.md)。本报告的 0.4.0 研究观察作为历史基线保留。
