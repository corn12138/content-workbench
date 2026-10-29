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

数据对照在独立临时目录创建非空稿件、历史、发布记录和阅读笔记，验证两版 SQLite 与 v1 JSON 的双向兼容。异常备份必须拒绝且保持原资料。实际用户资料不作为公开测试样本。

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
