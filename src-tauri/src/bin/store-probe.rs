use std::{
    env, fs,
    path::{Path, PathBuf},
    process,
};
use workbench_tauri::store::WorkbenchStore;

fn argument(name: &str) -> Option<String> {
    let args: Vec<String> = env::args().collect();
    args.windows(2)
        .find(|pair| pair[0] == name)
        .map(|pair| pair[1].clone())
}

fn required(name: &str) -> Result<String, String> {
    argument(name).ok_or_else(|| format!("Missing {name}"))
}

fn fixture_root() -> Result<PathBuf, String> {
    let root = fs::canonicalize(required("--root")?).map_err(|error| error.to_string())?;
    let temp = fs::canonicalize(env::temp_dir()).map_err(|error| error.to_string())?;
    let has_name = root
        .file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|name| name.starts_with("workbench-parity-"));
    let marker = fs::read_to_string(root.join(".workbench-comparison-fixture")).unwrap_or_default();
    // The probe intentionally refuses normal app directories; it can only mutate generated test fixtures.
    if !root.starts_with(temp) || !has_name || marker != "content-workbench-parity-v1" {
        return Err("A marked temporary comparison directory is required".into());
    }
    Ok(root)
}

fn scoped_path(root: &Path, value: String, must_exist: bool) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    let parent = path.parent().ok_or("Path has no parent")?;
    let resolved_parent = fs::canonicalize(parent).map_err(|error| error.to_string())?;
    let filename = path.file_name().ok_or("Path has no filename")?;
    let resolved = if path.exists() {
        fs::canonicalize(&path).map_err(|error| error.to_string())?
    } else {
        if must_exist {
            return Err("Fixture path does not exist".into());
        }
        resolved_parent.join(filename)
    };
    if !resolved.starts_with(root) || resolved == root {
        return Err("Probe paths must remain inside the isolated fixture directory".into());
    }
    Ok(resolved)
}

fn run() -> Result<(), String> {
    let root = fixture_root()?;
    let inspect = argument("--inspect-db");
    let data = scoped_path(
        &root,
        match &inspect {
            Some(path) => path.clone(),
            None => required("--data")?,
        },
        inspect.is_some(),
    )?;
    if inspect.is_some() && !data.join("workbench.sqlite").is_file() {
        return Err("Existing fixture database is required for inspection".into());
    }
    let output = scoped_path(&root, required("--output")?, false)?;
    let mut store = WorkbenchStore::open(data)?;
    if inspect.is_none() {
        let input = scoped_path(&root, required("--input")?, true)?;
        if fs::metadata(&input)
            .map_err(|error| error.to_string())?
            .len()
            > 25 * 1024 * 1024
        {
            return Err("Fixture backup exceeds 25 MB".into());
        }
        let json = fs::read_to_string(input).map_err(|error| error.to_string())?;
        store.restore_backup(&json)?;
    }
    fs::write(output, store.export_backup()?).map_err(|error| error.to_string())?;
    println!("STORE_PROBE_OK");
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        process::exit(1);
    }
}
