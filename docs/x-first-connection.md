# 第一次连接 X：按这份步骤配置

适用：内容工作台 0.4.0、macOS。本说明于 2026-11-02 核对 X 官方文档。当前尚未创建开发者应用，因此真实账号授权、发帖和刷新仍待验收。

完成后的日常操作只有：**连接一次账号 → 选择稿件 → 核对短帖 → 确认发布**。

## 1. 创建开发者应用

在浏览器打开 [X 开发者控制台](https://console.x.com/)，登录要用于试验的账号。按控制台要求完成开发者注册，再选择 **Create App**。开发者协议、付款或额度购买由账号所有者自己核对和完成；此步骤不需要把凭据发到聊天里。

可用的应用名称：`Content Workbench Personal Test`（重名时加自己的后缀）。

如需填写用途，可按实际情况使用下面的英文说明：

> I am testing an open-source desktop writing tool for my own X account. It uses OAuth 2.0 with PKCE to identify the authorized account and publish a plain-text post only after I review and confirm it. It stores post links locally. It does not send automated replies, scrape timelines, read direct messages, or sell X data. Tokens are stored in the macOS Keychain.

这是个人试验用途说明；以后面向其他用户发行时，应更新为实际产品范围。参考 [X 官方应用创建说明](https://docs.x.com/fundamentals/developer-apps)。

## 2. 配置用户授权

进入应用的用户认证设置（User authentication settings；具体菜单名称可能变化），启用 **OAuth 2.0**。

| 配置项 | 本项目填写值 |
| --- | --- |
| 应用类型 | **Native App / Public client** |
| 授权方式 | OAuth 2.0 Authorization Code + PKCE |
| Callback / Redirect URI | `http://127.0.0.1:34187/oauth/x/callback` |
| Website URL | `https://github.com/corn12138/content-workbench` |
| Privacy Policy URL（若要求） | `https://github.com/corn12138/content-workbench/blob/main/docs/privacy.md` |
| Client ID | 保存配置后，在 Keys and Tokens 中查看公开 Client ID |

回调地址要完整复制：`http`、`127.0.0.1`、端口 `34187` 和路径都必须一致，末尾不要添加 `/`，也不要改成 `localhost`。

X 官方文档把 Native App 定义为使用 PKCE 的公开客户端；自动发帖这一用途并不意味着本项目应该选服务端的 Automated App / Bot。此桌面实现不接收 Client Secret。[类型与回调要求](https://docs.x.com/fundamentals/developer-apps)

当前回调是本机试验使用的 loopback 地址。官方文档允许本地开发使用 `http://127.0.0.1`，同时要求生产回调使用 HTTPS；真实 Native App 是否接受本项目完整回调、公开发行时采用哪种回调，需要在实际控制台与授权流程确认，不能把填完表单视为已经验证。

工作台在授权请求里自动携带以下范围：

| 范围 | 本项目用途 |
| --- | --- |
| `tweet.read` | 帖子读取权限，包含在当前发帖授权流程中 |
| `tweet.write` | 发送用户确认的短帖 |
| `users.read` | 识别当前授权账号，避免发错账号 |
| `offline.access` | 获取刷新令牌，减少反复连接 |

无需手动编辑授权 URL。若控制台还显示 **App permissions / Read and write**，注意官方文档将这组权限级别列在 OAuth 1.0a 下；它不能替代 OAuth 2.0 的 scopes。当前实现不需要私信权限。[OAuth 2.0 官方说明](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code)

## 3. 在工作台连接

1. 打开内容工作台，进入 **设置 → 平台连接 → 首次连接：配置 X 应用**。
2. 只填公开 **Client ID**；不要填 API Key、Client Secret、Bearer Token、Access Token 或 Cookie。
3. 点击 **连接 X**，浏览器会打开官方授权页。
4. 核对账号、应用名称和权限，再由账号所有者允许授权。
5. 浏览器返回本机回调后，回到工作台；看到 `已连接 X` 和正确的 `@账号名` 才算连接成功。

等待时间最多 3 分钟。回调端口被占用、取消或超时都有可能导致连接失败；失败时重新发起一次连接，不复用旧的授权链接。

## 4. 核对费用后再做一次发帖试验

按核对日期的 [X 官方价格](https://docs.x.com/x-api/getting-started/pricing)，普通发帖为 $0.015/次，含 URL 为 $0.200/次；连接时读取账号也可能计费。以实际控制台余额、权限和当前价格为准，先设置自己能接受的限额；本说明不代表授权购买额度。

准备的无链接测试短帖如下，尚未发布：

> 内容工作台功能测试：本地写 Markdown，预览后再分享；订阅文章集中阅读，笔记保存在本机。本条用于验证发布流程。

从 **稿件 → 准备发布 → X** 检查短帖和账号，确认愿意公开后再发送。第一轮只发一次，随后核对：

- X 个人主页能打开真实作品。
- 工作台返回的是同一作品链接。
- “反馈”页记录的是 API 回执，而不是手动录入。
- 如果提示超时或结果待核实，先查看主页，不连续重发。

这轮通过后，再验令牌刷新、断开授权和失败恢复；它们不能由一次成功发帖替代。

## 遇到问题时

| 现象 | 先检查 |
| --- | --- |
| “连接 X”不可点击 | Client ID 是否填写；当前不是登录 X 网页就等于工作台已授权 |
| 回调不匹配 | 地址是否逐字相同、是否多了末尾斜线、应用类型是否正确 |
| 要求 Client Secret | 是否误选 Web App / Confidential client；不要把 Secret 填入 Client ID |
| 浏览器已允许但工作台没连上 | 授权是否超时、工作台是否仍运行、34187 端口是否被占用 |
| 额度不足或拒绝访问 | 检查控制台费用、额度、应用权限及账号状态；不要自动购买或反复发帖 |
| 授权失效 | 重新连接；权限改变后按官方要求重新授权 |

## 普通用户以后应该看到什么

开发者应用属于维护者的一次性配置。当前代码支持构建时提供公开 `WORKBENCH_X_CLIENT_ID`；真实连通并确认配额安排后，发行包可让普通用户直接点击“连接 X”。公开 Client ID 不是密钥；访问令牌仍按用户和资料目录保存到钥匙串。不要把每位用户都创建开发者应用当作最终 C 端体验。
