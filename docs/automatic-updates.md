# 自动更新与回退

用户只需要在“设置 → 应用更新”点击升级。默认每天自动检查一次，可关闭；检查失败不打断写作，也不会把网络失败误报为“最新版本”。下载和安装必须由用户点击触发，不在后台偷偷重启。

0.3.0 及以前没有更新入口，需要手动安装一次 0.4.0。当前只提供 macOS Apple Silicon 更新。Electron 构建入口、旧版发行包和标签继续保留。

## 升级顺序

1. 保存编辑，等待正在进行的本地操作完成，显示升级进度并阻止继续编辑和普通退出。
2. 从固定的本项目 GitHub 发行页检查版本，仅接受较新版本。元数据不能指定其它仓库的下载地址。
3. 点击升级后下载 `.app.tar.gz`，限制 HTTPS、GitHub/CDN 跳转、120 秒超时和 100 MB 大小；校验内置公钥签名与签名绑定的版本。
4. 在资料目录 `update-backups/<旧版版本>-<唯一标识>/` 写入完整 `资料.cwb`、旧版应用和回退说明。保存失败时停止安装，既有备份不删除。
5. Tauri 更新器替换应用；成功后重启。失败时显示提示并保留升级前副本，可通过“查看升级备份”打开。

资料库在备份和替换阶段保持锁定，异步订阅回写不能越过升级边界。原平台发布防重日志不进入内容备份或恢复，账号授权仍留在钥匙串。

## 发行维护

使用 [Tauri 官方 updater 插件](https://v2.tauri.app/plugin/updater/)。公钥在 `src-tauri/tauri.conf.json`，私钥只能保存在源码目录之外。`requireSignedVersion` 防止元数据把旧的合法签名包伪装成新版本；不提供关闭签名校验或任意更新源的设置。

```sh
npm ci
npm run licenses
npm run release:mac
TAURI_SIGNING_PRIVATE_KEY_PATH="/absolute/private/location/updater.key" npm run package:updater
```

如私钥加密，通过 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 环境变量提供密码，不写入代码、日志或发行附件。打包脚本要求私钥为仅所有者可读写，并校验对应公钥与应用配置一致。应在安全位置另行保管私钥副本；丢失私钥不能对现有客户端静默更换信任根。

打包脚本签名的是完成资源归档及 macOS 本地签名后的最终应用。生成的 `.app.tar.gz`、`.sig` 和 `latest.json` 放在 `release/v<版本>/`。先完成源码/历史/产物敏感信息扫描与 CI，再创建草稿发行并上传全部附件，核对下载和哈希后将发行公开。不要先公开缺少签名包或元数据的发行；`releases/latest/download/latest.json` 指向最新正式发行。

更新签名与 Apple Developer ID 是两个不同校验。当前应用只有 ad-hoc macOS 签名，未公证；更新签名不改变这一事实。

## 验证

离线测试使用临时签名密钥、临时应用和临时资料，覆盖正确签名安装、包篡改拒绝、版本冒充拒绝、降级拒绝、旧应用和资料恢复、备份失败时停止。不会碰用户的真实应用或资料。

正式更新包生成后，执行：

```sh
WORKBENCH_UPDATER_PACKAGE_DIR="$PWD/release/v0.4.0" cargo test --manifest-path src-tauri/Cargo.toml packaged_release_installs_and_preserves_rollback -- --ignored
```

该测试验证真实发行包的签名、在临时目录安装、安装后的 macOS 签名和版本、旧应用副本及资料备份。线上检查、真实用户安装位置的权限与下一版本重启链路仍需结合发行后验证，不能用离线测试冒充。
