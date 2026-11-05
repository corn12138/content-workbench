# 平台能力核验（2026-11-04）

用途：决定哪些发布后能力可以真实接入，哪些只能保留为手动或受限项。只采用官方文档；第三方资料仅作线索，已标出。价格与额度以 X 开发者控制台为准，本文不承诺费用。

## X

| 能力 | 官方接口与授权 | 工作台状态 |
| --- | --- | --- |
| 发布单条文字帖 | `POST /2/tweets`，OAuth 2.0 用户令牌，`tweet.write tweet.read users.read`（现有授权已包含） | 已实现（实验性）；真实账号未验收 |
| 网页辅助发布 | X 官方 [Web Intent](https://docs.x.com/x-for-websites/post-button/guides/web-intent)：`https://x.com/intent/tweet`，可选 `text` 预填，用户在 X 页面编辑后自行发布 | 已实现；不需要开发者应用，不读取 Cookie，不产生 API 回执 |
| 读取作品公开数据 | `GET /2/tweets/:id?tweet.fields=public_metrics`（[Metrics](https://docs.x.com/x-api/fundamentals/metrics)）。返回 `impression_count`、`like_count`、`reply_count`、`retweet_count`、`quote_count`、`bookmark_count`；用现有 `tweet.read users.read` 即可 | 已实现“从 X 读取公开数据”（按作品手动刷新、单次请求、与其他平台操作串行，失败保留上次数据）；真实账号未验收 |
| 私有指标 | `non_public_metrics` / `organic_metrics` 需作品所有者的用户上下文令牌，且仅限发布后 30 天内 | 未接入：时间窗口与口径差异会让历史快照不可比，先只用公开数据 |
| 读取回复 | 没有专门的“回复列表”接口，需要 `GET /2/tweets/search/recent` 加 `conversation_id:<id>`，标准权限只覆盖最近 7 天（[Search](https://docs.x.com/x-api/posts/search/introduction)、[Conversation ID](https://developer.x.com/en/docs/x-api/conversation-id)） | 未接入：7 天窗口、按量计费且评论属于他人内容；保留“打开作品”与手动跟进笔记 |
| 上传图片 | `POST /2/media/upload`（含 initialize/append/finalize）需要 `media.write` 作用域（[Upload media](https://docs.x.com/x-api/media/upload-media)） | 未接入：现有授权不含 `media.write`，扩大权限需要用户重新授权；X 发布仍为纯文字 |
| 计费 | X API 为按量计费，读写都会消耗额度。第三方资料称读取自有帖子约 $0.001/次（未在官方页面核实） | 每次读取前在界面提示可能消耗额度；不自动轮询 |

结论：在已有授权体系内，X 作品公开数据可以按作品手动读取，已实现并用固定样本测试解析与错误映射（未知值保持未知，0 只来自平台明确返回）。回复和图片上传缺少合适授权或成本边界，明确列为受限项。

## 掘金

未找到掘金面向作者的官方公开 API 文档（发文、上传图片、阅读/点赞/评论数据均无可验证的授权说明）。其他产品（如火山引擎、字节系开放平台）的 Token 文档不能作为掘金文章授权依据；读取浏览器 Cookie 或调用私有接口不在允许范围。

状态：掘金继续采用“复制正文 → 打开掘金编辑器 → 人工发布 → 回填链接”，图片为本地准备的上传副本，反馈数据在作品详情中手动记录（阅读、点赞、评论、收藏）。

## 真实账号验收清单（需要用户自己的 X 开发者应用）

1. 在 X 开发者控制台创建 Native App，回调地址 `http://127.0.0.1:34187/oauth/x/callback`，读写权限。
2. 设置 → 平台连接 → 配置自己的 X 应用：保存 Client ID → 连接 X → 核对账号名。
3. 用一条用户明确同意的测试短帖走“官方 API”发布，核对作品链接、本地“平台回执”。
4. 在发布记录中对该作品点“从 X 读取公开数据”，与 X 页面数值对照，记录时间。
5. 让授权过期（或手动撤销）后重试，确认显示“授权已失效/重新连接”，不写入假数据。
6. 断开连接并在 X“已连接的应用”中确认撤销。
