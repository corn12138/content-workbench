# 升级与回退

## 升级到 0.2.0

1. 先在旧版设置中导出备份，并正常退出应用。
2. 保留旧版应用，将新版解压到另一个目录后打开。
3. 首次打开 schema 1 资料时，新版先生成 `before-library-upgrade-<随机标识>.sqlite` 独立副本，再升级到 schema 2。副本写入失败时不会进行升级。
4. 新版设置中的“备份资料”生成 `.cwb`，包含正文、历史、已保存图片、发布记录、订阅和阅读笔记。备份未加密，请保存在自己的安全位置。

Tauri 默认资料目录为 `~/Library/Application Support/local.contentworkbench.tauri/`。也可在设置中展开“查看数据位置”。Electron 保持独立目录 `~/Library/Application Support/content-workbench/`。

## 临时切回旧版

[0.1.0 下载](https://github.com/corn12138/content-workbench/releases/tag/v0.1.0)及源代码标签继续保留。Electron 构建入口也继续保留；两者都不能直接读取 schema 2 或 `.cwb`。

先在新版导出完整备份并正常退出。**保留整个新版资料目录，不要直接用旧副本覆盖其中的数据库，也不要把旧数据库和新版的 WAL/SHM 文件混用。**

要使用 0.1.0 Tauri，可将整个新版资料目录改名留存，在原位置新建空目录，再把升级前的 `before-library-upgrade-*.sqlite` 副本复制进去并命名为 `workbench.sqlite`，然后启动旧版。旧版只会看到升级之前的资料；升级后的稿件修改、图片和订阅仍留在新版目录及完整备份中。

要回到新版，先正常退出旧版并为旧版期间的修改另行导出备份，再将两个完整资料目录切换回来。两边的修改不会自动合并，避免直接恢复旧文字备份覆盖新版资料。

若一直使用 Electron，其原目录未被 Tauri 覆盖，可继续运行已有 Electron 应用，或使用 `npm run package:electron` 构建。发布流程不会删除旧发行包、标签或用户的回退资料。

## 升级到 0.3.0 与回退 0.2.0

正常退出旧版并导出完整备份，保留旧应用。0.3.0 打开 schema 2 资料前自动生成独立的 `before-publishing-upgrade-*.sqlite`，再升级到 schema 3。该副本写入失败会停止升级。[0.2.0 下载](https://github.com/corn12138/content-workbench/releases/tag/v0.2.0)继续保留。

回退前先在 0.3.0 导出完整备份并退出。把整个新版资料目录改名留存，在原位置新建目录，仅复制升级前的 `before-publishing-upgrade-*.sqlite` 并命名为 `workbench.sqlite`，然后打开 0.2.0；不要混用不同版本的 WAL/SHM 文件。回退仅恢复升级时的数据，新版期间的修改保留在新版目录和备份中，两版不会自动合并。

发布防重日志留在新版原目录，不能通过恢复内容备份回滚它；X 凭证在钥匙串中，回退不会替代平台撤销授权。Electron 仍使用原独立资料目录。保留新版完整目录后才进行回退，不能仅覆盖单个数据库文件。
