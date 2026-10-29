# 内容工作台 Content Workbench

面向个人开发者的无 AI 本地桌面应用：写稿、辅助发布、整理阅读笔记。资料保存在自己的电脑，首次打开无需注册或配置模型。

A local-first desktop workspace for developer writing, assisted publishing and reading notes. Built with Tauri 2, Rust and React. No AI service or account is required for the local workflow.

**0.1.0 开发者预览版**。已验证 macOS Apple Silicon；Windows、Linux 和 Intel Mac 尚未验收。

## 下载与开始

从 [Releases](https://github.com/corn12138/content-workbench/releases) 下载 `content-workbench-0.1.0-macos-arm64.zip`，解压后将「内容工作台.app」放入应用程序目录并打开。

首版未使用 Apple Developer ID 签名或公证，macOS 可能阻止首次打开。请先核对下载来源和发行页 SHA-256；确认信任后可在系统设置的「隐私与安全性」中使用系统提供的打开选项。不要关闭系统全局安全保护；不希望运行未公证应用时，可按下方步骤从源码构建。

1. 在「稿件」新建或导入 Markdown，编辑会自动保存。
2. 审核后使用掘金辅助发布，复制正文并打开平台，完成发布后回填文章链接。
3. 在「阅读」保存链接和笔记，将笔记转为带来源的草稿。
4. 在设置中备份资料；恢复前应用会保存当前资料的恢复副本。

## 当前能力

- Markdown 文字导入、正文去重、新建、搜索、归档和恢复。
- 编辑自动保存、历史版本和版本恢复，切页及退出前等待保存。
- Markdown 预览不执行原始 HTML，不自动加载远程图片。
- 掘金辅助发布与人工确认记录；反馈页展示已保存的作品记录。
- 阅读链接、笔记、已读状态和笔记转稿。
- SQLite 本地存储，文字资料、历史版本与关联记录的 JSON 备份恢复。

**尚未实现**：图片资源随稿保存、X 自动发布、评论及浏览量同步、RSS/Atom、后台采集、云同步和自动更新。图片目前仅保留 Markdown 引用，发布时需在平台补充。关闭窗口后应用退出，不持续采集；反馈页不会生成模拟评论或统计。

## 开发与验证

需要 macOS、Node.js 24、Rust stable 和 Xcode Command Line Tools。

```sh
npm ci
npm run dev
```

```sh
npm run typecheck
npm test
npm run test:rust
npm run test:parity
npm run smoke:tauri
```

`smoke:tauri` 需要可用的 macOS 图形会话，会打开测试窗口；测试只使用独立的临时资料，不向平台发帖。没有图形会话的 CI 使用构建与数据测试，不把它们当作桌面交互验收。

```sh
npm run release:mac
```

发行构建会移除编译路径中的本机用户目录，并将许可证和第三方声明放入应用包。输出为 `release/tauri-macos/内容工作台.app`。`npm run package:mac` 用于一般本机打包；公开发行应使用 `release:mac` 并检查最终产物。

## 数据与回退

Tauri 正式应用资料在 `~/Library/Application Support/local.contentworkbench.tauri/`，开发资料在 `.tauri-data/`。备份含正文，属于私人资料，请自行安全保存，不要上传到 Issue。

首次运行会验证并复制已有 Electron 资料，原目录 `~/Library/Application Support/content-workbench/` 保留；迁移失败会提示错误，不以空白资料掩盖失败。两版资料不自动同步，切回 Electron 前需在 Tauri 导出备份，再从 Electron 恢复。

Electron 源码和构建入口继续保留：`npm run dev:electron`、`npm run package:electron`。首发下载包仅提供 Tauri；需要回退时可从源码构建 Electron。构建回退包时也应保留其运行时的第三方许可证。

## 参与与文档

- [贡献指南](CONTRIBUTING.md) 与 [社区行为规范](CODE_OF_CONDUCT.md)
- [安全反馈](SECURITY.md) 与 [隐私说明](docs/privacy.md)
- [架构和数据边界](docs/architecture.md)、[路线图](docs/roadmap.md)
- [发行验收](docs/release-verification.md) 与 [变更记录](CHANGELOG.md)

本项目采用 [Apache-2.0](LICENSE)。依赖保留各自许可证，详见 [第三方声明](THIRD_PARTY_NOTICES.md)。平台服务的账号权限和费用不由开源许可证覆盖。
