use crate::state::{trusted, AppState};
use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, WebviewWindow, Wry,
};
use tauri_plugin_clipboard_manager::ClipboardExt;

const MARKER: &str = "content-workbench-smoke-v1\n";
const CLOSE_TITLE: &str = "Tauri 测试样本 · 关闭时保存";
const QUIT_NOTE: &str = "Tauri 测试笔记 · 退出时保存";

struct SmokeState {
    directory: PathBuf,
    phase: String,
    started: AtomicBool,
    report: Mutex<Value>,
    clipboard: Mutex<Option<String>>,
    clipboard_dirty: AtomicBool,
}

fn isolated_directory() -> Result<PathBuf, String> {
    let raw = std::env::var_os("WORKBENCH_TAURI_DATA_DIR").ok_or("Smoke data directory absent")?;
    let directory = fs::canonicalize(PathBuf::from(raw)).map_err(|e| e.to_string())?;
    let temporary = fs::canonicalize(std::env::temp_dir()).map_err(|e| e.to_string())?;
    let named = directory
        .file_name()
        .is_some_and(|name| name.to_string_lossy().starts_with("workbench-tauri-smoke-"));
    let marker = directory.join(".workbench-smoke");
    if directory.parent() != Some(temporary.as_path())
        || !named
        || !fs::symlink_metadata(&marker).is_ok_and(|meta| meta.file_type().is_file())
        || fs::read_to_string(marker).ok().as_deref() != Some(MARKER)
    {
        return Err("Native smoke requires a marked, isolated temporary directory".into());
    }
    Ok(directory)
}

pub fn plugin() -> TauriPlugin<Wry> {
    Builder::new("comparison")
        .setup(|app, _| {
            if std::env::var("WORKBENCH_TAURI_SMOKE").as_deref() != Ok("1") {
                return Ok(());
            }
            let directory = isolated_directory().map_err(std::io::Error::other)?;
            let phase = std::env::var("WORKBENCH_TAURI_SMOKE_PHASE").unwrap_or_default();
            if !matches!(phase.as_str(), "redClose" | "menuQuit") {
                return Err(std::io::Error::other("Unknown native smoke phase").into());
            }
            app.manage(SmokeState {
                directory,
                phase: phase.clone(),
                started: AtomicBool::new(false),
                report: Mutex::new(json!({"phase": phase, "passed": false, "fixtureOnly": true})),
                clipboard: Mutex::new(app.clipboard().read_text().ok()),
                clipboard_dirty: AtomicBool::new(false),
            });
            Ok(())
        })
        .build()
}

pub fn on_page_load(window: &WebviewWindow) {
    let Some(state) = window.try_state::<SmokeState>() else {
        return;
    };
    if state.started.swap(true, Ordering::SeqCst) {
        return;
    }
    let phase = serde_json::to_string(&state.phase).unwrap();
    eprintln!("TAURI_SMOKE_PAGE_READY {}", state.phase);
    let script = format!(
        "window.__WORKBENCH_SMOKE_PHASE__ = {phase};\n{}",
        include_str!("../../tests/tauri-smoke.js")
    );
    if let Err(error) = window.eval(&script) {
        fail(window.app_handle(), error.to_string());
    }
}

#[tauri::command]
pub fn comparison_step(
    window: WebviewWindow,
    app: AppHandle,
    action: String,
    details: Option<Value>,
) -> Result<Value, String> {
    trusted(&window)?;
    let state = app
        .try_state::<SmokeState>()
        .ok_or("Native smoke is inactive")?;
    if isolated_directory()? != state.directory {
        return Err("Native smoke guard changed".into());
    }
    match action.as_str() {
        "phase" => Ok(json!(state.phase)),
        "clipboard_available" => Ok(json!(state.clipboard.lock().map_err(|e| e.to_string())?.is_some())),
        "clipboard_begin" => {
            state.clipboard_dirty.store(true, Ordering::SeqCst);
            Ok(Value::Null)
        }
        "resize" => {
            window
                .set_size(tauri::LogicalSize::new(850.0, 680.0))
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "clipboard" => {
            let snapshot = app.state::<AppState>().lock()?.snapshot()?;
            let expected = snapshot
                .drafts
                .iter()
                .find(|d| d.title.contains("Tauri 本地测试样本"))
                .ok_or("Clipboard fixture absent")?;
            let correct = app.clipboard().read_text().map_err(|e| e.to_string())? == expected.body;
            restore_clipboard(&app)?;
            if !correct {
                return Err("Native clipboard did not contain the draft body".into());
            }
            Ok(json!(true))
        }
        "complete" => {
            let mut report = state.report.lock().map_err(|e| e.to_string())?;
            // Reports contain assertions only; neither draft text nor clipboard contents leave the fixture directory.
            if let Some(Value::Object(values)) = details {
                for (name, value) in values {
                    if value.is_boolean() && name.len() <= 60 {
                        report[name] = value;
                    }
                }
            }
            report["uiFinished"] = true.into();
            Ok(Value::Null)
        }
        "close" => {
            restore_clipboard(&app)?;
            let snapshot = app.state::<AppState>().lock()?.snapshot()?;
            let already_saved = if state.phase == "redClose" {
                snapshot
                    .drafts
                    .iter()
                    .any(|draft| draft.title == CLOSE_TITLE)
            } else {
                snapshot
                    .readings
                    .iter()
                    .any(|reading| reading.note == QUIT_NOTE)
            };
            if already_saved {
                return Err("Close check requires a pending edit before the debounce save".into());
            }
            state.report.lock().map_err(|e| e.to_string())?["editPendingAtClose"] = true.into();
            if state.phase == "redClose" {
                window.close().map_err(|e| e.to_string())?;
            } else {
                app.exit(0);
            }
            Ok(Value::Null)
        }
        "fail" => {
            let error = details
                .and_then(|v| v.as_str().map(str::to_owned))
                .unwrap_or_else(|| "Native smoke failed".into());
            fail(&app, error);
            Ok(Value::Null)
        }
        _ => Err("Unknown native smoke action".into()),
    }
}

fn fail(app: &AppHandle, error: String) {
    let _ = restore_clipboard(app);
    if let Some(state) = app.try_state::<SmokeState>() {
        if let Ok(mut report) = state.report.lock() {
            report["error"] = error.chars().take(1000).collect::<String>().into();
        }
    }
    if let Some(state) = app.try_state::<AppState>() {
        state.can_close.store(true, Ordering::SeqCst);
    }
    app.exit(1);
}

fn restore_clipboard(app: &AppHandle) -> Result<(), String> {
    let Some(state) = app.try_state::<SmokeState>() else {
        return Ok(());
    };
    if state.clipboard_dirty.swap(false, Ordering::SeqCst) {
        // Plugins release native resources before the final Exit callback; restore only before requesting exit.
        if let Some(previous) = state.clipboard.lock().map_err(|e| e.to_string())?.take() {
            app.clipboard().write_text(previous).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn on_exit(app: &AppHandle) {
    let Some(state) = app.try_state::<SmokeState>() else {
        return;
    };
    let Ok(mut report) = state.report.lock() else {
        return;
    };
    let snapshot = app
        .state::<AppState>()
        .lock()
        .and_then(|store| store.snapshot());
    match snapshot {
        Ok(snapshot) => {
            let persisted = if state.phase == "redClose" {
                snapshot
                    .drafts
                    .iter()
                    .any(|draft| draft.title == CLOSE_TITLE)
            } else {
                snapshot
                    .readings
                    .iter()
                    .any(|reading| reading.note == QUIT_NOTE)
            };
            report["nativeCloseAutosave"] = persisted.into();
            report["passed"] =
                (persisted && report["uiFinished"] == true && report.get("error").is_none()).into();
        }
        Err(error) => {
            report["error"] = error.into();
        }
    }
    let path = state.directory.join(format!("smoke-{}.json", state.phase));
    let result = serde_json::to_vec_pretty(&*report)
        .map_err(|e| e.to_string())
        .and_then(|bytes| fs::write(path, bytes).map_err(|e| e.to_string()));
    if result.is_ok() {
        eprintln!("TAURI_SMOKE_REPORT {} {}", state.phase, report["passed"]);
    }
}
