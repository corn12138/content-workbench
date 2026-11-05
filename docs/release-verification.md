# 发行验收

首版范围为 macOS Apple Silicon 本地基础工作流。平台自动发布、评论和指标不属于本次验收范围。

## 必需检查

```sh
npm ci
npm run typecheck
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run test:parity
npm run smoke:tauri
npm run release:mac
```

数据对照在独立临时目录创建非空稿件、历史、发布记录和阅读笔记，验证旧版 SQLite 升级及 v1 JSON 的双向核心数据兼容；旧 Electron 必须拒绝直接打开 schema 2。异常备份必须拒绝且保持原资料。实际用户资料不作为公开测试样本。

原生桌面验收覆盖编辑、导航、脚本隔离、人工发布记录、阅读笔记转稿、窄窗口和关闭保存。调试冒烟不能替代正式应用包的启动与持久化检查；首次公开包还需手动打开正式包确认。

## 公开内容检查

```sh
npm run audit:source
gitleaks git . --log-opts='--all --full-history' --redact --ignore-gitleaks-allow --no-banner
```

另对导出的源码、展开的第三方源码、安装包及其展开内容做文件清单、敏感信息与个人路径检查。仅扫描 Git 跟踪文件不能代替安装包检查。公开安装包不包含数据库、备份、日志、测试探针或个人账号凭据。

检查应用资源包含项目许可证、NOTICE、第三方声明、依赖许可证和适用的 MPL 源码。发布 SHA-256 校验文件，上传后重新下载对照；确认远端 main、版本标签和发行目标提交一致。

## 已知边界

- 本机验收系统为 macOS 27.2 arm64；配置的最低版本为 macOS 12，但旧系统未逐一实测。
- 首版只有 ad-hoc 签名，没有 Developer ID、公证或自动更新。ad-hoc 签名不提供开发者身份认证。
- 旧数据中不成对的 UTF-16 代理字符会中止迁移并保留原件。
- v1 备份仅包含文字资料、历史和记录，不包含外部图片资源。
- 剪贴板测试在已有非文本内容时跳过，报告中须与通过区分。
- 睡眠唤醒、渲染进程完全无响应、长期试用和其他桌面平台不属于已验收范围。

每次发行的实际结果与限制记录在 GitHub Release；不得用本流程清单本身宣称检查通过。

## 0.1.0 自动检查记录

- TypeScript 类型检查与 12 项数据测试通过。
- Rust 内核与迁移 18 项测试通过。
- 两版数据对照 14 项检查通过。
- 原生测试的窗口关闭、应用退出两阶段通过，包含保存前待提交编辑检查；本次原生剪贴板也通过。脚本退出场景不等于真实键盘快捷键测试。
- 源码候选、展开的第三方源码及初始 Git 历史扫描未发现秘密或本机个人路径。发行包须在封装完成后另行扫描。
- npm audit 为 0 项告警。cargo-audit 漏洞类告警为 0；完整跨平台锁文件另有 4 项 unmaintained 和 1 项 unsound 提示。

Rust 提示对应 `proc-macro-error`、`zbus_names`、`zvariant`、`zvariant_derive` 和 `glib`，均不在 `cargo metadata --filter-platform aarch64-apple-darwin` 的已解析依赖图内。`glib` 的问题记录为 [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)。这些提示仍需在后续 Linux 支持前处理，不将“漏洞类告警为 0”描述成所有目标都没有依赖问题。

## 0.2.0 发行范围

图片、完整备份和 RSS 功能实测见 [功能验收记录](media-backup-rss-verification.md)。正式包使用 0.2.0 版本号重新构建，源码和安装包须分别完成秘密、个人路径、文件清单与授权声明检查，上传后重新下载校验。

保留 v0.1.0 标签、下载资产及 Electron 入口；资料格式的回退步骤见 [升级与回退](upgrade-and-rollback.md)。

## 0.3.0 发行范围

增强 Markdown 预览和掘金默认编辑器基础排版、RSS 聚合阅读、实验性 X 授权与纯文本发布。掘金测试仅保留为草稿，未发文；真实 X 授权和发帖未验收。明确的后续边界见 Issue #3 和 #4。

本轮 Node 22 项、Rust 40 项离线测试、14 项数据对照和原生关闭/退出两阶段通过；原生测试额外验证三处预览一致性与九类掘金实测字号/行高。剪贴板专项仍标记为跳过。完整 UI 像素与平台最终发布页不属于已通过项。

发布保留 v0.2.0、v0.1.0 和 Electron 入口；schema 3 回退方法见升级文档。最终发行包启动、源码/包扫描、下载校验与远端提交一致性必须在 Release 中据实记录。

## 0.5.0 发行范围

功能补齐（发布准备、X 网页辅助、OPML 与笔记整理、作品反馈、备份回执与恢复预检）与自动更新（后台下载、退出时安装）。逐项状态见[功能补齐报告](functional-completion-report.md)。

本机检查（macOS arm64，候选提交见 Release）：`npm ci`、typecheck、Node 57 项、前端与 Electron 构建、`cargo test --locked` 60 项通过（4 项忽略：真实发行包安装、两项联网、预览样本）、14 项数据对照、源码审计、原生两阶段 smoke（redClose / menuQuit）均通过。数据对照第一次在机器高负载时因探针超时退出，单独重跑通过。`npm audit` 因审计服务返回错误未能完成，以 CI 结果为准。

发行包：`release:mac` 构建的 0.5.0 应用通过 `codesign --verify --deep --strict`；用独立临时资料目录启动成功并建立 schema 5；应用包内没有本机用户路径、数据库、日志或备份，gitleaks 未发现泄露；许可证与第三方声明在 `Contents/Resources/legal`。签名更新包通过 `packaged_release_installs_and_preserves_rollback`（临时目录安装、签名与版本、旧应用与资料备份）。

未验证：从已安装的 0.4.0 经线上通道更新到 0.5.0、退出时安装在真实安装位置的执行与重新打开、X 官方 API 真实账号、掘金最终发布页。这些需在草稿发行公开后实际验证。
