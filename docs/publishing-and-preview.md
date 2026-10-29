# 发布授权与聚合预览

本轮开发版本为 0.3.0-dev.1，保留 0.2.0 正式下载和 Electron 回退。无 AI、无工具账号体系。

## 用户操作

- 掘金：预览 → 复制并打开掘金 → 在原平台发布 → 粘贴作品链接。系统浏览器处理登录，工作台不获取密码或 Cookie。
- X：首次配置应用 → 连接 X → 修改短帖 → 核对账号与内容 → 确认发布。成功后自动记录平台回执；纯文本单帖，不自动拆线程或上传图片。
- 阅读：添加 RSS/Atom → 更新 → 搜索标题、缓存内容或笔记，按来源、未读筛选 → 查看内容 → 记笔记。源站提供全文时优先显示全文，最多 2 万字符，去除 HTML，保留段落，不加载远程图片。

## X 首次配置

在 <https://console.x.com/> 创建 Native App（public client），开启 OAuth 2.0 与读写权限。

Callback URL 必须精确填写 `http://127.0.0.1:34187/oauth/x/callback`。网站地址填写自己的公开项目主页。将公开 Client ID 填入工作台“设置 → 平台连接 → 首次连接”。不填写 Client Secret、访问令牌、密码或 Cookie。

连接时系统浏览器打开 X 授权页，允许后返回本机回调。等待最多 3 分钟，可以取消。端口被占用时明确报错，不临时更换已登记的地址。没有开发者应用时，本地写作、掘金辅助发布和 RSS 均可继续使用。

发行维护者可在构建时提供公开 `WORKBENCH_X_CLIENT_ID`，让用户直接连接账号；当前没有内置应用。开发者应用权限、真实回调接受情况、余额和付费由应用所有者在 X 控制台确认；工具不会购买额度。连接会读取一次账号资料，发布会调用写入 API，均可能计费。

## 安全与结果边界

- 使用随机 state、PKCE S256；仅监听 IPv4 loopback，校验回调路径、Host、state 和重复参数。无嵌入式网页登录。
- access/refresh token 仅通过 Rust 进入 macOS 钥匙串，按资料目录隔离，不进入渲染器、SQLite、备份、日志或仓库。当前其他系统不开放凭证保存。
- 令牌到期按需刷新，先保存轮换后的令牌再发帖。断开首先删除本机凭证，再请求平台撤销；网络失败会提示到 X 撤销。取消授权可能已在平台留下应用许可，可在 X 的已连接应用撤销。
- API 错误只返回固定提示，不直接展示可能包含凭证或原文的响应体。使用固定 HTTPS API 地址、禁用重定向、超时和响应大小限制。
- 发布先将账号、稿件、正文的哈希记入 `publish-journal.sqlite`，再发送。响应丢失、超时或服务端错误保留待核实状态，不自动重发。相同稿件、账号和内容再次点击会返回已有回执或阻止重复；复制成另一稿件仍可能重复，不能视为平台幂等保证。
- 待核实的内容需先到个人主页查看；已发布时可手动记录链接。当前不提供“强制重发”按钮，避免把网络不确定性转成重复帖子。
- 发布日志不含正文或凭证，不随资料备份恢复回滚。换机或删除整个资料目录不会保留该防重状态；恢复备份后先查看平台已有作品。
- `confirmation=api` 表示这台应用收到 X 返回的作品 ID；`manual` 是人工粘贴。备份是用户可编辑的文件，不是平台签名证据。

## 兼容与回退

资料数据库升级为 schema 3，增加平台回执类型。打开 schema 2 前保存独立 `before-publishing-upgrade-*.sqlite`，0.2.0 会拒绝打开新库，避免旧版无法完整备份平台回执。schema 1 升级仍保留独立旧库。

回退 0.2.0 前正常退出，完整保留新版资料目录，再用升级前 schema 2 副本建立独立旧资料目录；不混用 WAL/SHM，不删除新版资料。包含 API 回执的新版备份不能直接导入 0.2.0。钥匙串凭证不在备份中；若停止使用授权功能，先断开 X。旧版发布包、标签及 Electron 目录不修改。

## 实现状态与验收

已实现：X 配置入口、授权与刷新代码、单帖预览/确认/发送、回执保存、防重日志；掘金辅助流程简化；RSS 内容预览、搜索和来源筛选。

未完成真实验收：X 应用注册、平台回调、真实账号授权/令牌轮换、收费账户权限、真实发帖与撤销。用户当前没有开发者应用，不能把本地测试称为真实平台连通。掘金未找到可验证的官方公开发文授权文档，暂不接入私有 Cookie API。评论、浏览量、X 信息流、任意网页全文抓取和后台自动更新不在本轮支持范围。

开发验证使用 `npm test`、`npm run test:rust`、`npm run test:parity` 和隔离资料的原生桌面冒烟；桌面报告写入忽略的 `artifacts/tauri-comparison/native-smoke.json`。后续验收顺序：创建 Native App → 在本机填 Client ID → 连接并检查账号 → 用户确认测试短帖 → 检查实际作品和本地回执 → 过期刷新与撤销。绝不在自动化测试中发送真实帖子。

## 官方资料（2026-10-29 核实）

- [X Native App / OAuth 2.0 PKCE](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code)
- [X token 交换、刷新与撤销](https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token)
- [创建帖子](https://docs.x.com/x-api/posts/create-post)
- [计费和额度](https://docs.x.com/x-api/getting-started/pricing)
- [加权字符计数](https://docs.x.com/fundamentals/counting-characters)

后续开发交接：Read AGENTS.md and docs/publishing-and-preview.md first. Preserve old releases and user data. Validate X OAuth with a user-configured Native App, never ask for secrets in chat, and never publish test content without explicit approval. Verify refresh, revoke, uncertain-write recovery, backups and the RSS reading flow. Keep unsupported platform capabilities visibly distinct from verified ones.
