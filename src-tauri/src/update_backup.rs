use crate::{files::atomic_write, store::WorkbenchStore};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

pub fn app_bundle(executable: &Path) -> Result<PathBuf, String> {
    let macos = executable.parent().ok_or("无法定位应用。")?;
    let contents = macos.parent().ok_or("无法定位应用。")?;
    let bundle = contents.parent().ok_or("无法定位应用。")?;
    if macos.file_name().is_none_or(|n| n != "MacOS")
        || contents.file_name().is_none_or(|n| n != "Contents")
        || bundle.extension().is_none_or(|n| n != "app")
    {
        return Err("请从安装后的应用检查更新。".into());
    }
    Ok(bundle.to_path_buf())
}

pub fn prepare(
    directory: &Path,
    bundle: &Path,
    store: &WorkbenchStore,
    version: &str,
) -> Result<PathBuf, String> {
    let root = directory.join("update-backups");
    fs::create_dir_all(&root).map_err(|_| "无法建立升级备份，已取消升级。")?;
    let folder = root.join(format!("{version}-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&folder).map_err(|_| "无法建立升级备份，已取消升级。")?;
    let result = (|| {
        atomic_write(&folder.join("资料.cwb"), &store.export_full_backup()?)?;
        let copied = Command::new("/usr/bin/ditto")
            .arg(bundle)
            .arg(folder.join("内容工作台.app"))
            .output()
            .map_err(|_| "旧版应用未能备份，已取消升级。")?;
        if !copied.status.success() {
            return Err("旧版应用未能完整备份，已取消升级。".into());
        }
        atomic_write(&folder.join("回退说明.txt"), "退出新版后，将这里的内容工作台.app 复制到原来的安装位置并打开。\n如果需要回到升级前的资料，在旧版“设置 → 恢复备份”选择同文件夹的资料.cwb。恢复前会再次保留当前资料。\n此备份不含账号授权凭证，发布去重记录继续保留。\n".as_bytes())?;
        Ok(folder.clone())
    })();
    if result.is_err() {
        // Only this incomplete, uniquely created snapshot is removed; previous recovery points stay intact.
        let _ = fs::remove_dir_all(&folder);
    }
    result
}

#[cfg(test)]
mod tests {
    #[test]
    fn only_real_bundle_layout_is_accepted() {
        use std::path::Path;
        assert!(super::app_bundle(Path::new("/Applications/Test.app/Contents/MacOS/test")).is_ok());
        for path in [
            "/tmp/test",
            "/tmp/Test/Contents/MacOS/test",
            "/tmp/Test.app/Else/MacOS/test",
        ] {
            assert!(super::app_bundle(Path::new(path)).is_err());
        }
    }
}
