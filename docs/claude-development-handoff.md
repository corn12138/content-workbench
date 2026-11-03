# Claude 开发接手任务：舒适桌面 UI 与阅读体验

核对日期：2026-11-03（America/New_York）。本文件是可以直接执行的开发任务。用户已授权继续开发；按下面范围完成代码、验证和独立预览，不要只返回计划。

## 接手入口与事实优先级

工作目录为归档项目的 `content-workbench/source/`，它就是 Git 仓库根目录。`../legacy/` 是保留的旧工程与 Electron 回退。不要在旧目录继续开发。

先读取工作区与仓库中存在的 `AGENTS.md`，再完整读取本文件和 `claude-design-brief.md`。若环境没有实体 `AGENTS.md`，本文件已经包含本次交接所需约束，不要因此停止。用户新指令优先，其次是适用的仓库约束、本任务及当前代码，历史文档用于补充背景。

接手时重新执行 `git status --short --branch`、`git log -5 --oneline` 和 `git diff --stat`。本次核对工作树干净，位于 `feat/rss-rich-reading`，HEAD 为 `c98f426596df039e18ed5517e9324c4a7a4189a2`，版本为 `0.5.0-dev.1`。该提交包含结构化 RSS 阅读与兼容升级。开始时确认此提交已在当前工作基线中；不要只从较老的远端 main 开工而丢掉本地成果。若接手后有新改动，保留它们，按实际状态调整，不要 reset、stash 或强制切换覆盖。

公开仓库：`https://github.com/corn12138/content-workbench`。2026-11-02 的交付记录显示正式版基线为 0.4.0，本地 0.5.0-dev.1 未发布。本次只核对本地代码与报告，没有重新查询远端 Release / CI；任何远端状态必须实时确认后再报告。

注释只写代码本身看不出的原因、约束与取舍；不要记录中间尝试。PR 描述只写最终行为和必要取舍，不叙述开发过程。

## 本轮目标

将现有应用升级成日常使用舒适、流程简单的个人写作与阅读工作台，保留已有数据、安全限制、平台流程和回退能力。

优先解决：长文阅读空间不足、主要与次要动作区分、页面视觉一致性、未配置与失败状态的下一步指引。基于 Tauri 2 + Rust + React + TypeScript 与现有普通 CSS 实现，延续无 AI、本地优先、免费开源的定位。

Claude Design 的完整设计任务见 [claude-design-brief.md](claude-design-brief.md)。若已有设计交付，先读取 `docs/design/ui-spec.md`、token 和原型；若尚未交付，直接按该 brief 的默认方向开展布局、交互和状态实现，不把等待设计作为整个任务的阻塞。独立记录采用的视觉假设，后续用设计 token 对齐，不伪称获得了设计验收。

本轮不新增 AI、登录工作台账号、云同步、付费体系、定时发布、评论统计或任意网页全文采集。X 缺少开发者应用不能阻止本地 UI 与阅读开发。平台自动化属于后续独立任务，不用模拟接口代替真实验收。

## 已完成能力与代码地图

| 页面 / 模块 | 主要文件 | 当前行为与保留要求 |
| --- | --- | --- |
| 壳、导航、加载与切页 | `src/renderer/App.tsx`、`Sidebar.tsx`、`styles.css` | 通过 React view 切换，没有 URL 路由；切页与退出前会等待保存 |
| 稿件列表、编辑、历史 | `DraftsView.tsx`、`DraftEditor.tsx`、`useDraftEditor.ts` | 自动保存、冲突保护、归档恢复、图片导入、历史预览与恢复 |
| 发布准备 | `PublishDialog.tsx`、`publishing/` | 掘金复制并打开、图片准备、目录副本适配；X 短帖配置与确认发送实现 |
| 已发布作品 | `FeedbackView.tsx` | 真实的人工记录 / API 回执，尚无评论与浏览量；本轮 UI 名称改为「发布记录」 |
| 阅读与来源 | `ReadingView.tsx`、`reading/FeedPanel.tsx`、`ReadingList.tsx`、`filterReadings.ts`、`orderReadings.ts` | RSS 添加、手动更新、去重、来源过滤、缓存搜索、按发布时间排序 |
| 阅读正文与笔记 | `reading/ReadingDetail.tsx`、`FeedExcerpt.tsx`、`useReadingEditor.ts` | HTML / 纯文 / 摘要 / 缺省旧缓存，已读、笔记保存与带来源转稿 |
| Markdown 与 HTML 展示 | `Markdown.tsx`、`markdown/MarkdownContent.tsx`、`pipeline.ts`、`article-theme.css`、`reading/feedHtml.ts` | 共用安全渲染、公式、Mermaid、表格、隔离锚点、相对网址与同文绝对脚注；图片按需加载 |
| 设置与更新 | `SettingsView.tsx`、`updates/` | 完整备份恢复、数据位置、平台设置、检查更新与用户确认升级 |
| 前后端边界 | `src/shared/contracts.ts`、`renderer/api.ts`、`tauri-api.ts` | `window.workbench` 桌面桥接；没有生产浏览器假数据库 |
| 业务、持久化、网络 | `src-tauri/src/store/`、`feed_parse.rs`、`feed_fetch.rs`、`feed_commands.rs` | schema 4、严格备份校验、公网请求限制、刷新代次与迟到响应保护 |
| 授权与发送 | `src-tauri/src/publishing/` | PKCE、钥匙串、防重日志、未知结果不自动重发；真实 X 账号未验收 |
| Electron 回退 | `src/core/`、`src/desktop/` | 独立旧资料和文字能力，不能直接读新版 Tauri 数据库 |

表中未写完整路径的前端文件都相对于 `src/renderer/`。

需要特别纠正的历史文档：`docs/architecture.md` 仍有“预览禁用原始 HTML”“RSS 前端纯文本”“schema 3”等旧描述。当前事实为允许净化后的 HTML 展示、可选结构化订阅正文、schema 4；以代码和 `docs/rss-rich-reading.md` 为准。交付时把这些直接相关的陈旧说明更新为最终行为，不重写无关文档。

## 必须保护的行为

- `App.tsx` 的保存屏障、action 锁、关闭握手，以及编辑和阅读 hook 的失败保留、冲突及迟到响应保护。重排组件不能靠重新挂载丢弃未保存内容。
- `.markdown` 内文章主题与共享渲染链。页面壳的新 CSS 不得污染文章字体、标题、代码、表格、公式、Mermaid 或锚点。若确需触及文章主题，单独说明理由，并重跑同宽对照。
- RSS 的 HTML 净化、长度 / 深度限制、纯文 Atom 原样显示、图片明确点击后受限加载。禁止 `dangerouslySetInnerHTML`、自动外链图片或通过 WebView 直接访问受限网址。
- X 的账号确认、最终短帖、长度检查、防重与结果待核实；掘金的辅助发布和人工回填边界。复制成功、打开网页、准备图片都不能被记录为已发布。
- 完整备份、schema 4 与 schema 3 升级前副本；新版 `.cwb` 格式 3、可读取旧格式 2。UI 调整本身不需要再次更改数据版本。
- 不动 `../legacy/`、正式应用资料、钥匙串内容、已有发行包、更新公钥及签名材料。不将真实资料、Cookie、Token、私有路径或抓取正文提交到 Git。

这些是保留行为的要求，不是逐文件审批要求。普通重构可直接做；发现会改变数据格式或授权含义的需求时，先把它从本轮 UI 工作分离，说明依据和影响，继续完成独立工作。

## 执行顺序与验收

### A. 建立可回归基线并完成阅读页

读取最近报告，运行必要的当前基线检查，使用独立测试资料启动实际桌面应用。先完成阅读页的列表、来源与搜索、连续长文、笔记、空状态及网络失败状态。

将约 290px 高的正文嵌套滚动区改成适合长文的主阅读区域。默认正文可连续阅读；宽表格和代码可独立横向滚动，页面本身不能横向溢出。设计若保留折叠，折叠不能成为阅读全文的障碍，且控件出现条件应按实际布局判断。笔记可按宽度收起，但输入与保存状态必须保留。

验收：切换中文 / 英文文章、图片待加载、摘要 / 正文 / 旧缓存、超长代码和表格均可读；来源过滤、跨来源缓存搜索、排序、取消订阅保留资料不回归。切页、切文章、收起笔记、转换成稿件和退出后重开不丢笔记。添加一个源失败应在原位置可修正，刷新部分失败不清空其他文章。

### B. 完成写作与整体界面

建立少量稳定 CSS token，统一按钮、状态、列表、输入和弹窗，保持现有组件边界。主导航顺序为稿件、阅读、发布记录；设置在底部。大文件按职责拆分，不引入全套 UI 框架或替换编辑器内核。

稿件页突出标题、正文与「准备发布」，保留正文 / 预览切换、自动保存、历史、导出和归档恢复。失败保留输入并可重试；初次使用能直接导入或新建。修改组件名称或文案时同步语义测试定位，不能删掉相关断言让测试通过。

验收：800×620、1180×800、1440×900 均可用；窄窗口不靠缩小全部文字解决布局。Tab 顺序合理、焦点可见，弹窗正常关闭后返回触发控件，发布 / 恢复 / 升级处理中保持原有关闭限制。不存在仅悬浮可见的必要操作。

### C. 发布准备、发布记录与设置

按设计整理掘金和 X 的状态：先让用户看到具体下一步，再按需展开配置。保留掘金图片顺序、失败项、目录副本与回填链接。X 未创建应用的事实必须真实呈现；授权入口和失败 UI 可用本地测试状态验证，不能冒充真实平台授权。

发布记录只展示已有作品与来源，不生成示意评论或统计数据。设置清晰组织本地资料、平台连接、应用更新；数据路径与首次连接细节渐进展开。自动检查仍由用户决定是否升级，回退入口继续可见。

验收：无稿件、无记录、未配置 X、取消授权、准备图片失败、保存链接失败、备份取消 / 失败、检查更新失败，都有清楚的当前状态和下一步。正常编辑不弹额外确认。真实对外发送只在账号和具体内容得到用户授权后执行，本任务不要求发送测试帖子。

### D. 交付设计实现与可打开的独立预览

完成 A–C 后，若设计材料已经可用，按 token 和页面规范完成对齐；缺少材料时交付按默认方向完成的可用版本，并注明视觉规范待最终对齐。输出关键页面截图与交互说明，更新相关文档，完成检查。

在 `release/` 下使用新的独立预览目录，不覆盖 0.4.0 正式应用和已有阅读试用包。试用版使用独立的 `WORKBENCH_TAURI_DATA_DIR` 与 bundle identifier，避免落到默认开发资料或与正式应用抢占单实例。若制作供本机直接双击的预览包，确认独立资料配置随启动生效，且不要把携带本机路径的包当作公开发行包。

保留可回退的 Git 提交，交付实际应用路径。不要把本轮结束设为“等待确认下一步开发”；完成可独立实现的内容后报告。本任务交付本地可体验版本，不自动对外发帖、推送 Release 或发布更新包。

## 验证与证据

2026-11-02 基线记录：27 项 Node 测试、46 项 Rust 测试通过（另有 3 项专用测试跳过），Electron / Rust 数据对照 14 项通过，原生两阶段 smoke 通过。两个真实来源共 30 篇，备份往返与旧数据升级通过。完整屏幕视觉检查受系统捕获失败影响；这些是历史基线，不能写成你本次变更已通过。

本机报告可能位于 `artifacts/rss-rich-reading/verification.json`、`artifacts/tauri-comparison/native-smoke.json`、`data-parity.json`；这些路径被 Git 忽略，换机器可能不存在。没有报告时使用仓库内测试 fixture 复现，不阻塞工作。

UI / 文案变更至少运行：

```sh
npm run typecheck
npm test
npm run build:frontend
```

涉及 Rust、存储、契约或迁移时再运行相关 Rust 与数据对照检查；本轮交付前应确认它们没有被 UI 改动间接破坏：

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib --offline
npm run test:parity
```

若本机依赖缓存不全，正常获取依赖后执行同一测试，不把缓存缺失当成功。原生验证使用真实 Tauri WebView；浏览器设计原型不能代替。可沿用现有脚本并给测试构建独立标识：

```sh
npx --no-install tauri build --debug --bundles app --config '{"identifier":"local.contentworkbench.uidesignsmoke"}'
node scripts/smoke-tauri.mjs --packaged "src-tauri/target/debug/bundle/macos/内容工作台 Tauri.app/Contents/MacOS/content-workbench-tauri"
```

运行前确认同标识测试应用未运行。脚本会创建带保护标记的临时测试库，不能改成正式资料。`npm start` 默认打开原有正式包，不适合作为新代码验证入口；单跑 Vite 也没有真实桌面桥接。

调整 `tests/tauri-smoke.js` 以适配明确改变的布局与文案，同时保留它验证的语义：Markdown 编辑 / 历史 / 发布同宽对照，代码和锚点，图片按需加载，RSS 阅读和窄窗口，笔记、发布记录、完整备份、关闭保存及重开。若默认改为连续全文，替换旧“必须点击展开”的假设，验证全文可达、笔记可操作和切换保留；不要继续维护与新设计相冲突的 UI 断言。

需要人工核对的路径：稿件 → 编辑 / 预览 / 历史 / 发布；阅读 → 来源与搜索 / 全文 / 笔记转稿；发布记录；设置 → 备份 / 连接 / 更新。无法截图或缺少 GUI 时，记录具体受限项，保留独立可打开包，不宣称像素一致或人工验收通过。

测试只覆盖真实风险，不为颜色常量或样式实现写镜像断言。新增依赖要有理由并更新许可证；准备公开变更前按项目流程检查源码路径与密钥，不能将 `artifacts/`、资料库、Cookie、Token 或本机预览包作为公开附件。

## 后续队列，避免混淆为本轮完成

1. X：用户创建 Native App / 公开 Client ID 后，按 `docs/x-first-connection.md` 核对当时官方要求，再进行一次明确账号和内容的真实授权 / 发布 / 回执测试。密钥不进入聊天，费用由用户核对。
2. 掘金：浏览器“送入草稿”适配器独立研究和实现，保留当前复制方式；登录失效与验证挑战可交回用户处理；图片上传、最终发布和回执各自验收。
3. 评论、阅读量与后台聚合：先确认各平台可用接口、权限、费用和指标含义，再单独设计；当前不假装支持。
4. 正式开源发版：另行核对远端 CI、版本、脱敏、签名更新和回退后发布，不用本地构建成功代替线上交付。

## 结束时需要给用户的结果

用简洁中文说明完成了什么，提供独立预览包与关键页面截图，列出本次实际测试结果、受限项目、提交与是否推送 / 发布。区分“界面已实现”“真实平台已验证”“仍缺外部条件”。交付文档说明最终行为，不保留已放弃的实现过程。

## English kickoff prompt

You are taking over development of Content Workbench in this repository. Read all applicable AGENTS.md instructions, then read docs/claude-development-handoff.md and docs/claude-design-brief.md in full. Verify the working tree and ensure your baseline includes commit c98f426596df039e18ed5517e9324c4a7a4189a2 and any newer local work. Preserve unrelated edits, existing data, Markdown rendering parity, backups, and Electron rollback.

Implement the scoped desktop UI and reading improvements described in sections A through D. Start with the reading experience, then complete writing, publishing preparation, publication records, and settings. Use the Claude Design deliverables when available; otherwise proceed with the documented default direction and record that assumption. Work through implementation and verification to a separate, directly openable Tauri preview. Do not stop after a plan or let missing X developer credentials block local work.

Keep external publishing claims accurate. Run the applicable tests and native checks, update the relevant documentation, and report actual results in Chinese. Preserve the old app and all production data. Finish with the preview path, screenshots where available, commit state, and any remaining verification limits. Do not publish social posts or release/update artifacts as part of this handoff task.
