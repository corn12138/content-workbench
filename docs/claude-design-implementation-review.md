# Claude Design 原型与工程接入核对

日期：2026-11-03（America/New_York）。范围：核对设计原型与现有桌面功能，补充开发接手约束；本轮没有修改生产代码、运行资料或原始设计文件。

## 结论与设计来源

这套「安静纸面 / Quiet Paper」方案可以作为 UI 实现参考。主导航、暖白与绿色配色、写作工具栏、连续阅读区域、可收起笔记，以及窄窗口列表 / 详情切换，符合现有产品方向。

来源：[Claude Design 在线原型](https://claude.ai/artifact/JfurtCy2sZ4fVqbdVjBk6s#play-15dd8cd198dd)。本地已经存在用户提供的 `docs/design/ui-spec.md`、`design-tokens.css` 和 `prototype/`。这些输入本轮保持原样，尚未纳入 Git；不要覆盖、移动、丢弃或把它们当作已实现的应用代码。

接手顺序：适用的 `AGENTS.md` → [开发交接](claude-development-handoff.md) → 本文 → `docs/design/ui-spec.md` → token 和原型。设计布局以实际交付为参考；涉及已有保存、安全、授权和数据行为时，按本文校正处理。用户后续反馈优先。

## 本次实际查看的内容

| 范围 | 观察结果 | 验证边界 |
| --- | --- | --- |
| 1180×800 稿件页 | 原型展示稿件列表、正文编辑、预览切换、保存状态、历史和发布入口 | 没有验证生产编辑器或实际持久化 |
| 1180×800 阅读与笔记 | 已点击阅读和笔记；展开笔记后隐藏文章列表，保留文章列表返回按钮与正文空间 | 自动保存由原型计时器模拟，不能据此证明笔记不丢失 |
| 发布准备 | 已从稿件进入独立发布页面；掘金展示准备图片、复制打开与回填链接，切换 X 后显示最终短帖和确认入口 | 没有点击实际发帖、授权或平台打开动作；`@cw_demo` 与回执为演示数据 |
| 800×620 阅读与笔记 | 已打开独立最小窗口画板并展开底部笔记抽屉，正文与返回文章列表入口可见 | 这是指定尺寸的原型画板，尚未验证真实 Tauri 窗口连续缩放和键盘遮挡 |
| 1440×900、记录、设置、错误状态 | 已核对设计规范及原型源码 | 未逐一点击全部状态，也未做完整键盘与辅助技术验收 |

截图保存在本机被忽略的 `artifacts/claude-design-review-2026-11-03/`：`reading-with-notes.png`、`compact-reading-notes.png`。同目录 `design-inputs.json` 记录输入文件哈希；换机器不保证存在。没有重新运行应用测试或远端 CI，不沿用历史通过结果作为本轮 UI 实现验收。

## 进入开发前要校正的内容

### P1：保存失败时的另存不能导出旧内容

设计规范 §5.1 / §7.1 增加「另存为 Markdown 副本」。现有 `WorkbenchAPI.exportDraft(id)` 只传稿件 ID，`src-tauri/src/files.rs` 从数据库调用 `export_article(&id)`；它无法带走编辑区尚未保存的最新输入。

保留这个恢复目标，但不能将按钮直接绑定到旧导出接口并声称已保全未保存内容。第一批 UI 先保留输入、展示持久错误与重试；另存能力需独立实现接收当前编辑快照的受限原生文件保存接口，验证失败输入完整导出、取消不丢字、图片引用含义准确。未完成时不展示可用的另存按钮。

### P1：笔记切换必须保留真实的失败保护

规范 §5.3 希望静默保存后切换；现有 `ReadingView.tsx` 已在切换前等待 `editor.flush()`，失败后才提示留在当前文章。原型 `Main.dc.html` 的 `setNote` 通过内存与计时器改为 saved，不能替代这一保护。

成功保存时保持顺畅切换；保存失败时继续保留当前输入、显示具体错误与重试，不通过卸载编辑组件或忽略异常来消除阻碍。若实现跨文章的未保存草稿缓冲，需要同时处理可见未保存状态、逐篇恢复和退出保存，再单独验证。收起笔记、隐藏列表和改变断点不应销毁编辑状态。

### P1：保留生产 Markdown / RSS 渲染与平台发送保护

`prototype/Main.dc.html` 内 `parseMd` 与 `Article.dc.html` 是简化示意，图片加载、授权、备份、更新和发布也有模拟计时器。仅移植布局与组件视觉，继续使用现有 `MarkdownContent`、HTML 净化、公式、Mermaid、作用域锚点和图片按需加载。

发布从弹窗改为同页区域时，仍需固定所选稿件版本、先完成保存、阻止重复操作、保留最终账号与短帖确认。网络请求中的切页 / 返回 / 关闭、结果待核实和真实 API 回执均沿用当前约束。演示账户、作品、模拟控制面板与定时成功状态不进入产品。

### P2：区分应用截断与来源只提供摘要

规范 §5.3 把 truncated 描述为「订阅源只提供了前段」。当前 `feed_parse.rs` 的 `truncated` 是应用在超过 100,000 个字符时主动截取产生的标志。

对应文案改为「内容较长，工作台仅保留前段，请打开原文阅读」。`kind: summary` 才使用「来源仅提供摘要」。保留旧文字缓存、无内容与正文四类真实状态，不能为了同一张状态条合并语义。

### P2：设置中的新信息和确认流程需要真实接口支持

规范 §5.5 / §7.6 要展示备份文件名、大小、位置、上次备份时间及在访达中显示；当前 `backup()` 和 `restoreBackup()` 返回 boolean。恢复的原生实现已经包含选文件、确认、验证与写入，不能在调用完成后再假装进行首次确认。

第一批可使用真实成功 / 取消 / 失败结果与现有系统确认。详细文件回执、持久的上次备份时间和选文件后内嵌确认需另行扩展契约，并同步实现 Electron 能力降级。不能硬编码示例文件名、大小、时间、版本或错误原因。规范“只有 X 有弹窗”的视觉规则不取消原生恢复、关闭恢复选择或升级保护。

### P2：交互新增与默认行为要明确

- 自动标为已读：规范 §12 自己列为待确认。本轮默认保留现有显式「标为已读 / 未读」，不要仅因重绘、初始化选中或切换布局修改阅读状态。
- 日期分组、阅读时间、下一篇、撤销归档、失败来源单独重试、发布记录筛选和新增快捷键是额外交互工作。按任务逐项实现与验证，不能把原型中的数组和示例日期带入正式版。
- X 长文预填文案必须对应 `initialXText()` 的实际行为；当前长文只带标题，不能承诺自动生成简介。重新打开 OAuth 页面也需核对接口能力，不能随意创建并发授权请求。
- 原型固定尺寸 props 不证明响应式已完成。按真实容器宽度处理断点，尤其验证切换布局时焦点、滚动位置和未保存笔记。
- CSS token 可逐步映射；不要把原型的全局选择器或复制的 `.markdown` 样式直接覆盖到现有渲染器。macOS 交通灯使用真实窗口控件。

## 原型源码的使用方式

`*.dc.html` 使用 Design canvas 的 `DCLogic`、`x-dc` 与 `sc-*` 模板。导出的文件引用 `support.js`，部分 CSS 路径依赖原设计环境；它们不是可直接替换应用入口的普通 React 源码。

使用在线原型核对交互，使用本地规范、token 与模板理解层级，再落到现有 React 组件和原生命令。无需引入 Design canvas 运行时，也不要为了让示意原型运行而更换项目构建栈。

## 给 Claude 的落实顺序

1. 阅读区连续滚动、笔记面板、列表退让与小窗口返回；保留保存失败屏障和现有阅读状态。
2. token、应用壳、稿件列表、写作工具栏和专注模式；共享 Markdown 不改语义。
3. 同页发布准备、发布记录与设置；逐项映射真实接口，不支持的增强明确留待后续。
4. 根据最终交互更新原生 smoke，执行开发交接中的类型、单测、数据对照与桌面验证；输出独立可打开的预览包和截图，保留旧版。

本轮结论是“设计材料已到位，可以开始接入”，不是“设计已获得用户最终认可”或“产品 UI 已实现 / 验收 / 发布”。

## English kickoff

Read the applicable AGENTS.md instructions, docs/claude-development-handoff.md, and docs/claude-design-implementation-review.md. The Claude Design delivery is now present in docs/design/: read ui-spec.md, design-tokens.css, and prototype/README.md, and inspect the linked interactive artifact.

Implement this design in the existing Tauri, Rust, and React application, starting with continuous article reading and responsive notes. Use the review document to resolve conflicts between prototype behavior and production contracts. Preserve Markdown rendering, autosave failure protection, existing data, backups, and Electron rollback. Keep explicit read-status changes for this iteration.

Treat the Design canvas files as design references. Replace every simulated operation with the existing real APIs, and explicitly defer enhancements that need new contracts until they are safely implemented. Verify the changed workflows and deliver a separate, directly openable desktop preview. Do not stop at a plan, publish social posts, or release update artifacts. Report actual results and remaining limits in Chinese.
