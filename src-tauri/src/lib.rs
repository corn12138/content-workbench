mod commands;
mod feed_commands;
pub mod feed_fetch;
pub mod feed_parse;
mod files;
mod lifecycle;
mod migration;
mod publishing;
#[cfg(debug_assertions)]
mod smoke;
mod state;
pub mod store;

use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Mutex,
};
use tauri::Manager;

pub fn run() {
    let app = tauri::Builder::default()
        .manage(publishing::PublishingState::default())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            publishing::x_account,
            publishing::x_connect,
            publishing::x_cancel,
            publishing::x_disconnect,
            publishing::x_publish,
            commands::snapshot,
            commands::save_draft,
            commands::archive_draft,
            commands::revisions,
            commands::restore_revision,
            commands::record_publication,
            commands::save_reading,
            commands::delete_reading,
            commands::reading_to_draft,
            commands::copy_text,
            commands::open_external,
            commands::info,
            files::import_markdown,
            files::export_draft,
            files::backup,
            files::restore_backup,
            files::insert_image,
            commands::asset_data,
            feed_commands::library,
            feed_commands::add_feed,
            feed_commands::refresh_feed,
            feed_commands::unsubscribe,
            lifecycle::finish_close,
            #[cfg(debug_assertions)]
            smoke::comparison_step
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            app.handle().plugin(smoke::plugin())?;
            let directory = if let Some(path) = std::env::var_os("WORKBENCH_TAURI_DATA_DIR") {
                std::path::PathBuf::from(path)
            } else if cfg!(debug_assertions) {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.tauri-data")
            } else {
                app.path().app_data_dir()?
            };
            let opening = (|| -> Result<store::WorkbenchStore, String> {
                // Test overrides stay isolated; normal first launch copies the previous app's data once.
                if std::env::var_os("WORKBENCH_TAURI_DATA_DIR").is_none() {
                    let source = if cfg!(debug_assertions) {
                        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.local-data")
                    } else {
                        app.path()
                            .data_dir()
                            .map_err(|e| e.to_string())?
                            .join("content-workbench")
                    };
                    migration::prepare(&source, &directory)?;
                }
                store::WorkbenchStore::open(directory.clone())
            })();
            let (store, startup_error) = match opening {
                Ok(store) => (Some(Mutex::new(store)), None),
                Err(error) => (None, Some(error)),
            };
            app.manage(state::AppState {
                store,
                startup_error,
                directory,
                can_close: AtomicBool::new(false),
                close_pending: AtomicBool::new(false),
                close_attempt: AtomicU64::new(0),
                library_epoch: AtomicU64::new(0),
            });
            let window =
                tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                    .on_navigation(|url| {
                        let packaged =
                            url.scheme() == "tauri" && url.host_str() == Some("localhost");
                        let development = cfg!(debug_assertions)
                            && url.origin().ascii_serialization() == "http://127.0.0.1:5173";
                        packaged || development
                    })
                    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                    .on_page_load(|window, payload| {
                        #[cfg(debug_assertions)]
                        if payload.event() == tauri::webview::PageLoadEvent::Finished {
                            smoke::on_page_load(&window);
                        }
                        #[cfg(not(debug_assertions))]
                        let _ = (window, payload);
                    })
                    .build()?;
            let handle = app.handle().clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if !handle
                        .state::<state::AppState>()
                        .can_close
                        .load(Ordering::SeqCst)
                    {
                        api.prevent_close();
                        lifecycle::request_close(&handle);
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("无法启动内容工作台");
    app.run(|app, event| {
        #[cfg(debug_assertions)]
        if let tauri::RunEvent::Exit = event {
            smoke::on_exit(app);
        }
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if !app
                .state::<state::AppState>()
                .can_close
                .load(Ordering::SeqCst)
            {
                api.prevent_exit();
                lifecycle::request_close(app);
            }
        }
    });
}

#[cfg(test)]
mod feed_tests;
