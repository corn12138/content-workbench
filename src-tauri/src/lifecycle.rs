use crate::state::{trusted, AppState};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_dialog::{
    DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
};

pub fn request_close(app: &AppHandle) {
    let state = app.state::<AppState>();
    if state.can_close.load(Ordering::SeqCst) || state.close_pending.swap(true, Ordering::SeqCst) {
        return;
    }
    let attempt = state.close_attempt.fetch_add(1, Ordering::SeqCst) + 1;
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.emit("workbench:before-close", attempt);
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(6));
        let state = app.state::<AppState>();
        if state.can_close.load(Ordering::SeqCst)
            || state.close_attempt.load(Ordering::SeqCst) != attempt
            || !state.close_pending.load(Ordering::SeqCst)
        {
            return;
        }
        let callback_app = app.clone();
        app.dialog()
            .message("暂时没有收到保存完成的回应。直接退出可能丢失最近尚未保存的修改。")
            .title("保存尚未完成")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::YesNoCancelCustom(
                "继续等待".into(),
                "直接退出".into(),
                "返回编辑".into(),
            ))
            .show_with_result(move |choice| {
                let state = callback_app.state::<AppState>();
                if state.can_close.load(Ordering::SeqCst)
                    || state.close_attempt.load(Ordering::SeqCst) != attempt
                {
                    return;
                }
                state.close_pending.store(false, Ordering::SeqCst);
                match choice {
                    MessageDialogResult::Custom(label) if label == "直接退出" => {
                        state.can_close.store(true, Ordering::SeqCst);
                        callback_app.exit(0);
                    }
                    MessageDialogResult::Custom(label) if label == "继续等待" => {
                        request_close(&callback_app)
                    }
                    _ => {
                        let _ = callback_app.emit_to("main", "workbench:cancel-close", ());
                    }
                }
            });
    });
}

#[tauri::command]
pub fn finish_close(window: WebviewWindow, app: AppHandle, attempt: u64) -> Result<(), String> {
    trusted(&window)?;
    let state = app.state::<AppState>();
    // A completed save from a cancelled attempt cannot terminate a later editing session.
    if !state.close_pending.load(Ordering::SeqCst)
        || state.close_attempt.load(Ordering::SeqCst) != attempt
    {
        return Ok(());
    }
    state.can_close.store(true, Ordering::SeqCst);
    app.exit(0);
    Ok(())
}
