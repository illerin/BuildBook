use pbkdf2::pbkdf2_hmac;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::net::{IpAddr, TcpListener, TcpStream, ToSocketAddrs, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::JoinHandle;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

mod file_access;
mod lan;
mod state;
mod storage;
mod thumbnails;

use file_access::{
    normalized_existing_path, open_file_path_inner, open_file_with_program_inner,
    readable_user_file_path, safe_file_name,
};
use lan::{
    content_type, cookie_value, header_value, query_value, request_body, send_response,
    send_response_with_headers,
};
use state::{
    list_state_backups, read_app_state, restore_state_backup, state_file_path, state_write_lock,
    validate_state_contents, write_app_state, write_app_state_inner,
};
use storage::{
    canonical_under_roots, cleanup_orphaned_files, delete_managed_files, list_folder_files,
    reset_managed_storage, scan_storage, scan_storage_inner, storage_roots,
    DeleteManagedFilesResult, StorageScanRequest,
};
use thumbnails::shell_thumbnail_bytes;

static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(false);
const HOST_RETRY_COOLDOWN_SECONDS: u64 = 15;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let open_item = MenuItem::with_id(app, "open", "Open BuildBook", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit BuildBook", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &quit_item])?;
            let tray = TrayIconBuilder::with_id("buildbook-tray")
                .icon(
                    app.default_window_icon()
                        .expect("BuildBook tray icon is missing")
                        .clone(),
                )
                .tooltip("BuildBook")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
            tray.set_visible(false)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if CLOSE_TO_TRAY.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            read_app_state,
            write_app_state,
            list_state_backups,
            restore_state_backup,
            attach_local_file,
            save_uploaded_file,
            overwrite_file_bytes,
            prepare_edit_file,
            download_url_to_file,
            read_file_bytes,
            open_file_path,
            open_file_with_program,
            pick_file_path,
            pick_folder_path,
            list_folder_files,
            scan_storage,
            cleanup_orphaned_files,
            delete_managed_files,
            reset_managed_storage,
            shell_thumbnail_bytes,
            start_lan_server,
            stop_lan_server,
            lan_server_status,
            read_sync_config,
            write_sync_config,
            discover_buildbook_hosts,
            probe_buildbook_host,
            generate_sync_pairing_code,
            pair_buildbook_host,
            revoke_paired_device,
            clear_sync_checkout,
            sync_status_dashboard,
            sync_conflict_summary,
            resolve_sync_conflict_selections,
            sync_client_load,
            sync_client_save,
            resolve_sync_conflict,
            sync_read_cached_host_file,
            sync_read_host_file,
            sync_open_host_file,
            sync_prepare_host_edit_file,
            sync_save_host_file,
            sync_overwrite_host_file,
            sync_download_url_to_host,
            sync_delete_host_files,
            sync_file_checkout,
            set_close_to_tray
        ])
        .run(tauri::generate_context!())
        .expect("error while running BuildBook");
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn set_close_to_tray(app: tauri::AppHandle, enabled: bool) {
    CLOSE_TO_TRAY.store(enabled, Ordering::SeqCst);
    if let Some(tray) = app.tray_by_id("buildbook-tray") {
        let _ = tray.set_visible(enabled);
    }
}

// These files share the crate-root namespace so Tauri command names stay stable.
include!("sync.rs");
include!("local_files.rs");
include!("lan_server.rs");
