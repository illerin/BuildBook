use pbkdf2::pbkdf2_hmac;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::JoinHandle;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(target_os = "windows")]
fn windows_shell_execute(
    target: &std::path::Path,
    parameters: Option<&std::path::Path>,
) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SHOW_WINDOW_CMD;

    let operation: Vec<u16> = OsStr::new("open")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let file: Vec<u16> = target
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let parameters = parameters.map(|value| {
        value
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<u16>>()
    });

    let result = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(operation.as_ptr()),
            PCWSTR(file.as_ptr()),
            parameters
                .as_ref()
                .map(|value| PCWSTR(value.as_ptr()))
                .unwrap_or(PCWSTR::null()),
            PCWSTR::null(),
            SHOW_WINDOW_CMD(1),
        )
    };

    if result.0 as usize <= 32 {
        return Err("Could not open file.".to_string());
    }

    Ok(())
}

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

fn state_file_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data folder: {error}"))?;

    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create app data folder: {error}"))?;

    Ok(dir.join("buildbook-state.json"))
}

fn sync_config_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data folder: {error}"))?;
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create app data folder: {error}"))?;
    Ok(dir.join("buildbook-device.json"))
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
struct SyncConfig {
    mode: String,
    device_id: String,
    device_name: String,
    host_url: String,
    host_token: String,
    client_auth_token: String,
    host_revision: String,
    pending_sync: bool,
    last_connected_at: u64,
    last_sync_error: String,
    pairing_code: String,
    pairing_code_expires_at: u64,
    pairing_failed_attempts: u32,
    pairing_locked_until: u64,
    paired_devices: Vec<PairedDevice>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Default)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
struct PairedDevice {
    device_id: String,
    device_name: String,
    token_hash: String,
    paired_at: u64,
    last_seen_at: u64,
    revoked: bool,
}

impl Default for SyncConfig {
    fn default() -> Self {
        let device_name = std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_else(|_| "BuildBook Computer".to_string());
        let seed = format!(
            "{}:{}:{}",
            device_name,
            now_seconds(),
            std::env::current_exe()
                .ok()
                .map(|path| path.display().to_string())
                .unwrap_or_default()
        );
        Self {
            mode: "local".to_string(),
            device_id: format!("device-{}", &sha256_hex(&seed)[..24]),
            device_name,
            host_url: String::new(),
            host_token: String::new(),
            client_auth_token: String::new(),
            host_revision: String::new(),
            pending_sync: false,
            last_connected_at: 0,
            last_sync_error: String::new(),
            pairing_code: String::new(),
            pairing_code_expires_at: 0,
            pairing_failed_attempts: 0,
            pairing_locked_until: 0,
            paired_devices: Vec::new(),
        }
    }
}

fn normalized_host_url(value: &str) -> Result<String, String> {
    let mut url = value.trim().trim_end_matches('/').to_string();
    if url.is_empty() {
        return Err("Enter a BuildBook host address.".to_string());
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        url = format!("http://{url}");
    }
    reqwest::Url::parse(&url)
        .map_err(|_| "Enter a valid http or https BuildBook host address.".to_string())?;
    Ok(url)
}

fn load_sync_config(app: &tauri::AppHandle) -> Result<SyncConfig, String> {
    let path = sync_config_path(app)?;
    if path.is_file() {
        let contents = std::fs::read_to_string(&path)
            .map_err(|error| format!("Could not read device settings: {error}"))?;
        let mut config: SyncConfig = serde_json::from_str(&contents)
            .map_err(|error| format!("Device settings are not valid JSON: {error}"))?;
        if !matches!(config.mode.as_str(), "local" | "host" | "client") {
            config.mode = "local".to_string();
        }
        if config.device_id.trim().is_empty() {
            config.device_id = SyncConfig::default().device_id;
        }
        if config.device_name.trim().is_empty() {
            config.device_name = "BuildBook Computer".to_string();
        }
        return Ok(config);
    }
    let config = SyncConfig::default();
    save_sync_config(app, &config)?;
    Ok(config)
}

fn save_sync_config(app: &tauri::AppHandle, config: &SyncConfig) -> Result<(), String> {
    if !matches!(config.mode.as_str(), "local" | "host" | "client") {
        return Err("Invalid BuildBook operating mode.".to_string());
    }
    if config.device_id.trim().is_empty() || config.device_name.trim().is_empty() {
        return Err("Device id and device name are required.".to_string());
    }
    if config.mode == "client" {
        normalized_host_url(&config.host_url)?;
    }
    let path = sync_config_path(app)?;
    let contents = serde_json::to_string_pretty(config)
        .map_err(|error| format!("Could not encode device settings: {error}"))?;
    let temp_path = path.with_extension("json.tmp");
    std::fs::write(&temp_path, contents)
        .map_err(|error| format!("Could not write device settings: {error}"))?;
    std::fs::rename(&temp_path, &path)
        .or_else(|_| {
            let _ = std::fs::remove_file(&path);
            std::fs::rename(&temp_path, &path)
        })
        .map_err(|error| format!("Could not replace device settings: {error}"))
}

#[tauri::command]
fn read_sync_config(app: tauri::AppHandle) -> Result<SyncConfig, String> {
    load_sync_config(&app)
}

#[tauri::command]
fn write_sync_config(app: tauri::AppHandle, config: SyncConfig) -> Result<SyncConfig, String> {
    save_sync_config(&app, &config)?;
    Ok(config)
}

fn backup_existing_state(path: &std::path::Path) {
    if !path.is_file() {
        return;
    }
    let Some(dir) = path.parent() else { return };
    let backup_dir = dir.join("state-backups");
    if std::fs::create_dir_all(&backup_dir).is_err() {
        return;
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let recent_path = backup_dir.join(format!("buildbook-state-recent-{stamp}.json"));
    let _ = std::fs::copy(path, recent_path);

    let week = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() / 604_800)
        .unwrap_or(0);
    let weekly_path = backup_dir.join(format!("buildbook-state-week-{week}.json"));
    let _ = std::fs::copy(path, weekly_path);

    prune_state_backups(&backup_dir, "buildbook-state-recent-", 3);
    prune_state_backups(&backup_dir, "buildbook-state-week-", 52);
}

fn prune_state_backups(backup_dir: &std::path::Path, prefix: &str, keep: usize) {
    let mut backups = std::fs::read_dir(backup_dir)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.flatten())
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_name()?.to_string_lossy();
            if !name.starts_with(prefix) || !name.ends_with(".json") {
                return None;
            }
            let modified = entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .ok()?;
            Some((modified, path))
        })
        .collect::<Vec<_>>();
    backups.sort_by_key(|(modified, _)| *modified);
    let excess = backups.len().saturating_sub(keep);
    for (_, old_path) in backups.into_iter().take(excess) {
        let _ = std::fs::remove_file(old_path);
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StateBackupInfo {
    file_name: String,
    kind: String,
    modified_ms: u128,
    size: u64,
}

#[tauri::command]
fn list_state_backups(app: tauri::AppHandle) -> Result<Vec<StateBackupInfo>, String> {
    let path = state_file_path(&app)?;
    let Some(dir) = path.parent() else {
        return Ok(vec![]);
    };
    let backup_dir = dir.join("state-backups");
    if !backup_dir.is_dir() {
        return Ok(vec![]);
    }
    let mut backups = std::fs::read_dir(&backup_dir)
        .map_err(|error| format!("Could not read state backups: {error}"))?
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let file_name = path.file_name()?.to_string_lossy().to_string();
            if !file_name.ends_with(".json") {
                return None;
            }
            let kind = if file_name.starts_with("buildbook-state-recent-") {
                "recent"
            } else if file_name.starts_with("buildbook-state-week-") {
                "weekly"
            } else {
                return None;
            };
            let metadata = entry.metadata().ok()?;
            let modified_ms = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis())
                .unwrap_or(0);
            Some(StateBackupInfo {
                file_name,
                kind: kind.to_string(),
                modified_ms,
                size: metadata.len(),
            })
        })
        .collect::<Vec<_>>();
    backups.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    Ok(backups)
}

#[tauri::command]
fn restore_state_backup(app: tauri::AppHandle, file_name: String) -> Result<(), String> {
    if file_name.contains('/') || file_name.contains('\\') || !file_name.ends_with(".json") {
        return Err("Invalid state backup name.".to_string());
    }
    if !file_name.starts_with("buildbook-state-recent-")
        && !file_name.starts_with("buildbook-state-week-")
    {
        return Err("Invalid state backup name.".to_string());
    }
    let path = state_file_path(&app)?;
    let Some(dir) = path.parent() else {
        return Err("Could not resolve app data folder.".to_string());
    };
    let backup_path = dir.join("state-backups").join(file_name);
    if !backup_path.is_file() {
        return Err("State backup was not found.".to_string());
    }
    let contents = std::fs::read_to_string(&backup_path)
        .map_err(|error| format!("Could not read state backup: {error}"))?;
    serde_json::from_str::<serde_json::Value>(&contents)
        .map_err(|error| format!("State backup is not valid JSON: {error}"))?;
    backup_existing_state(&path);
    write_app_state(app, contents)
}

#[tauri::command]
fn read_app_state(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = state_file_path(&app)?;

    if !path.exists() {
        return Ok(None);
    }

    std::fs::read_to_string(path)
        .map(Some)
        .map_err(|error| format!("Could not read app state: {error}"))
}

fn validate_state_contents(contents: &str) -> Result<(), String> {
    let value = serde_json::from_str::<serde_json::Value>(contents)
        .map_err(|error| format!("App state is not valid JSON: {error}"))?;
    if !value.is_object() {
        return Err("App state must be a JSON object.".to_string());
    }
    Ok(())
}

static STATE_WRITE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn state_write_lock() -> &'static Mutex<()> {
    STATE_WRITE_LOCK.get_or_init(|| Mutex::new(()))
}

fn write_app_state_inner(app: &tauri::AppHandle, contents: &str) -> Result<(), String> {
    validate_state_contents(contents)?;
    let path = state_file_path(app)?;
    backup_existing_state(&path);
    let temp_path = path.with_extension("json.tmp");
    {
        let mut file = std::fs::File::create(&temp_path)
            .map_err(|error| format!("Could not create temporary app state: {error}"))?;
        file.write_all(contents.as_bytes())
            .map_err(|error| format!("Could not write temporary app state: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("Could not flush temporary app state: {error}"))?;
    }
    std::fs::rename(&temp_path, &path)
        .or_else(|_| {
            let _ = std::fs::remove_file(&path);
            std::fs::rename(&temp_path, &path)
        })
        .map_err(|error| format!("Could not replace app state: {error}"))
}

#[tauri::command]
fn write_app_state(app: tauri::AppHandle, contents: String) -> Result<(), String> {
    let _guard = state_write_lock()
        .lock()
        .map_err(|_| "Could not lock BuildBook state.".to_string())?;
    write_app_state_inner(&app, &contents)
}

#[derive(serde::Serialize, serde::Deserialize)]
struct StoredFile {
    name: String,
    path: String,
    size: u64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PreparedEditFile {
    name: String,
    path: String,
    size: u64,
    base_hash: String,
    pending: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LinkedFolderFile {
    name: String,
    relative_path: String,
    path: String,
    size: u64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OrphanFile {
    name: String,
    path: String,
    relative_path: String,
    size: u64,
    modified_at: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageScan {
    file_count: usize,
    total_bytes: u64,
    orphan_count: usize,
    orphan_bytes: u64,
    deleted_count: usize,
    deleted_bytes: u64,
    orphans: Vec<OrphanFile>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageScanRequest {
    referenced_paths: Vec<String>,
    delete_paths: Option<Vec<String>>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ResetStorageResult {
    retained_files: Vec<String>,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteManagedFilesResult {
    deleted_paths: Vec<String>,
    failed_paths: Vec<String>,
}

#[derive(serde::Serialize, Clone)]
struct LanServerInfo {
    running: bool,
    url: String,
    port: u16,
}

#[derive(serde::Deserialize, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WebAuthConfig {
    enabled: bool,
    scope: String,
    username: String,
    password_salt: String,
    password_hash: String,
    password_algorithm: Option<String>,
    password_iterations: Option<u32>,
    session_secret: String,
    remember_days: Option<u32>,
    allowed_hosts: Option<String>,
}

struct LanServerHandle {
    port: u16,
    url: String,
    token: String,
    require_token: bool,
    web_auth: WebAuthConfig,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    discovery_thread: Option<JoinHandle<()>>,
}

static LAN_SERVER: OnceLock<Mutex<Option<LanServerHandle>>> = OnceLock::new();
static FILE_CHECKOUTS: OnceLock<Mutex<HashMap<String, FileCheckoutLease>>> = OnceLock::new();

const HOST_SYNC_PROTOCOL: &str = "1.0";
const DISCOVERY_REQUEST: &[u8] = b"BUILD_BOOK_DISCOVER_V1";

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BuildBookHostInfo {
    product: String,
    app_version: String,
    protocol_version: String,
    device_id: String,
    device_name: String,
    url: String,
    hosting_enabled: bool,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SyncStateEnvelope {
    revision: String,
    contents: serde_json::Value,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncStateWriteRequest {
    base_revision: String,
    device_id: String,
    contents: serde_json::Value,
    force: Option<bool>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ClientSyncResult {
    contents: String,
    status: String,
    revision: String,
    pending: bool,
    message: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FileCheckoutLease {
    path: String,
    device_id: String,
    device_name: String,
    expires_at: u64,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileCheckoutRequest {
    action: String,
    path: String,
    device_id: String,
    device_name: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileCheckoutResult {
    acquired: bool,
    offline: bool,
    lease: Option<FileCheckoutLease>,
    message: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairDeviceRequest {
    pairing_code: String,
    device_id: String,
    device_name: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairDeviceResponse {
    host: BuildBookHostInfo,
    device_token: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncStatusDashboard {
    mode: String,
    device_id: String,
    device_name: String,
    host_url: String,
    host_revision: String,
    pending_sync: bool,
    last_connected_at: u64,
    last_sync_error: String,
    pairing_code_expires_at: u64,
    pairing_locked_until: u64,
    paired_devices: Vec<PairedDevice>,
    active_checkouts: Vec<FileCheckoutLease>,
    cache_file_count: u64,
    cache_bytes: u64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncConflictItem {
    path: String,
    label: String,
    local_changed: bool,
    host_changed: bool,
    local_preview: String,
    host_preview: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncConflictSummary {
    has_conflict: bool,
    items: Vec<SyncConflictItem>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncConflictSelection {
    path: String,
    choice: String,
}

fn file_checkouts() -> &'static Mutex<HashMap<String, FileCheckoutLease>> {
    FILE_CHECKOUTS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn active_file_checkouts() -> Vec<FileCheckoutLease> {
    let now = now_seconds();
    let Ok(mut leases) = file_checkouts().lock() else {
        return Vec::new();
    };
    leases.retain(|_, lease| lease.expires_at > now);
    leases.values().cloned().collect()
}

#[tauri::command]
fn clear_sync_checkout(path: String) -> Result<Vec<FileCheckoutLease>, String> {
    let key = path.trim().to_ascii_lowercase();
    if key.is_empty() {
        return Err("A checkout path is required.".to_string());
    }
    let mut leases = file_checkouts()
        .lock()
        .map_err(|_| "Could not lock file checkouts.".to_string())?;
    leases.retain(|lease_path, _| lease_path != &key);
    drop(leases);
    Ok(active_file_checkouts())
}

fn apply_file_checkout(request: FileCheckoutRequest) -> Result<FileCheckoutResult, String> {
    let now = now_seconds();
    let mut leases = file_checkouts()
        .lock()
        .map_err(|_| "Could not lock file checkouts.".to_string())?;
    leases.retain(|_, lease| lease.expires_at > now);
    let key = request.path.trim().to_ascii_lowercase();
    if key.is_empty() {
        return Err("A file path is required for checkout.".to_string());
    }
    if request.action == "release" {
        if leases
            .get(&key)
            .is_some_and(|lease| lease.device_id == request.device_id)
        {
            leases.remove(&key);
        }
        return Ok(FileCheckoutResult {
            acquired: true,
            offline: false,
            lease: None,
            message: "File checkout released.".to_string(),
        });
    }
    if let Some(existing) = leases.get(&key) {
        if existing.device_id != request.device_id {
            return Ok(FileCheckoutResult {
                acquired: false,
                offline: false,
                lease: Some(existing.clone()),
                message: format!("This file is checked out by {}.", existing.device_name),
            });
        }
    }
    let lease = FileCheckoutLease {
        path: request.path,
        device_id: request.device_id,
        device_name: request.device_name,
        expires_at: now + 60,
    };
    leases.insert(key, lease.clone());
    Ok(FileCheckoutResult {
        acquired: true,
        offline: false,
        lease: Some(lease),
        message: "File checked out for editing.".to_string(),
    })
}

fn state_revision(contents: &str) -> Result<String, String> {
    let value = serde_json::from_str::<serde_json::Value>(contents)
        .map_err(|error| format!("App state is not valid JSON: {error}"))?;
    let canonical = serde_json::to_vec(&value)
        .map_err(|error| format!("Could not encode app state revision: {error}"))?;
    Ok(sha256_hex(&String::from_utf8_lossy(&canonical)))
}

fn sha256_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

#[cfg(target_os = "windows")]
#[link(name = "advapi32")]
extern "system" {
    #[link_name = "SystemFunction036"]
    fn rtl_gen_random(buffer: *mut std::ffi::c_void, length: u32) -> u8;
}

fn secure_random_bytes(length: usize) -> Vec<u8> {
    let mut bytes = vec![0u8; length];
    #[cfg(target_os = "windows")]
    unsafe {
        if rtl_gen_random(bytes.as_mut_ptr().cast(), bytes.len() as u32) != 0 {
            return bytes;
        }
    }
    let fallback = format!(
        "{}:{:?}:{}",
        now_seconds(),
        std::time::SystemTime::now(),
        length
    );
    sha256_hex(&fallback)
        .as_bytes()
        .iter()
        .cycle()
        .take(length)
        .copied()
        .collect()
}

fn generated_secret(label: &str) -> String {
    let mut bytes = secure_random_bytes(32);
    bytes.extend_from_slice(label.as_bytes());
    sha256_bytes(&bytes)
}

fn client_auth_header(config: &SyncConfig) -> String {
    if config.client_auth_token.trim().is_empty() {
        config.host_token.trim().to_string()
    } else {
        config.client_auth_token.trim().to_string()
    }
}

fn auth_header_name(config: &SyncConfig) -> &'static str {
    if config.client_auth_token.trim().is_empty() {
        "X-BuildBook-Token"
    } else {
        "X-BuildBook-Device-Token"
    }
}

fn sync_base_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let path = sync_config_path(app)?;
    Ok(path.with_file_name("buildbook-sync-base.json"))
}

fn sync_conflict_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let path = sync_config_path(app)?;
    Ok(path.with_file_name("buildbook-sync-conflict.json"))
}

fn write_sync_snapshot(path: std::path::PathBuf, contents: &str) -> Result<(), String> {
    validate_state_contents(contents)?;
    std::fs::write(path, contents)
        .map_err(|error| format!("Could not write sync snapshot: {error}"))
}

fn read_local_state_or_default(app: &tauri::AppHandle) -> Result<String, String> {
    read_app_state(app.clone()).map(|contents| contents.unwrap_or_else(|| "{}".to_string()))
}

fn compact_host_error(status: reqwest::StatusCode, body: String, context: &str) -> String {
    let mut text = String::new();
    let mut in_tag = false;
    for character in body.chars() {
        match character {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                text.push(' ');
            }
            _ if !in_tag => text.push(character),
            _ => {}
        }
    }
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if status.as_u16() == 502 {
        return "Host returned 502 Bad Gateway. The BuildBook host or proxy is not reachable.".to_string();
    }
    if status.as_u16() == 503 {
        return "Host returned 503 Service Unavailable. The BuildBook host may be stopped.".to_string();
    }
    if text.trim().is_empty() {
        format!("BuildBook host returned {status} {context}.")
    } else {
        text.chars().take(220).collect()
    }
}

fn host_sync_get(config: &SyncConfig) -> Result<SyncStateEnvelope, String> {
    let host_url = normalized_host_url(&config.host_url)?;
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|error| format!("Could not prepare host connection: {error}"))?;
    let response = client
        .get(format!("{host_url}/api/sync/state"))
        .header("X-BuildBook-Request", "1")
        .header(auth_header_name(config), client_auth_header(config))
        .send()
        .map_err(|error| format!("Could not reach BuildBook host: {error}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let message = response.text().unwrap_or_default();
        return Err(compact_host_error(status, message, "while loading sync state"));
    }
    response
        .json::<SyncStateEnvelope>()
        .map_err(|error| format!("Host sync response was invalid: {error}"))
}

fn host_sync_revision(config: &SyncConfig) -> Result<String, String> {
    let host_url = normalized_host_url(&config.host_url)?;
    let response = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|error| format!("Could not prepare host connection: {error}"))?
        .get(format!("{host_url}/api/sync/revision"))
        .header("X-BuildBook-Request", "1")
        .header(auth_header_name(config), client_auth_header(config))
        .send()
        .map_err(|error| format!("Could not reach BuildBook host: {error}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let message = response.text().unwrap_or_default();
        return Err(compact_host_error(status, message, "while checking sync revision"));
    }
    response
        .text()
        .map(|revision| revision.trim().to_string())
        .map_err(|error| format!("Could not read host revision: {error}"))
}

enum HostSyncWrite {
    Saved(SyncStateEnvelope),
    Conflict(SyncStateEnvelope),
}

fn host_sync_write(
    config: &SyncConfig,
    contents: &str,
    force: bool,
) -> Result<HostSyncWrite, String> {
    let host_url = normalized_host_url(&config.host_url)?;
    let state = serde_json::from_str::<serde_json::Value>(contents)
        .map_err(|error| format!("App state is not valid JSON: {error}"))?;
    let request = SyncStateWriteRequest {
        base_revision: config.host_revision.clone(),
        device_id: config.device_id.clone(),
        contents: state,
        force: Some(force),
    };
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| format!("Could not prepare host connection: {error}"))?;
    let response = client
        .post(format!("{host_url}/api/sync/state"))
        .header("X-BuildBook-Request", "1")
        .header(auth_header_name(config), client_auth_header(config))
        .json(&request)
        .send()
        .map_err(|error| format!("Could not reach BuildBook host: {error}"))?;
    let status = response.status();
    if status.as_u16() == 409 {
        let envelope = response
            .json::<SyncStateEnvelope>()
            .map_err(|error| format!("Host conflict response was invalid: {error}"))?;
        return Ok(HostSyncWrite::Conflict(envelope));
    }
    if !status.is_success() {
        let message = response.text().unwrap_or_default();
        return Err(compact_host_error(status, message, "while saving sync state"));
    }
    response
        .json::<SyncStateEnvelope>()
        .map(HostSyncWrite::Saved)
        .map_err(|error| format!("Host save response was invalid: {error}"))
}

fn mark_sync_success(
    app: &tauri::AppHandle,
    config: &mut SyncConfig,
    revision: String,
    contents: &str,
) -> Result<(), String> {
    config.host_revision = revision;
    config.pending_sync = false;
    config.last_connected_at = now_seconds();
    config.last_sync_error.clear();
    save_sync_config(app, config)?;
    write_sync_snapshot(sync_base_path(app)?, contents)?;
    let conflict_path = sync_conflict_path(app)?;
    if conflict_path.is_file() {
        let _ = std::fs::remove_file(conflict_path);
    }
    Ok(())
}

fn mark_sync_conflict(
    app: &tauri::AppHandle,
    config: &mut SyncConfig,
    envelope: &SyncStateEnvelope,
) -> Result<(), String> {
    config.pending_sync = true;
    config.last_connected_at = now_seconds();
    config.last_sync_error = "Host data changed while this computer had local changes.".to_string();
    save_sync_config(app, config)?;
    let contents = serde_json::to_string_pretty(&envelope.contents)
        .map_err(|error| format!("Could not encode conflict state: {error}"))?;
    write_sync_snapshot(sync_conflict_path(app)?, &contents)
}

fn merge_sync_values(
    base: &serde_json::Value,
    local: &serde_json::Value,
    host: &serde_json::Value,
    path: &str,
    device_name: &str,
) -> serde_json::Value {
    if local == host {
        return local.clone();
    }
    if local == base {
        return host.clone();
    }
    if host == base {
        return local.clone();
    }
    match (base, local, host) {
        (
            serde_json::Value::Object(base_map),
            serde_json::Value::Object(local_map),
            serde_json::Value::Object(host_map),
        ) => {
            let mut keys = std::collections::BTreeSet::new();
            keys.extend(base_map.keys().cloned());
            keys.extend(local_map.keys().cloned());
            keys.extend(host_map.keys().cloned());
            let mut merged = serde_json::Map::new();
            for key in keys {
                let next_path = if path.is_empty() {
                    key.clone()
                } else {
                    format!("{path}.{key}")
                };
                let missing = serde_json::Value::Null;
                let value = merge_sync_values(
                    base_map.get(&key).unwrap_or(&missing),
                    local_map.get(&key).unwrap_or(&missing),
                    host_map.get(&key).unwrap_or(&missing),
                    &next_path,
                    device_name,
                );
                if !value.is_null() || local_map.contains_key(&key) || host_map.contains_key(&key) {
                    merged.insert(key, value);
                }
            }
            serde_json::Value::Object(merged)
        }
        (
            serde_json::Value::Array(base_items),
            serde_json::Value::Array(local_items),
            serde_json::Value::Array(host_items),
        ) => {
            let item_id = |value: &serde_json::Value| {
                value
                    .get("id")
                    .and_then(|id| id.as_str())
                    .map(str::to_string)
            };
            if local_items.iter().all(|item| item_id(item).is_some())
                && host_items.iter().all(|item| item_id(item).is_some())
            {
                let base_by_id = base_items
                    .iter()
                    .filter_map(|item| item_id(item).map(|id| (id, item)))
                    .collect::<std::collections::HashMap<_, _>>();
                let local_by_id = local_items
                    .iter()
                    .filter_map(|item| item_id(item).map(|id| (id, item)))
                    .collect::<std::collections::HashMap<_, _>>();
                let host_by_id = host_items
                    .iter()
                    .filter_map(|item| item_id(item).map(|id| (id, item)))
                    .collect::<std::collections::HashMap<_, _>>();
                let mut order = host_items.iter().filter_map(item_id).collect::<Vec<_>>();
                for id in local_items.iter().filter_map(item_id) {
                    if !order.contains(&id) {
                        order.push(id);
                    }
                }
                return serde_json::Value::Array(
                    order
                        .into_iter()
                        .filter_map(|id| {
                            let missing = serde_json::Value::Null;
                            let merged = merge_sync_values(
                                base_by_id.get(&id).copied().unwrap_or(&missing),
                                local_by_id.get(&id).copied().unwrap_or(&missing),
                                host_by_id.get(&id).copied().unwrap_or(&missing),
                                &format!("{path}[{id}]"),
                                device_name,
                            );
                            (!merged.is_null()).then_some(merged)
                        })
                        .collect(),
                );
            }
            host.clone()
        }
        (
            serde_json::Value::String(_),
            serde_json::Value::String(local_text),
            serde_json::Value::String(host_text),
        ) if path.starts_with("projects[") && (path.ends_with(".notes") || (path.contains(".noteSheets[") && path.ends_with(".content"))) => {
            if local_text.trim().is_empty() {
                host.clone()
            } else if host_text.trim().is_empty() {
                local.clone()
            } else {
                serde_json::Value::String(format!(
                    "{host_text}<hr><p><strong>Combined notes from {}</strong></p>{local_text}",
                    device_name
                ))
            }
        }
        _ => host.clone(),
    }
}

fn value_name(value: &serde_json::Value, fallback: &str) -> String {
    value
        .get("name")
        .and_then(|name| name.as_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn conflict_preview(value: &serde_json::Value) -> String {
    if value.is_null() {
        return "Deleted or missing".to_string();
    }
    let name = value
        .get("name")
        .and_then(|name| name.as_str())
        .unwrap_or("");
    let notes = value
        .get("notes")
        .and_then(|notes| notes.as_str())
        .unwrap_or("");
    let summary = value
        .get("specSummary")
        .and_then(|text| text.as_str())
        .unwrap_or("");
    let counts = [
        ("projects", value.get("projects").and_then(|items| items.as_array()).map(|items| items.len())),
        ("parts", value.get("parts").and_then(|items| items.as_array()).map(|items| items.len())),
        ("files", value.get("files").and_then(|items| items.as_array()).map(|items| items.len())),
        ("photos", value.get("photoFolders").and_then(|items| items.as_array()).map(|items| items.len())),
    ]
    .into_iter()
    .filter_map(|(label, count)| count.map(|count| format!("{count} {label}")))
    .collect::<Vec<_>>();
    let mut text = [name, notes, summary]
        .into_iter()
        .filter(|item| !item.trim().is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if !counts.is_empty() {
        if !text.is_empty() {
            text.push_str(" - ");
        }
        text.push_str(&counts.join(", "));
    }
    if text.trim().is_empty() {
        text = serde_json::to_string(value).unwrap_or_default();
    }
    let compact = text
        .replace("<br>", " ")
        .replace("</p>", " ")
        .replace(['<', '>'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if compact.chars().count() > 220 {
        format!("{}...", compact.chars().take(220).collect::<String>())
    } else {
        compact
    }
}

fn summarize_array_conflicts(
    items: &mut Vec<SyncConflictItem>,
    label: &str,
    path: &str,
    base: &serde_json::Value,
    local: &serde_json::Value,
    host: &serde_json::Value,
) {
    let base_items = base.as_array().cloned().unwrap_or_default();
    let local_items = local.as_array().cloned().unwrap_or_default();
    let host_items = host.as_array().cloned().unwrap_or_default();
    let by_id = |values: Vec<serde_json::Value>| {
        values
            .into_iter()
            .filter_map(|value| {
                let id = value
                    .get("id")
                    .and_then(|id| id.as_str())
                    .map(str::to_string)?;
                Some((id, value))
            })
            .collect::<HashMap<_, _>>()
    };
    let base_map = by_id(base_items);
    let local_map = by_id(local_items);
    let host_map = by_id(host_items);
    let mut ids = base_map.keys().cloned().collect::<Vec<_>>();
    for id in local_map.keys().chain(host_map.keys()) {
        if !ids.contains(id) {
            ids.push(id.clone());
        }
    }
    for id in ids {
        let missing = serde_json::Value::Null;
        let base_value = base_map.get(&id).unwrap_or(&missing);
        let local_value = local_map.get(&id).unwrap_or(&missing);
        let host_value = host_map.get(&id).unwrap_or(&missing);
        let local_changed = local_value != base_value;
        let host_changed = host_value != base_value;
        if local_changed && host_changed && local_value != host_value {
            let name = value_name(local_value, &value_name(host_value, &id));
            items.push(SyncConflictItem {
                path: format!("{path}[{id}]"),
                label: format!("{label}: {name}"),
                local_changed,
                host_changed,
                local_preview: conflict_preview(local_value),
                host_preview: conflict_preview(host_value),
            });
        }
        if items.len() >= 16 {
            return;
        }
    }
}

fn sync_conflict_items_for_values(
    base: &serde_json::Value,
    local: &serde_json::Value,
    host: &serde_json::Value,
) -> Vec<SyncConflictItem> {
    let mut items = Vec::new();
    summarize_array_conflicts(
        &mut items,
        "Project",
        "projects",
        base.get("projects").unwrap_or(&serde_json::Value::Null),
        local.get("projects").unwrap_or(&serde_json::Value::Null),
        host.get("projects").unwrap_or(&serde_json::Value::Null),
    );
    summarize_array_conflicts(
        &mut items,
        "Part",
        "parts",
        base.get("parts").unwrap_or(&serde_json::Value::Null),
        local.get("parts").unwrap_or(&serde_json::Value::Null),
        host.get("parts").unwrap_or(&serde_json::Value::Null),
    );
    for key in ["categories", "template", "revisionSettings", "theme"] {
        let missing = serde_json::Value::Null;
        let base_value = base.get(key).unwrap_or(&missing);
        let local_value = local.get(key).unwrap_or(&missing);
        let host_value = host.get(key).unwrap_or(&missing);
        let local_changed = local_value != base_value;
        let host_changed = host_value != base_value;
        if local_changed && host_changed && local_value != host_value {
            items.push(SyncConflictItem {
                path: key.to_string(),
                label: key.to_string(),
                local_changed,
                host_changed,
                local_preview: conflict_preview(local_value),
                host_preview: conflict_preview(host_value),
            });
        }
    }
    items
}

#[tauri::command]
fn sync_conflict_summary(app: tauri::AppHandle) -> Result<SyncConflictSummary, String> {
    let conflict_path = sync_conflict_path(&app)?;
    if !conflict_path.is_file() {
        return Ok(SyncConflictSummary {
            has_conflict: false,
            items: Vec::new(),
        });
    }
    let local = serde_json::from_str::<serde_json::Value>(&read_local_state_or_default(&app)?)
        .map_err(|error| format!("Local state is not valid JSON: {error}"))?;
    let host = serde_json::from_str::<serde_json::Value>(
        &std::fs::read_to_string(&conflict_path)
            .map_err(|error| format!("Could not read host conflict state: {error}"))?,
    )
    .map_err(|error| format!("Host conflict state is not valid JSON: {error}"))?;
    let base = serde_json::from_str::<serde_json::Value>(
        &std::fs::read_to_string(sync_base_path(&app)?).unwrap_or_else(|_| "{}".to_string()),
    )
    .unwrap_or_else(|_| serde_json::json!({}));
    let items = sync_conflict_items_for_values(&base, &local, &host);
    Ok(SyncConflictSummary {
        has_conflict: true,
        items,
    })
}

fn path_array_target(path: &str) -> Option<(&str, &str)> {
    let (array_name, id) = path.split_once('[')?;
    Some((array_name, id.trim_end_matches(']')))
}

fn value_at_conflict_path(root: &serde_json::Value, path: &str) -> serde_json::Value {
    if let Some((array_name, id)) = path_array_target(path) {
        return root
            .get(array_name)
            .and_then(|items| items.as_array())
            .and_then(|items| {
                items.iter().find(|item| {
                    item.get("id")
                        .and_then(|value| value.as_str())
                        .is_some_and(|item_id| item_id == id)
                })
            })
            .cloned()
            .unwrap_or(serde_json::Value::Null);
    }
    root.get(path).cloned().unwrap_or(serde_json::Value::Null)
}

fn apply_conflict_value(target: &mut serde_json::Value, path: &str, value: serde_json::Value) {
    if let Some((array_name, id)) = path_array_target(path) {
        let Some(object) = target.as_object_mut() else {
            return;
        };
        let entry = object
            .entry(array_name.to_string())
            .or_insert_with(|| serde_json::Value::Array(Vec::new()));
        let Some(items) = entry.as_array_mut() else {
            return;
        };
        if value.is_null() {
            items.retain(|item| {
                item.get("id")
                    .and_then(|item_id| item_id.as_str())
                    .is_none_or(|item_id| item_id != id)
            });
            return;
        }
        if let Some(existing) = items.iter_mut().find(|item| {
            item.get("id")
                .and_then(|item_id| item_id.as_str())
                .is_some_and(|item_id| item_id == id)
        }) {
            *existing = value;
        } else {
            items.push(value);
        }
        return;
    }
    if let Some(object) = target.as_object_mut() {
        if value.is_null() {
            object.remove(path);
        } else {
            object.insert(path.to_string(), value);
        }
    }
}

fn save_non_conflicting_sync_changes(
    app: &tauri::AppHandle,
    config: &mut SyncConfig,
    local_contents: &str,
) -> Result<ClientSyncResult, String> {
    let conflict_path = sync_conflict_path(app)?;
    if !conflict_path.is_file() {
        return Err("No synchronization conflict is waiting for resolution.".to_string());
    }
    let host_contents = std::fs::read_to_string(&conflict_path)
        .map_err(|error| format!("Could not read host conflict state: {error}"))?;
    let base_contents = std::fs::read_to_string(sync_base_path(app)?)
        .map_err(|error| format!("Could not read the common sync version: {error}"))?;
    let base = serde_json::from_str::<serde_json::Value>(&base_contents)
        .map_err(|error| format!("Common sync version is invalid: {error}"))?;
    let local = serde_json::from_str::<serde_json::Value>(local_contents)
        .map_err(|error| format!("Local sync version is invalid: {error}"))?;
    let host = serde_json::from_str::<serde_json::Value>(&host_contents)
        .map_err(|error| format!("Host conflict state is invalid: {error}"))?;
    let conflicts = sync_conflict_items_for_values(&base, &local, &host);
    let mut host_safe = merge_sync_values(&base, &local, &host, "", &config.device_name);
    for item in &conflicts {
        apply_conflict_value(&mut host_safe, &item.path, value_at_conflict_path(&host, &item.path));
    }
    let host_safe_contents = serde_json::to_string_pretty(&host_safe)
        .map_err(|error| format!("Could not encode non-conflicting sync changes: {error}"))?;
    config.host_revision = state_revision(&host_contents)?;
    match host_sync_write(config, &host_safe_contents, true)? {
        HostSyncWrite::Saved(envelope) => {
            config.host_revision = envelope.revision.clone();
            config.pending_sync = true;
            config.last_connected_at = now_seconds();
            config.last_sync_error = "Resolve the remaining synchronization conflict.".to_string();
            save_sync_config(app, config)?;
            write_sync_snapshot(sync_conflict_path(app)?, &host_safe_contents)?;
            Ok(ClientSyncResult {
                contents: local_contents.to_string(),
                status: "conflict".to_string(),
                revision: envelope.revision,
                pending: true,
                message: "Non-conflicting changes were saved to the host. Resolve the remaining conflict to continue full synchronization.".to_string(),
            })
        }
        HostSyncWrite::Conflict(envelope) => {
            mark_sync_conflict(app, config, &envelope)?;
            Ok(ClientSyncResult {
                contents: local_contents.to_string(),
                status: "conflict".to_string(),
                revision: envelope.revision,
                pending: true,
                message: "The host changed again. Resolve the conflict before full synchronization can continue.".to_string(),
            })
        }
    }
}

#[tauri::command]
fn resolve_sync_conflict_selections(
    app: tauri::AppHandle,
    selections: Vec<SyncConflictSelection>,
) -> Result<ClientSyncResult, String> {
    let mut config = load_sync_config(&app)?;
    if config.mode != "client" {
        return Err("This computer is not configured as a BuildBook client.".to_string());
    }
    let local_contents = read_local_state_or_default(&app)?;
    let host_contents = std::fs::read_to_string(sync_conflict_path(&app)?)
        .map_err(|error| format!("Could not read host conflict state: {error}"))?;
    let base_contents = std::fs::read_to_string(sync_base_path(&app)?).unwrap_or_else(|_| "{}".to_string());
    let local = serde_json::from_str::<serde_json::Value>(&local_contents)
        .map_err(|error| format!("Local state is not valid JSON: {error}"))?;
    let host = serde_json::from_str::<serde_json::Value>(&host_contents)
        .map_err(|error| format!("Host conflict state is not valid JSON: {error}"))?;
    let base = serde_json::from_str::<serde_json::Value>(&base_contents)
        .unwrap_or_else(|_| serde_json::json!({}));
    let mut resolved = merge_sync_values(&base, &local, &host, "", &config.device_name);
    for selection in selections {
        let choice = selection.choice.trim().to_ascii_lowercase();
        let value = if choice == "host" {
            value_at_conflict_path(&host, &selection.path)
        } else if choice == "local" {
            value_at_conflict_path(&local, &selection.path)
        } else {
            continue;
        };
        apply_conflict_value(&mut resolved, &selection.path, value);
    }
    let contents = serde_json::to_string_pretty(&resolved)
        .map_err(|error| format!("Could not encode resolved state: {error}"))?;
    validate_state_contents(&contents)?;
    config.host_revision = state_revision(&host_contents)?;
    match host_sync_write(&config, &contents, true)? {
        HostSyncWrite::Saved(envelope) => {
            {
                let _guard = state_write_lock()
                    .lock()
                    .map_err(|_| "Could not lock BuildBook state.".to_string())?;
                write_app_state_inner(&app, &contents)?;
            }
            mark_sync_success(&app, &mut config, envelope.revision.clone(), &contents)?;
            Ok(ClientSyncResult {
                contents,
                status: "connected".to_string(),
                revision: envelope.revision,
                pending: false,
                message: "Conflict selections were saved to the host.".to_string(),
            })
        }
        HostSyncWrite::Conflict(_) => Err("The host changed again while resolving the conflict. Try again.".to_string()),
    }
}

#[tauri::command]
fn sync_client_load(app: tauri::AppHandle) -> Result<ClientSyncResult, String> {
    let mut config = load_sync_config(&app)?;
    let local = read_local_state_or_default(&app)?;
    if config.mode != "client" {
        return Ok(ClientSyncResult {
            revision: state_revision(&local)?,
            contents: local,
            status: "local".to_string(),
            pending: false,
            message: "Using local BuildBook data.".to_string(),
        });
    }

    if config.pending_sync {
        if sync_conflict_path(&app)?.is_file() {
            return Ok(ClientSyncResult {
                contents: local,
                status: "conflict".to_string(),
                revision: config.host_revision,
                pending: true,
                message: "Resolve the synchronization conflict before full synchronization can continue.".to_string(),
            });
        }
        match host_sync_write(&config, &local, false) {
            Ok(HostSyncWrite::Saved(envelope)) => {
                mark_sync_success(&app, &mut config, envelope.revision.clone(), &local)?;
                return Ok(ClientSyncResult {
                    contents: local,
                    status: "connected".to_string(),
                    revision: envelope.revision,
                    pending: false,
                    message: "Pending changes synchronized.".to_string(),
                });
            }
            Ok(HostSyncWrite::Conflict(envelope)) => {
                mark_sync_conflict(&app, &mut config, &envelope)?;
                return Ok(ClientSyncResult {
                    contents: local,
                    status: "conflict".to_string(),
                    revision: envelope.revision,
                    pending: true,
                    message: "Local and host data both changed. Choose which version to keep."
                        .to_string(),
                });
            }
            Err(error) => {
                config.last_sync_error = error.clone();
                save_sync_config(&app, &config)?;
                return Ok(ClientSyncResult {
                    contents: local,
                    status: "offline".to_string(),
                    revision: config.host_revision,
                    pending: true,
                    message: format!("Offline. Local changes are queued: {error}"),
                });
            }
        }
    }

    if !config.host_revision.is_empty() {
        match host_sync_revision(&config) {
            Ok(revision) if revision == config.host_revision => {
                return Ok(ClientSyncResult {
                    contents: local,
                    status: "connected".to_string(),
                    revision,
                    pending: false,
                    message: "Connected to host.".to_string(),
                });
            }
            Ok(_) => {}
            Err(error) => {
                config.last_sync_error = error.clone();
                save_sync_config(&app, &config)?;
                return Ok(ClientSyncResult {
                    contents: local,
                    status: "offline".to_string(),
                    revision: config.host_revision,
                    pending: false,
                    message: format!("Offline. Showing cached data: {error}"),
                });
            }
        }
    }

    match host_sync_get(&config) {
        Ok(envelope) => {
            let contents = serde_json::to_string_pretty(&envelope.contents)
                .map_err(|error| format!("Could not encode host state: {error}"))?;
            {
                let _guard = state_write_lock()
                    .lock()
                    .map_err(|_| "Could not lock BuildBook state.".to_string())?;
                write_app_state_inner(&app, &contents)?;
            }
            mark_sync_success(&app, &mut config, envelope.revision.clone(), &contents)?;
            Ok(ClientSyncResult {
                contents,
                status: "connected".to_string(),
                revision: envelope.revision,
                pending: false,
                message: "Synchronized with host.".to_string(),
            })
        }
        Err(error) => {
            config.last_sync_error = error.clone();
            save_sync_config(&app, &config)?;
            Ok(ClientSyncResult {
                contents: local,
                status: "offline".to_string(),
                revision: config.host_revision,
                pending: false,
                message: format!("Offline. Showing cached data: {error}"),
            })
        }
    }
}

#[tauri::command]
fn sync_client_save(app: tauri::AppHandle, contents: String) -> Result<ClientSyncResult, String> {
    validate_state_contents(&contents)?;
    {
        let _guard = state_write_lock()
            .lock()
            .map_err(|_| "Could not lock BuildBook state.".to_string())?;
        write_app_state_inner(&app, &contents)?;
    }
    let mut config = load_sync_config(&app)?;
    if config.mode != "client" {
        return Ok(ClientSyncResult {
            revision: state_revision(&contents)?,
            contents,
            status: "local".to_string(),
            pending: false,
            message: "Saved locally.".to_string(),
        });
    }
    config.pending_sync = true;
    save_sync_config(&app, &config)?;
    if sync_conflict_path(&app)?.is_file() {
        return save_non_conflicting_sync_changes(&app, &mut config, &contents);
    }
    match host_sync_write(&config, &contents, false) {
        Ok(HostSyncWrite::Saved(envelope)) => {
            mark_sync_success(&app, &mut config, envelope.revision.clone(), &contents)?;
            Ok(ClientSyncResult {
                contents,
                status: "connected".to_string(),
                revision: envelope.revision,
                pending: false,
                message: "Saved to host.".to_string(),
            })
        }
        Ok(HostSyncWrite::Conflict(envelope)) => {
            mark_sync_conflict(&app, &mut config, &envelope)?;
            Ok(ClientSyncResult {
                contents,
                status: "conflict".to_string(),
                revision: envelope.revision,
                pending: true,
                message: "Saved locally, but host data also changed. Resolve the conflict before synchronization can continue.".to_string(),
            })
        }
        Err(error) => {
            config.last_sync_error = error.clone();
            save_sync_config(&app, &config)?;
            Ok(ClientSyncResult {
                contents,
                status: "offline".to_string(),
                revision: config.host_revision,
                pending: true,
                message: format!("Saved locally and queued for host: {error}"),
            })
        }
    }
}

#[tauri::command]
fn resolve_sync_conflict(
    app: tauri::AppHandle,
    choice: String,
) -> Result<ClientSyncResult, String> {
    let mut config = load_sync_config(&app)?;
    if config.mode != "client" {
        return Err("This computer is not configured as a BuildBook client.".to_string());
    }
    let local = read_local_state_or_default(&app)?;
    let conflict_path = sync_conflict_path(&app)?;
    if !conflict_path.is_file() {
        return Err("No synchronization conflict is waiting for resolution.".to_string());
    }
    let host_contents = std::fs::read_to_string(&conflict_path)
        .map_err(|error| format!("Could not read host conflict state: {error}"))?;
    if choice == "host" {
        let envelope = host_sync_get(&config)?;
        let contents = serde_json::to_string_pretty(&envelope.contents)
            .map_err(|error| format!("Could not encode host state: {error}"))?;
        {
            let _guard = state_write_lock()
                .lock()
                .map_err(|_| "Could not lock BuildBook state.".to_string())?;
            write_app_state_inner(&app, &contents)?;
        }
        mark_sync_success(&app, &mut config, envelope.revision.clone(), &contents)?;
        return Ok(ClientSyncResult {
            contents,
            status: "connected".to_string(),
            revision: envelope.revision,
            pending: false,
            message: "Host version restored.".to_string(),
        });
    }
    if choice == "local" {
        config.host_revision = state_revision(&host_contents)?;
        match host_sync_write(&config, &local, true)? {
            HostSyncWrite::Saved(envelope) => {
                mark_sync_success(&app, &mut config, envelope.revision.clone(), &local)?;
                return Ok(ClientSyncResult {
                    contents: local,
                    status: "connected".to_string(),
                    revision: envelope.revision,
                    pending: false,
                    message: "This computer's version was saved as the host version.".to_string(),
                });
            }
            HostSyncWrite::Conflict(_) => {
                return Err(
                    "The host changed again while resolving the conflict. Try again.".to_string(),
                )
            }
        }
    }
    if choice == "combine" {
        let base_contents = std::fs::read_to_string(sync_base_path(&app)?)
            .map_err(|error| format!("Could not read the common sync version: {error}"))?;
        let base_value = serde_json::from_str::<serde_json::Value>(&base_contents)
            .map_err(|error| format!("Common sync version is invalid: {error}"))?;
        let local_value = serde_json::from_str::<serde_json::Value>(&local)
            .map_err(|error| format!("Local sync version is invalid: {error}"))?;
        let host_value = serde_json::from_str::<serde_json::Value>(&host_contents)
            .map_err(|error| format!("Host sync version is invalid: {error}"))?;
        let merged_value = merge_sync_values(
            &base_value,
            &local_value,
            &host_value,
            "",
            &config.device_name,
        );
        let merged = serde_json::to_string_pretty(&merged_value)
            .map_err(|error| format!("Could not encode combined sync state: {error}"))?;
        config.host_revision = state_revision(&host_contents)?;
        match host_sync_write(&config, &merged, true)? {
            HostSyncWrite::Saved(envelope) => {
                {
                    let _guard = state_write_lock()
                        .lock()
                        .map_err(|_| "Could not lock BuildBook state.".to_string())?;
                    write_app_state_inner(&app, &merged)?;
                }
                mark_sync_success(&app, &mut config, envelope.revision.clone(), &merged)?;
                return Ok(ClientSyncResult {
                    contents: merged,
                    status: "connected".to_string(),
                    revision: envelope.revision,
                    pending: false,
                    message:
                        "Independent changes were merged. Conflicting project notes were combined."
                            .to_string(),
                });
            }
            HostSyncWrite::Conflict(_) => {
                return Err(
                    "The host changed again while combining the conflict. Try again.".to_string(),
                )
            }
        }
    }
    Err("Choose host, local, or combined conflict resolution.".to_string())
}

fn host_file_bytes(config: &SyncConfig, path: &str) -> Result<Vec<u8>, String> {
    let host_url = normalized_host_url(&config.host_url)?;
    let mut endpoint = reqwest::Url::parse(&format!("{host_url}/api/files"))
        .map_err(|error| format!("Could not create host file address: {error}"))?;
    endpoint.query_pairs_mut().append_pair("path", path);
    append_host_file_auth(&mut endpoint, config);
    let response = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|error| format!("Could not prepare host file connection: {error}"))?
        .get(endpoint)
        .header("X-BuildBook-Request", "1")
        .header(auth_header_name(config), client_auth_header(config))
        .send()
        .map_err(|error| format!("Could not download host file: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "BuildBook host returned {} for this file.",
            response.status()
        ));
    }
    response
        .bytes()
        .map(|bytes| bytes.to_vec())
        .map_err(|error| format!("Could not read host file: {error}"))
}

fn host_file_cache_path(app: &tauri::AppHandle, path: &str) -> Result<std::path::PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data folder: {error}"))?;
    let file_name = std::path::Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("host-file");
    Ok(app_dir
        .join("sync-cache")
        .join("host-files")
        .join(sha256_hex(path))
        .join(safe_file_name(file_name)))
}

fn cache_host_file_bytes(app: &tauri::AppHandle, path: &str, bytes: &[u8]) -> Result<(), String> {
    let target = host_file_cache_path(app, path)?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create host file cache: {error}"))?;
    }
    std::fs::write(target, bytes).map_err(|error| format!("Could not cache host file: {error}"))
}

fn read_cached_host_file(app: &tauri::AppHandle, path: &str) -> Result<Vec<u8>, String> {
    let target = host_file_cache_path(app, path)?;
    std::fs::read(target).map_err(|error| format!("No cached host file is available: {error}"))
}

fn folder_size(path: &std::path::Path) -> (u64, u64) {
    let Ok(entries) = std::fs::read_dir(path) else {
        return (0, 0);
    };
    let mut file_count = 0;
    let mut bytes = 0;
    for entry in entries.flatten() {
        let entry_path = entry.path();
        if entry_path.is_dir() {
            let (child_count, child_bytes) = folder_size(&entry_path);
            file_count += child_count;
            bytes += child_bytes;
        } else if let Ok(metadata) = entry.metadata() {
            file_count += 1;
            bytes += metadata.len();
        }
    }
    (file_count, bytes)
}

fn sync_cache_stats(app: &tauri::AppHandle) -> (u64, u64) {
    let Ok(app_dir) = app.path().app_data_dir() else {
        return (0, 0);
    };
    folder_size(&app_dir.join("sync-cache"))
}

fn host_file_endpoint(config: &SyncConfig) -> Result<reqwest::Url, String> {
    let host_url = normalized_host_url(&config.host_url)?;
    reqwest::Url::parse(&format!("{host_url}/api/files"))
        .map_err(|error| format!("Could not create host file address: {error}"))
}

fn append_host_file_auth(endpoint: &mut reqwest::Url, config: &SyncConfig) {
    let mut query = endpoint.query_pairs_mut();
    if !config.host_token.trim().is_empty() {
        query.append_pair("access", config.host_token.trim());
    }
    if !config.client_auth_token.trim().is_empty() {
        query
            .append_pair("deviceToken", config.client_auth_token.trim())
            .append_pair("device", &config.device_id);
    }
}

fn host_request_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|error| format!("Could not prepare host file connection: {error}"))
}

fn parse_host_stored_file(response: reqwest::blocking::Response) -> Result<StoredFile, String> {
    let status = response.status();
    if !status.is_success() {
        let message = response.text().unwrap_or_default();
        return Err(compact_host_error(status, message, "for this file"));
    }
    response
        .json::<StoredFile>()
        .map_err(|error| format!("Could not read the host file response: {error}"))
}

#[tauri::command]
fn sync_read_cached_host_file(app: tauri::AppHandle, path: String) -> Result<Vec<u8>, String> {
    let config = load_sync_config(&app)?;
    if config.mode != "client" {
        return Err("This computer is not configured as a BuildBook client.".to_string());
    }
    read_cached_host_file(&app, &path)
}

#[tauri::command]
fn sync_read_host_file(app: tauri::AppHandle, path: String) -> Result<Vec<u8>, String> {
    let config = load_sync_config(&app)?;
    if config.mode != "client" {
        return Err("This computer is not configured as a BuildBook client.".to_string());
    }
    match host_file_bytes(&config, &path) {
        Ok(bytes) => {
            let _ = cache_host_file_bytes(&app, &path, &bytes);
            Ok(bytes)
        }
        Err(error) => read_cached_host_file(&app, &path)
            .map_err(|cache_error| format!("{error} {cache_error}")),
    }
}

#[tauri::command]
fn sync_open_host_file(
    app: tauri::AppHandle,
    path: String,
    name: String,
) -> Result<String, String> {
    let config = load_sync_config(&app)?;
    if config.mode != "client" {
        return Err("This computer is not configured as a BuildBook client.".to_string());
    }
    let bytes = host_file_bytes(&config, &path)?;
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data folder: {error}"))?;
    let cache_dir = app_dir
        .join("sync-cache")
        .join("files")
        .join(&sha256_hex(&path)[..24]);
    std::fs::create_dir_all(&cache_dir)
        .map_err(|error| format!("Could not create client file cache: {error}"))?;
    let fallback_name = std::path::Path::new(&path)
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "host-file".to_string());
    let target = cache_dir.join(safe_file_name(if name.trim().is_empty() {
        &fallback_name
    } else {
        &name
    }));
    std::fs::write(&target, bytes)
        .map_err(|error| format!("Could not cache host file: {error}"))?;
    open_file_path(target.to_string_lossy().to_string())?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
fn sync_prepare_host_edit_file(
    app: tauri::AppHandle,
    path: String,
    name: String,
    library: String,
) -> Result<PreparedEditFile, String> {
    let config = load_sync_config(&app)?;
    if config.mode != "client" {
        return Err("This computer is not configured as a BuildBook client.".to_string());
    }
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data folder: {error}"))?;
    let target_dir = app_dir
        .join("sync-cache")
        .join("working")
        .join(safe_library_path(&library));
    let target = editable_target_path(&target_dir, &name)?;
    let metadata_path = target.with_file_name(format!(
        "{}.buildbook-sync.json",
        target
            .file_name()
            .map(|value| value.to_string_lossy())
            .unwrap_or_default()
    ));
    let saved_base_hash = std::fs::read_to_string(&metadata_path)
        .ok()
        .and_then(|contents| serde_json::from_str::<serde_json::Value>(&contents).ok())
        .and_then(|value| {
            value
                .get("baseHash")
                .and_then(|hash| hash.as_str())
                .map(str::to_string)
        })
        .unwrap_or_default();
    if target.is_file() && !saved_base_hash.is_empty() {
        if let Ok(existing) = std::fs::read(&target) {
            if sha256_bytes(&existing) != saved_base_hash {
                return Ok(PreparedEditFile {
                    name,
                    path: target.to_string_lossy().to_string(),
                    size: existing.len() as u64,
                    base_hash: saved_base_hash,
                    pending: true,
                });
            }
        }
    }
    let bytes = match host_file_bytes(&config, &path) {
        Ok(bytes) => bytes,
        Err(_error) if target.is_file() => {
            let existing = std::fs::read(&target)
                .map_err(|error| format!("Could not read the cached working copy: {error}"))?;
            return Ok(PreparedEditFile {
                name,
                path: target.to_string_lossy().to_string(),
                size: existing.len() as u64,
                base_hash: if saved_base_hash.is_empty() {
                    sha256_bytes(&existing)
                } else {
                    saved_base_hash
                },
                pending: false,
            });
        }
        Err(error) => return Err(format!("{error} No cached working copy is available.")),
    };
    let base_hash = sha256_bytes(&bytes);
    std::fs::write(&target, &bytes)
        .map_err(|error| format!("Could not prepare the host file for editing: {error}"))?;
    std::fs::write(
        &metadata_path,
        serde_json::json!({ "baseHash": base_hash, "hostPath": path }).to_string(),
    )
    .map_err(|error| format!("Could not save the working copy baseline: {error}"))?;
    Ok(PreparedEditFile {
        name,
        path: target.to_string_lossy().to_string(),
        size: bytes.len() as u64,
        base_hash,
        pending: false,
    })
}

#[tauri::command]
fn sync_save_host_file(
    app: tauri::AppHandle,
    name: String,
    library: String,
    bytes: Vec<u8>,
) -> Result<StoredFile, String> {
    let config = load_sync_config(&app)?;
    if config.mode != "client" {
        return Err("This computer is not configured as a BuildBook client.".to_string());
    }
    let mut endpoint = host_file_endpoint(&config)?;
    endpoint
        .query_pairs_mut()
        .append_pair("name", &name)
        .append_pair("library", &library);
    append_host_file_auth(&mut endpoint, &config);
    let response = host_request_client()?
        .post(endpoint)
        .header("X-BuildBook-Request", "1")
        .header(auth_header_name(&config), client_auth_header(&config))
        .body(bytes)
        .send()
        .map_err(|error| format!("Could not upload file to the BuildBook host: {error}"))?;
    parse_host_stored_file(response)
}

#[tauri::command]
fn sync_overwrite_host_file(
    app: tauri::AppHandle,
    path: String,
    bytes: Vec<u8>,
) -> Result<StoredFile, String> {
    let config = load_sync_config(&app)?;
    if config.mode != "client" {
        return Err("This computer is not configured as a BuildBook client.".to_string());
    }
    let mut endpoint = host_file_endpoint(&config)?;
    endpoint.query_pairs_mut().append_pair("path", &path);
    append_host_file_auth(&mut endpoint, &config);
    let response = host_request_client()?
        .put(endpoint)
        .header("X-BuildBook-Request", "1")
        .header(auth_header_name(&config), client_auth_header(&config))
        .body(bytes)
        .send()
        .map_err(|error| format!("Could not update file on the BuildBook host: {error}"))?;
    parse_host_stored_file(response)
}

#[tauri::command]
fn sync_download_url_to_host(
    app: tauri::AppHandle,
    url: String,
    library: String,
    name: String,
) -> Result<StoredFile, String> {
    let config = load_sync_config(&app)?;
    if config.mode != "client" {
        return Err("This computer is not configured as a BuildBook client.".to_string());
    }
    let host_url = normalized_host_url(&config.host_url)?;
    let mut endpoint = reqwest::Url::parse(&format!("{host_url}/api/download-url"))
        .map_err(|error| format!("Could not create host download address: {error}"))?;
    endpoint
        .query_pairs_mut()
        .append_pair("url", &url)
        .append_pair("library", &library)
        .append_pair("name", &name);
    append_host_file_auth(&mut endpoint, &config);
    let response = host_request_client()?
        .post(endpoint)
        .header("X-BuildBook-Request", "1")
        .header(auth_header_name(&config), client_auth_header(&config))
        .send()
        .map_err(|error| {
            format!("Could not ask the BuildBook host to download the file: {error}")
        })?;
    parse_host_stored_file(response)
}

#[tauri::command]
fn sync_delete_host_files(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<DeleteManagedFilesResult, String> {
    let config = load_sync_config(&app)?;
    if config.mode != "client" {
        return Err("This computer is not configured as a BuildBook client.".to_string());
    }
    let mut endpoint = host_file_endpoint(&config)?;
    append_host_file_auth(&mut endpoint, &config);
    let response = host_request_client()?
        .delete(endpoint)
        .header("X-BuildBook-Request", "1")
        .header(auth_header_name(&config), client_auth_header(&config))
        .json(&paths)
        .send()
        .map_err(|error| format!("Could not delete files from the BuildBook host: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        let message = response.text().unwrap_or_default();
        return Err(compact_host_error(status, message, "while deleting files"));
    }
    response
        .json::<DeleteManagedFilesResult>()
        .map_err(|error| format!("Could not read the host delete response: {error}"))
}

#[tauri::command]
fn sync_file_checkout(
    app: tauri::AppHandle,
    path: String,
    action: String,
) -> Result<FileCheckoutResult, String> {
    let config = load_sync_config(&app)?;
    let request = FileCheckoutRequest {
        action,
        path,
        device_id: config.device_id.clone(),
        device_name: config.device_name.clone(),
    };
    if config.mode != "client" {
        return apply_file_checkout(request);
    }
    let host_url = normalized_host_url(&config.host_url)?;
    let mut endpoint = reqwest::Url::parse(&format!("{host_url}/api/sync/checkout"))
        .map_err(|error| format!("Could not create host checkout address: {error}"))?;
    append_host_file_auth(&mut endpoint, &config);
    let response = host_request_client()?
        .post(endpoint)
        .header("X-BuildBook-Request", "1")
        .header(auth_header_name(&config), client_auth_header(&config))
        .json(&request)
        .send();
    let response = match response {
        Ok(response) => response,
        Err(error) => {
            return Ok(FileCheckoutResult {
                acquired: true,
                offline: true,
                lease: None,
                message: format!("Host is offline. Editing the cached copy: {error}"),
            });
        }
    };
    let status = response.status();
    if !status.is_success() {
        let message = response.text().unwrap_or_default();
        return Err(compact_host_error(status, message, "for file checkout"));
    }
    response
        .json::<FileCheckoutResult>()
        .map_err(|error| format!("Could not read the host checkout response: {error}"))
}

fn host_info(app: &tauri::AppHandle, url: String) -> BuildBookHostInfo {
    let config = load_sync_config(app).unwrap_or_default();
    BuildBookHostInfo {
        product: "BuildBook".to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        protocol_version: HOST_SYNC_PROTOCOL.to_string(),
        device_id: config.device_id,
        device_name: config.device_name,
        url,
        hosting_enabled: config.mode == "host",
    }
}

#[tauri::command]
fn probe_buildbook_host(url: String, token: String) -> Result<BuildBookHostInfo, String> {
    let host_url = normalized_host_url(&url)?;
    let endpoint = format!("{host_url}/api/host-info");
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|error| format!("Could not prepare host connection: {error}"))?;
    let mut request = client.get(endpoint).header("X-BuildBook-Request", "1");
    if !token.trim().is_empty() {
        request = request.header("X-BuildBook-Token", token.trim());
    }
    let response = request
        .send()
        .map_err(|error| format!("Could not reach BuildBook host: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("BuildBook host returned {}.", response.status()));
    }
    let mut info = response
        .json::<BuildBookHostInfo>()
        .map_err(|error| format!("Host response was not valid BuildBook data: {error}"))?;
    info.url = host_url;
    if info.product != "BuildBook" {
        return Err("The address is not a BuildBook host.".to_string());
    }
    Ok(info)
}

#[tauri::command]
fn generate_sync_pairing_code(app: tauri::AppHandle) -> Result<SyncConfig, String> {
    let mut config = load_sync_config(&app)?;
    if config.mode != "host" {
        return Err(
            "Make this computer the BuildBook host before generating a pairing code.".to_string(),
        );
    }
    let secret = generated_secret("pairing-code");
    let digits = u32::from_str_radix(&secret[..8], 16).unwrap_or(0) % 100_000_000;
    config.pairing_code = format!("{digits:08}");
    config.pairing_code_expires_at = now_seconds() + 10 * 60;
    config.pairing_failed_attempts = 0;
    config.pairing_locked_until = 0;
    save_sync_config(&app, &config)?;
    Ok(config)
}

#[tauri::command]
fn revoke_paired_device(app: tauri::AppHandle, device_id: String) -> Result<SyncConfig, String> {
    let mut config = load_sync_config(&app)?;
    for device in &mut config.paired_devices {
        if device.device_id == device_id {
            device.revoked = true;
        }
    }
    save_sync_config(&app, &config)?;
    Ok(config)
}

#[tauri::command]
fn sync_status_dashboard(app: tauri::AppHandle) -> Result<SyncStatusDashboard, String> {
    let config = load_sync_config(&app)?;
    let (cache_file_count, cache_bytes) = sync_cache_stats(&app);
    Ok(SyncStatusDashboard {
        mode: config.mode,
        device_id: config.device_id,
        device_name: config.device_name,
        host_url: config.host_url,
        host_revision: config.host_revision,
        pending_sync: config.pending_sync,
        last_connected_at: config.last_connected_at,
        last_sync_error: config.last_sync_error,
        pairing_code_expires_at: config.pairing_code_expires_at,
        pairing_locked_until: config.pairing_locked_until,
        paired_devices: config.paired_devices,
        active_checkouts: active_file_checkouts(),
        cache_file_count,
        cache_bytes,
    })
}

#[tauri::command]
fn pair_buildbook_host(
    app: tauri::AppHandle,
    url: String,
    pairing_code: String,
) -> Result<PairDeviceResponse, String> {
    let config = load_sync_config(&app)?;
    let host_url = normalized_host_url(&url)?;
    let endpoint = format!("{host_url}/api/sync/pair");
    let request = PairDeviceRequest {
        pairing_code,
        device_id: config.device_id,
        device_name: config.device_name,
    };
    let response = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|error| format!("Could not prepare host pairing: {error}"))?
        .post(endpoint)
        .header("X-BuildBook-Request", "1")
        .json(&request)
        .send()
        .map_err(|error| format!("Could not reach BuildBook host for pairing: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        let message = response.text().unwrap_or_default();
        return Err(compact_host_error(status, message, "while pairing"));
    }
    let mut paired = response
        .json::<PairDeviceResponse>()
        .map_err(|error| format!("Host pairing response was invalid: {error}"))?;
    paired.host.url = host_url;
    Ok(paired)
}

fn tcp_discover_host(address: std::net::SocketAddr, port: u16) -> Option<BuildBookHostInfo> {
    let mut stream =
        TcpStream::connect_timeout(&address, std::time::Duration::from_millis(180)).ok()?;
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_millis(350)));
    let request = format!(
        "GET /api/discovery HTTP/1.1\r\nHost: {}:{port}\r\nX-BuildBook-Request: 1\r\nConnection: close\r\n\r\n",
        address.ip()
    );
    stream.write_all(request.as_bytes()).ok()?;
    let mut response = Vec::new();
    stream.read_to_end(&mut response).ok()?;
    let header_end = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")?
        + 4;
    let headers = String::from_utf8_lossy(&response[..header_end]);
    if !headers.starts_with("HTTP/1.1 200") {
        return None;
    }
    let mut info = serde_json::from_slice::<BuildBookHostInfo>(&response[header_end..]).ok()?;
    info.url = format!("http://{}:{port}", address.ip());
    (info.product == "BuildBook" && info.hosting_enabled).then_some(info)
}

fn scan_local_subnet_for_hosts(port: u16) -> Vec<BuildBookHostInfo> {
    let local_ip = local_lan_ip().parse::<std::net::Ipv4Addr>().ok();
    let Some(local_ip) = local_ip else {
        return Vec::new();
    };
    if local_ip.is_loopback() {
        return Vec::new();
    }
    let octets = local_ip.octets();
    let next_host = Arc::new(std::sync::atomic::AtomicUsize::new(1));
    let results = Arc::new(Mutex::new(Vec::<BuildBookHostInfo>::new()));
    let workers = (0..24)
        .map(|_| {
            let next_host = next_host.clone();
            let results = results.clone();
            std::thread::spawn(move || loop {
                let host = next_host.fetch_add(1, Ordering::Relaxed);
                if host >= 255 {
                    break;
                }
                let candidate =
                    std::net::Ipv4Addr::new(octets[0], octets[1], octets[2], host as u8);
                if candidate == local_ip {
                    continue;
                }
                let address = std::net::SocketAddr::new(std::net::IpAddr::V4(candidate), port);
                if let Some(info) = tcp_discover_host(address, port) {
                    if let Ok(mut found) = results.lock() {
                        if !found.iter().any(|item| item.device_id == info.device_id) {
                            found.push(info);
                        }
                    }
                }
            })
        })
        .collect::<Vec<_>>();
    for worker in workers {
        let _ = worker.join();
    }
    results
        .lock()
        .map(|items| items.clone())
        .unwrap_or_default()
}

#[tauri::command]
fn discover_buildbook_hosts(app: tauri::AppHandle, port: u16) -> Result<Vec<BuildBookHostInfo>, String> {
    let local_device_id = load_sync_config(&app)
        .map(|config| config.device_id)
        .unwrap_or_default();
    let socket = UdpSocket::bind(("0.0.0.0", 0))
        .map_err(|error| format!("Could not start host discovery: {error}"))?;
    socket
        .set_broadcast(true)
        .map_err(|error| format!("Could not enable host discovery: {error}"))?;
    socket
        .set_read_timeout(Some(std::time::Duration::from_millis(900)))
        .map_err(|error| format!("Could not configure host discovery: {error}"))?;
    let _ = socket.send_to(DISCOVERY_REQUEST, ("255.255.255.255", port));
    if let Ok(local_ip) = local_lan_ip().parse::<std::net::Ipv4Addr>() {
        let octets = local_ip.octets();
        let directed_broadcast = std::net::Ipv4Addr::new(octets[0], octets[1], octets[2], 255);
        let _ = socket.send_to(DISCOVERY_REQUEST, (directed_broadcast, port));
    }

    let started = std::time::Instant::now();
    let mut results = Vec::new();
    while started.elapsed() < std::time::Duration::from_millis(1000) {
        let mut buffer = [0u8; 4096];
        match socket.recv_from(&mut buffer) {
            Ok((count, _)) => {
                if let Ok(info) = serde_json::from_slice::<BuildBookHostInfo>(&buffer[..count]) {
                    if info.product == "BuildBook"
                        && info.device_id != local_device_id
                        && !results
                            .iter()
                            .any(|item: &BuildBookHostInfo| item.device_id == info.device_id)
                    {
                        results.push(info);
                    }
                }
            }
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                break
            }
            Err(error) => return Err(format!("Host discovery failed: {error}")),
        }
    }
    for info in scan_local_subnet_for_hosts(port) {
        if info.device_id != local_device_id
            && !results.iter().any(|item| item.device_id == info.device_id)
        {
            results.push(info);
        }
    }
    Ok(results)
}

fn safe_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            value if value.is_control() => '_',
            value => value,
        })
        .collect();

    if cleaned.trim().is_empty() {
        "attached-file".to_string()
    } else {
        cleaned
    }
}

#[cfg(target_os = "windows")]
fn bitmap_to_bmp_bytes(bitmap: windows::Win32::Graphics::Gdi::HBITMAP) -> Result<Vec<u8>, String> {
    use std::mem::{size_of, zeroed};
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    };

    unsafe {
        let mut bitmap_info: BITMAP = zeroed();
        let object_size = GetObjectW(
            bitmap.into(),
            size_of::<BITMAP>() as i32,
            Some(&mut bitmap_info as *mut _ as *mut _),
        );
        if object_size == 0 {
            let _ = DeleteObject(bitmap.into());
            return Err("Could not read shell thumbnail bitmap.".to_string());
        }

        let width = bitmap_info.bmWidth;
        let height = bitmap_info.bmHeight.abs();
        let stride = (((width * 32 + 31) / 32) * 4) as usize;
        let image_size = stride * height as usize;
        let mut pixels = vec![0u8; image_size];
        let mut dib = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                biSizeImage: image_size as u32,
                ..zeroed()
            },
            ..zeroed()
        };

        let hdc = CreateCompatibleDC(None);
        if hdc.is_invalid() {
            let _ = DeleteObject(bitmap.into());
            return Err("Could not create a bitmap extraction context.".to_string());
        }

        let scan_lines = GetDIBits(
            hdc,
            bitmap,
            0,
            height as u32,
            Some(pixels.as_mut_ptr() as *mut _),
            &mut dib,
            DIB_RGB_COLORS,
        );
        let _ = DeleteDC(hdc);
        let _ = DeleteObject(bitmap.into());
        if scan_lines == 0 {
            return Err("Could not extract shell thumbnail pixels.".to_string());
        }

        let file_header_size = 14usize;
        let info_header_size = 40usize;
        let pixel_offset = file_header_size + info_header_size;
        let file_size = pixel_offset + pixels.len();
        let mut bytes = Vec::with_capacity(file_size);
        bytes.extend_from_slice(b"BM");
        bytes.extend_from_slice(&(file_size as u32).to_le_bytes());
        bytes.extend_from_slice(&[0, 0, 0, 0]);
        bytes.extend_from_slice(&(pixel_offset as u32).to_le_bytes());
        bytes.extend_from_slice(&(info_header_size as u32).to_le_bytes());
        bytes.extend_from_slice(&width.to_le_bytes());
        bytes.extend_from_slice(&(-height).to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&32u16.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(&(pixels.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&0i32.to_le_bytes());
        bytes.extend_from_slice(&0i32.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(&pixels);
        Ok(bytes)
    }
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn shell_thumbnail_bytes(path: String, size: u32) -> Result<Vec<u8>, String> {
    let target = std::path::PathBuf::from(path.trim_matches('"'));
    if !target.is_file() {
        return Err("That file path does not point to a readable file.".to_string());
    }

    std::thread::spawn(move || shell_thumbnail_bytes_sta(target, size))
        .join()
        .map_err(|_| "Windows thumbnail worker failed.".to_string())?
}

#[cfg(target_os = "windows")]
fn shell_thumbnail_bytes_sta(target: std::path::PathBuf, size: u32) -> Result<Vec<u8>, String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::SIZE;
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{
        IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK,
    };

    let wide: Vec<u16> = OsStr::new(&target)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let size = size.clamp(64, 1024) as i32;

    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|error| format!("Windows thumbnail COM setup failed: {error}"))?;
        let factory: IShellItemImageFactory =
            SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None)
                .map_err(|error| format!("Windows could not load a shell thumbnail: {error}"))?;
        let bitmap = factory
            .GetImage(SIZE { cx: size, cy: size }, SIIGBF_BIGGERSIZEOK)
            .map_err(|error| format!("Windows could not create a shell thumbnail: {error}"))?;
        let result = bitmap_to_bmp_bytes(bitmap);
        CoUninitialize();
        result
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn shell_thumbnail_bytes(_path: String, _size: u32) -> Result<Vec<u8>, String> {
    Err("Shell thumbnails are only available on Windows.".to_string())
}

fn safe_library_path(library: &str) -> std::path::PathBuf {
    library
        .split(['/', '\\'])
        .map(safe_file_name)
        .filter(|part| !part.trim().is_empty())
        .fold(std::path::PathBuf::new(), |path, part| path.join(part))
}

fn file_stem(name: &str) -> String {
    std::path::Path::new(name)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(safe_file_name)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "sketch".to_string())
}

fn upload_target_path(
    target_dir: &std::path::Path,
    original_name: &str,
) -> Result<std::path::PathBuf, String> {
    let safe_name = safe_file_name(original_name);
    let is_arduino_sketch = safe_name.to_lowercase().ends_with(".ino");

    if is_arduino_sketch {
        let sketch_name = file_stem(&safe_name);
        let sketch_dir = target_dir.join(&sketch_name);
        let sketch_file = sketch_dir.join(&safe_name);

        if !sketch_file.exists() {
            std::fs::create_dir_all(&sketch_dir)
                .map_err(|error| format!("Could not create Arduino sketch folder: {error}"))?;
            return Ok(sketch_file);
        }

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|error| format!("Could not create timestamp: {error}"))?
            .as_millis();
        let unique_sketch_name = format!("{sketch_name}-{timestamp}");
        let unique_dir = target_dir.join(&unique_sketch_name);
        std::fs::create_dir_all(&unique_dir)
            .map_err(|error| format!("Could not create Arduino sketch folder: {error}"))?;
        return Ok(unique_dir.join(format!("{unique_sketch_name}.ino")));
    }

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| format!("Could not create timestamp: {error}"))?
        .as_millis();
    Ok(target_dir.join(format!("{timestamp}-{safe_name}")))
}

fn editable_target_path(
    target_dir: &std::path::Path,
    original_name: &str,
) -> Result<std::path::PathBuf, String> {
    let safe_name = safe_file_name(original_name);

    if safe_name.to_lowercase().ends_with(".ino") {
        let sketch_name = file_stem(&safe_name);
        let sketch_dir = target_dir.join(&sketch_name);
        std::fs::create_dir_all(&sketch_dir)
            .map_err(|error| format!("Could not create Arduino sketch folder: {error}"))?;
        return Ok(sketch_dir.join(&safe_name));
    }

    std::fs::create_dir_all(target_dir)
        .map_err(|error| format!("Could not create edit folder: {error}"))?;
    Ok(target_dir.join(safe_name))
}

#[tauri::command]
fn attach_local_file(
    app: tauri::AppHandle,
    source_path: String,
    library: String,
) -> Result<StoredFile, String> {
    let source = std::path::PathBuf::from(source_path.trim_matches('"'));

    if !source.is_file() {
        return Err("That file path does not point to a readable file.".to_string());
    }

    let original_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Could not read the file name.".to_string())?;

    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data folder: {error}"))?;
    let target_dir = app_dir.join("uploads").join(safe_library_path(&library));
    std::fs::create_dir_all(&target_dir)
        .map_err(|error| format!("Could not create upload folder: {error}"))?;

    let target = upload_target_path(&target_dir, original_name)?;

    std::fs::copy(&source, &target).map_err(|error| format!("Could not copy file: {error}"))?;
    let size = target
        .metadata()
        .map_err(|error| format!("Could not read copied file metadata: {error}"))?
        .len();

    Ok(StoredFile {
        name: original_name.to_string(),
        path: target.to_string_lossy().to_string(),
        size,
    })
}

#[tauri::command]
fn save_uploaded_file(
    app: tauri::AppHandle,
    name: String,
    library: String,
    bytes: Vec<u8>,
) -> Result<StoredFile, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data folder: {error}"))?;
    let target_dir = app_dir.join("uploads").join(safe_library_path(&library));
    std::fs::create_dir_all(&target_dir)
        .map_err(|error| format!("Could not create upload folder: {error}"))?;

    let target = upload_target_path(&target_dir, &name)?;

    std::fs::write(&target, &bytes).map_err(|error| format!("Could not save file: {error}"))?;

    Ok(StoredFile {
        name,
        path: target.to_string_lossy().to_string(),
        size: bytes.len() as u64,
    })
}

#[tauri::command]
fn overwrite_file_bytes(
    app: tauri::AppHandle,
    path: String,
    bytes: Vec<u8>,
) -> Result<StoredFile, String> {
    let roots = storage_roots(&app)?;
    let target = canonical_under_roots(&path, &roots).ok_or_else(|| {
        "Only BuildBook-managed files can be updated from this action.".to_string()
    })?;

    if !target.is_file() {
        return Err("The saved file could not be found.".to_string());
    }

    std::fs::write(&target, &bytes).map_err(|error| format!("Could not update file: {error}"))?;
    let name = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("updated-file")
        .to_string();

    Ok(StoredFile {
        name,
        path: target.to_string_lossy().to_string(),
        size: bytes.len() as u64,
    })
}

fn lan_mutex() -> &'static Mutex<Option<LanServerHandle>> {
    LAN_SERVER.get_or_init(|| Mutex::new(None))
}

fn local_lan_ip() -> String {
    std::net::UdpSocket::bind("0.0.0.0:0")
        .and_then(|socket| {
            let _ = socket.connect("8.8.8.8:80");
            socket.local_addr()
        })
        .map(|addr| addr.ip().to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string())
}

fn decode_url_value(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(hex) = u8::from_str_radix(&value[index + 1..index + 3], 16) {
                output.push(hex);
                index += 3;
                continue;
            }
        }
        output.push(if bytes[index] == b'+' {
            b' '
        } else {
            bytes[index]
        });
        index += 1;
    }
    String::from_utf8_lossy(&output).to_string()
}

fn query_value(path: &str, key: &str) -> String {
    path.split_once('?')
        .map(|(_, query)| query)
        .unwrap_or("")
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .find(|(name, _)| *name == key)
        .map(|(_, value)| decode_url_value(value))
        .unwrap_or_default()
}

fn header_value(headers: &str, key: &str) -> String {
    let prefix = format!("{}:", key.to_lowercase());
    headers
        .lines()
        .find_map(|line| {
            let lower = line.to_lowercase();
            if lower.starts_with(&prefix) {
                line.split_once(':')
                    .map(|(_, value)| value.trim().to_string())
            } else {
                None
            }
        })
        .unwrap_or_default()
}

fn cookie_value(headers: &str, key: &str) -> String {
    header_value(headers, "cookie")
        .split(';')
        .filter_map(|part| part.trim().split_once('='))
        .find(|(name, _)| *name == key)
        .map(|(_, value)| value.trim().to_string())
        .unwrap_or_default()
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push_str(&format!("{byte:02x}"));
    }
    output
}

fn sha256_hex(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    hex_encode(&hasher.finalize())
}

fn password_hash(password: &str, auth: &WebAuthConfig) -> String {
    if auth.password_algorithm.as_deref() == Some("pbkdf2-sha256") {
        let iterations = auth
            .password_iterations
            .unwrap_or(210_000)
            .clamp(100_000, 1_000_000);
        let mut output = [0u8; 32];
        pbkdf2_hmac::<Sha256>(
            password.as_bytes(),
            auth.password_salt.as_bytes(),
            iterations,
            &mut output,
        );
        return hex_encode(&output);
    }
    sha256_hex(&format!("{}\0{password}", auth.password_salt))
}

fn now_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn host_without_port(headers: &str) -> String {
    let host = header_value(headers, "host").to_lowercase();
    if host.starts_with('[') {
        return host
            .trim_start_matches('[')
            .split(']')
            .next()
            .unwrap_or("")
            .to_string();
    }
    host.split(':').next().unwrap_or("").to_string()
}

fn host_is_local_or_private(headers: &str) -> bool {
    let host = host_without_port(headers);
    if host.is_empty() || host == "localhost" || host.ends_with(".localhost") {
        return true;
    }
    let parts = host
        .split('.')
        .filter_map(|part| part.parse::<u8>().ok())
        .collect::<Vec<_>>();
    if parts.len() == 4 {
        return parts[0] == 10
            || parts[0] == 127
            || (parts[0] == 192 && parts[1] == 168)
            || (parts[0] == 172 && (16..=31).contains(&parts[1]))
            || (parts[0] == 100 && (64..=127).contains(&parts[1]));
    }
    false
}

fn host_matches_allowed_entry(host: &str, entry: &str) -> bool {
    let clean = entry
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .split('/')
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .to_lowercase();
    if clean.is_empty() {
        return false;
    }
    if let Some(suffix) = clean.strip_prefix("*.") {
        return host.ends_with(&format!(".{suffix}"));
    }
    host == clean
}

fn host_is_allowed(auth: &WebAuthConfig, headers: &str) -> bool {
    if !auth.enabled || host_is_local_or_private(headers) {
        return true;
    }
    let allowed = auth.allowed_hosts.as_deref().unwrap_or("").trim();
    if allowed.is_empty() {
        return true;
    }
    let host = host_without_port(headers);
    allowed
        .split([',', '\n', '\r', ';'])
        .any(|entry| host_matches_allowed_entry(&host, entry))
}

fn request_is_https(headers: &str) -> bool {
    header_value(headers, "x-forwarded-proto")
        .split(',')
        .any(|value| value.trim().eq_ignore_ascii_case("https"))
        || header_value(headers, "forwarded")
            .to_lowercase()
            .split(';')
            .any(|value| value.trim() == "proto=https")
}

fn request_has_app_header(headers: &str) -> bool {
    header_value(headers, "x-buildbook-request") == "1"
        || !header_value(headers, "x-buildbook-token").is_empty()
}

fn method_requires_csrf_header(method: &str) -> bool {
    !matches!(method, "GET" | "HEAD" | "OPTIONS")
}

fn session_signature(auth: &WebAuthConfig, expires: u64) -> String {
    sha256_hex(&format!(
        "{}\0{}\0{}\0{}",
        auth.session_secret, auth.username, auth.password_hash, expires
    ))
}

fn web_auth_requires_login(auth: &WebAuthConfig, headers: &str) -> bool {
    if !auth.enabled {
        return false;
    }
    if auth.password_hash.is_empty()
        || auth.password_salt.is_empty()
        || auth.session_secret.is_empty()
    {
        return true;
    }
    auth.scope == "all" || !host_is_local_or_private(headers)
}

fn request_has_web_session(auth: &WebAuthConfig, headers: &str) -> bool {
    let value = cookie_value(headers, "buildbook_session");
    let Some((expires_text, signature)) = value.split_once('.') else {
        return false;
    };
    let Ok(expires) = expires_text.parse::<u64>() else {
        return false;
    };
    expires > now_seconds() && signature == session_signature(auth, expires)
}

fn request_auth_error(method: &str, path: &str, headers: &str) -> Option<&'static str> {
    let (expected, require_token, web_auth) = lan_mutex()
        .lock()
        .ok()
        .and_then(|guard| {
            guard.as_ref().map(|server| {
                (
                    server.token.clone(),
                    server.require_token,
                    server.web_auth.clone(),
                )
            })
        })
        .unwrap_or_else(|| (String::new(), true, WebAuthConfig::default()));
    if !host_is_allowed(&web_auth, headers) {
        return Some("BuildBook host is not allowed.");
    }
    let token_matches = !expected.is_empty()
        && (query_value(path, "access") == expected
            || header_value(headers, "X-BuildBook-Token") == expected);
    if require_token {
        if expected.is_empty() {
            return Some("BuildBook access code is required.");
        }
        if !token_matches {
            return Some("BuildBook access code is required.");
        }
    }
    let device_id = query_value(path, "device");
    if token_matches && !device_id.trim().is_empty() {
        return None;
    }
    if web_auth_requires_login(&web_auth, headers) {
        if !request_has_web_session(&web_auth, headers) {
            return Some("BuildBook login is required.");
        }
        if method_requires_csrf_header(method) && !request_has_app_header(headers) {
            return Some("BuildBook request header is required.");
        }
    }
    None
}

fn paired_device_auth_error(
    app: &tauri::AppHandle,
    path: &str,
    headers: &str,
) -> Option<&'static str> {
    let device_id = query_value(path, "device");
    let token = {
        let header = header_value(headers, "X-BuildBook-Device-Token");
        if header.is_empty() {
            query_value(path, "deviceToken")
        } else {
            header
        }
    };
    if device_id.trim().is_empty() || token.trim().is_empty() {
        return Some("BuildBook paired device credential is required.");
    }
    let mut config = load_sync_config(app).unwrap_or_default();
    let expected_hash = sha256_hex(token.trim());
    let now = now_seconds();
    let mut changed = false;
    for device in &mut config.paired_devices {
        if device.device_id == device_id && !device.revoked && device.token_hash == expected_hash {
            if now.saturating_sub(device.last_seen_at) > 60 {
                device.last_seen_at = now;
                changed = true;
            }
            if changed {
                let _ = save_sync_config(app, &config);
            }
            return None;
        }
    }
    Some("BuildBook paired device is not approved.")
}

fn request_sync_auth_error(
    app: &tauri::AppHandle,
    path: &str,
    headers: &str,
) -> Option<&'static str> {
    if paired_device_auth_error(app, path, headers).is_none() {
        return None;
    }
    let config = load_sync_config(app).unwrap_or_default();
    if config.paired_devices.iter().any(|device| !device.revoked) {
        return Some("BuildBook paired device is not approved.");
    }
    request_token_error(path, headers)
}

fn request_file_auth_error(
    app: &tauri::AppHandle,
    method: &str,
    path: &str,
    headers: &str,
) -> Option<&'static str> {
    if !query_value(path, "deviceToken").trim().is_empty()
        || !header_value(headers, "X-BuildBook-Device-Token").trim().is_empty()
    {
        return paired_device_auth_error(app, path, headers);
    }
    if paired_device_auth_error(app, path, headers).is_none() {
        return None;
    }
    request_auth_error(method, path, headers)
}

fn request_token_error(path: &str, headers: &str) -> Option<&'static str> {
    let (expected, require_token) = lan_mutex()
        .lock()
        .ok()
        .and_then(|guard| {
            guard
                .as_ref()
                .map(|server| (server.token.clone(), server.require_token))
        })
        .unwrap_or_else(|| (String::new(), true));
    if !require_token {
        return None;
    }
    if expected.is_empty() {
        return Some("BuildBook access code is required.");
    }
    if query_value(path, "access") != expected
        && header_value(headers, "X-BuildBook-Token") != expected
    {
        return Some("BuildBook access code is required.");
    }
    None
}

fn validate_public_web_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim().to_string();
    let lower = trimmed.to_lowercase();
    let remainder = lower
        .strip_prefix("https://")
        .or_else(|| lower.strip_prefix("http://"))
        .ok_or_else(|| "Paste a public http or https product link.".to_string())?;
    let host_port = remainder
        .split('/')
        .next()
        .unwrap_or("")
        .rsplit('@')
        .next()
        .unwrap_or("");
    let host = host_port.split(':').next().unwrap_or("");
    let blocked = host.is_empty()
        || host == "localhost"
        || host.starts_with("127.")
        || host.starts_with("10.")
        || host.starts_with("192.168.")
        || host == "0.0.0.0"
        || host.starts_with('[')
        || host
            .split('.')
            .take(2)
            .collect::<Vec<&str>>()
            .as_slice()
            .get(0)
            .and_then(|value| value.parse::<u8>().ok())
            .filter(|first| *first == 172)
            .is_some_and(|_| {
                host.split('.')
                    .nth(1)
                    .and_then(|value| value.parse::<u8>().ok())
                    .is_some_and(|second| (16..=31).contains(&second))
            });
    if blocked {
        return Err("Only public product web links can be read.".to_string());
    }
    Ok(trimmed)
}

fn content_type(path: &str) -> &'static str {
    if path.ends_with(".js") {
        "text/javascript; charset=utf-8"
    } else if path.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if path.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if path.ends_with(".svg") {
        "image/svg+xml"
    } else if path.ends_with(".png") {
        "image/png"
    } else if path.ends_with(".ico") {
        "image/x-icon"
    } else if path.ends_with(".pdf") {
        "application/pdf"
    } else {
        "application/octet-stream"
    }
}

fn send_response(stream: &mut TcpStream, status: &str, content_type: &str, body: &[u8]) {
    send_response_with_headers(stream, status, content_type, body, &[]);
}

fn send_response_with_headers(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
    headers: &[String],
) {
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    );
    let _ = write!(stream, "X-Content-Type-Options: nosniff\r\n");
    let _ = write!(stream, "X-Frame-Options: DENY\r\n");
    let _ = write!(stream, "Referrer-Policy: no-referrer\r\n");
    let _ = write!(
        stream,
        "Permissions-Policy: camera=(), microphone=(), geolocation=()\r\n"
    );
    for header in headers {
        let _ = write!(stream, "{header}\r\n");
    }
    let _ = write!(stream, "\r\n");
    let _ = stream.write_all(body);
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebLoginRequest {
    username: String,
    password: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WebAuthStatus {
    login_enabled: bool,
    login_required: bool,
    authenticated: bool,
    username: String,
}

fn find_index_html(root: &std::path::Path, depth: usize) -> Option<std::path::PathBuf> {
    let direct = root.join("index.html");
    if direct.is_file() {
        return Some(root.to_path_buf());
    }
    if depth == 0 {
        return None;
    }
    let entries = std::fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if let Some(found) = find_index_html(&path, depth - 1) {
            return Some(found);
        }
    }
    None
}

fn dist_dir(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let resource_root = app.path().resource_dir().ok();
    let resource_dist = resource_root.as_ref().map(|path| path.join("dist"));
    let current_dist = std::env::current_dir().ok().map(|path| path.join("dist"));
    let parent_dist = std::env::current_dir()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.join("dist")));
    let executable_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()));
    let executable_dist = executable_dir.as_ref().map(|path| path.join("dist"));
    let recursive_resource = resource_root
        .as_ref()
        .and_then(|path| find_index_html(path, 4));
    [
        resource_root,
        resource_dist,
        current_dist,
        parent_dist,
        executable_dir,
        executable_dist,
        recursive_resource,
    ]
    .into_iter()
    .flatten()
    .find(|path| path.join("index.html").is_file())
}

fn body_from_request(
    stream: &mut TcpStream,
    initial: &[u8],
    headers: &str,
) -> Result<Vec<u8>, String> {
    let length_header = header_value(headers, "content-length");
    let length = length_header
        .is_empty()
        .then(|| Err("Request is missing Content-Length.".to_string()))
        .unwrap_or_else(|| Ok(length_header))?
        .parse::<usize>()
        .map_err(|_| "Request has an invalid Content-Length.".to_string())?;
    let header_end = initial
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| index + 4)
        .unwrap_or(initial.len());
    let mut body = initial.get(header_end..).unwrap_or(&[]).to_vec();
    while body.len() < length {
        let mut buffer = vec![0; (length - body.len()).min(64 * 1024)];
        match stream.read(&mut buffer) {
            Ok(0) => {
                return Err(format!(
                    "Request body ended early: received {} of {length} bytes.",
                    body.len()
                ))
            }
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::Interrupted | std::io::ErrorKind::WouldBlock
                ) =>
            {
                std::thread::sleep(std::time::Duration::from_millis(20));
                continue;
            }
            Err(error) => return Err(format!("Could not read request body: {error}")),
            Ok(count) => body.extend_from_slice(&buffer[..count]),
        }
    }
    body.truncate(length);
    Ok(body)
}

fn parse_chunked_body(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut body = Vec::new();
    let mut index = 0;
    loop {
        let Some(line_end) = bytes[index..]
            .windows(2)
            .position(|window| window == b"\r\n")
            .map(|offset| index + offset)
        else {
            return Err("Chunked request body is incomplete.".to_string());
        };
        let size_text = String::from_utf8_lossy(&bytes[index..line_end]);
        let size_hex = size_text.split(';').next().unwrap_or("").trim();
        let size = usize::from_str_radix(size_hex, 16)
            .map_err(|_| "Chunked request body has an invalid chunk size.".to_string())?;
        index = line_end + 2;
        if size == 0 {
            return Ok(body);
        }
        if index + size + 2 > bytes.len() {
            return Err("Chunked request body is truncated.".to_string());
        }
        body.extend_from_slice(&bytes[index..index + size]);
        index += size;
        if bytes.get(index..index + 2) != Some(b"\r\n") {
            return Err("Chunked request body has an invalid separator.".to_string());
        }
        index += 2;
    }
}

fn request_body(stream: &mut TcpStream, initial: &[u8], headers: &str) -> Result<Vec<u8>, String> {
    if header_value(headers, "transfer-encoding")
        .to_ascii_lowercase()
        .contains("chunked")
    {
        let header_end = initial
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .map(|index| index + 4)
            .unwrap_or(initial.len());
        let mut bytes = initial.get(header_end..).unwrap_or(&[]).to_vec();
        let mut buffer = vec![0; 16 * 1024];
        loop {
            if parse_chunked_body(&bytes).is_ok() {
                break;
            }
            match stream.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => bytes.extend_from_slice(&buffer[..count]),
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::Interrupted | std::io::ErrorKind::WouldBlock
                    ) =>
                {
                    std::thread::sleep(std::time::Duration::from_millis(20));
                    continue;
                }
                Err(error) => return Err(format!("Could not read request body: {error}")),
            }
        }
        return parse_chunked_body(&bytes);
    }
    body_from_request(stream, initial, headers)
}

fn current_web_auth() -> WebAuthConfig {
    lan_mutex()
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|server| server.web_auth.clone()))
        .unwrap_or_default()
}

fn send_web_auth_status(stream: &mut TcpStream, headers: &str) {
    let auth = current_web_auth();
    let status = WebAuthStatus {
        login_enabled: auth.enabled,
        login_required: web_auth_requires_login(&auth, headers),
        authenticated: request_has_web_session(&auth, headers),
        username: if auth.username.trim().is_empty() {
            "admin".to_string()
        } else {
            auth.username.clone()
        },
    };
    let body = serde_json::to_string(&status).unwrap_or_else(|_| "{}".to_string());
    send_response(
        stream,
        "200 OK",
        "application/json; charset=utf-8",
        body.as_bytes(),
    );
}

fn handle_web_login(stream: &mut TcpStream, body: &[u8], headers: &str) {
    let auth = current_web_auth();
    if !web_auth_requires_login(&auth, headers) {
        send_response(
            stream,
            "200 OK",
            "application/json; charset=utf-8",
            b"{\"ok\":true}",
        );
        return;
    }
    if auth.password_hash.is_empty()
        || auth.password_salt.is_empty()
        || auth.session_secret.is_empty()
    {
        send_response(
            stream,
            "403 Forbidden",
            "text/plain; charset=utf-8",
            b"Web login is enabled but no admin password is configured.",
        );
        return;
    }
    let request = match serde_json::from_slice::<WebLoginRequest>(body) {
        Ok(request) => request,
        Err(error) => {
            let message = format!("Invalid login request: {error}");
            send_response(
                stream,
                "400 Bad Request",
                "text/plain; charset=utf-8",
                message.as_bytes(),
            );
            return;
        }
    };
    let expected_user = if auth.username.trim().is_empty() {
        "admin"
    } else {
        auth.username.trim()
    };
    let expected_hash = password_hash(&request.password, &auth);
    if request.username.trim() != expected_user || expected_hash != auth.password_hash {
        send_response(
            stream,
            "401 Unauthorized",
            "text/plain; charset=utf-8",
            b"Invalid BuildBook username or password.",
        );
        return;
    }
    let remember_days = auth.remember_days.unwrap_or(30).clamp(1, 365) as u64;
    let max_age = remember_days * 24 * 60 * 60;
    let expires = now_seconds() + max_age;
    let value = format!("{}.{}", expires, session_signature(&auth, expires));
    let secure = if request_is_https(headers) {
        "; Secure"
    } else {
        ""
    };
    let cookie = format!("Set-Cookie: buildbook_session={value}; Path=/; Max-Age={max_age}; HttpOnly; SameSite=Lax{secure}");
    send_response_with_headers(
        stream,
        "200 OK",
        "application/json; charset=utf-8",
        b"{\"ok\":true}",
        &[cookie],
    );
}

fn handle_web_logout(stream: &mut TcpStream) {
    send_response_with_headers(
        stream,
        "200 OK",
        "application/json; charset=utf-8",
        b"{\"ok\":true}",
        &["Set-Cookie: buildbook_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax".to_string()],
    );
}

fn serve_lan_request(app: tauri::AppHandle, mut stream: TcpStream) {
    let mut buffer = vec![0; 64 * 1024];
    let count = match stream.read(&mut buffer) {
        Ok(count) => count,
        Err(_) => return,
    };
    buffer.truncate(count);
    let request = String::from_utf8_lossy(&buffer);
    let mut lines = request.lines();
    let Some(first_line) = lines.next() else {
        return;
    };
    let parts: Vec<&str> = first_line.split_whitespace().collect();
    if parts.len() < 2 {
        send_response(
            &mut stream,
            "400 Bad Request",
            "text/plain; charset=utf-8",
            b"Bad request",
        );
        return;
    }
    let method = parts[0];
    let path = parts[1];

    let headers = request.split("\r\n\r\n").next().unwrap_or("");

    if !host_is_allowed(&current_web_auth(), headers) {
        send_response(
            &mut stream,
            "403 Forbidden",
            "text/plain; charset=utf-8",
            b"BuildBook host is not allowed.",
        );
        return;
    }

    if path.starts_with("/api/discovery") {
        let host_config = load_sync_config(&app).unwrap_or_default();
        if host_config.mode != "host" {
            send_response(
                &mut stream,
                "404 Not Found",
                "text/plain; charset=utf-8",
                b"BuildBook host mode is not enabled.",
            );
            return;
        }
        let url = lan_mutex()
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|server| server.url.clone()))
            .unwrap_or_default();
        let body = serde_json::to_vec(&host_info(&app, url)).unwrap_or_else(|_| b"{}".to_vec());
        send_response(
            &mut stream,
            "200 OK",
            "application/json; charset=utf-8",
            &body,
        );
        return;
    }

    if path.starts_with("/api/host-info") {
        if let Some(error) = request_token_error(path, headers) {
            send_response(
                &mut stream,
                "401 Unauthorized",
                "text/plain; charset=utf-8",
                error.as_bytes(),
            );
            return;
        }
        let url = lan_mutex()
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().map(|server| server.url.clone()))
            .unwrap_or_default();
        let body = serde_json::to_vec(&host_info(&app, url)).unwrap_or_else(|_| b"{}".to_vec());
        send_response(
            &mut stream,
            "200 OK",
            "application/json; charset=utf-8",
            &body,
        );
        return;
    }

    if path.starts_with("/api/auth-status") {
        send_web_auth_status(&mut stream, headers);
        return;
    }

    if path.starts_with("/api/sync/pair") {
        let mut host_config = load_sync_config(&app).unwrap_or_default();
        if host_config.mode != "host" {
            send_response(
                &mut stream,
                "409 Conflict",
                "text/plain; charset=utf-8",
                b"This BuildBook installation is not configured as the authoritative host.",
            );
            return;
        }
        if method == "POST" {
            let now = now_seconds();
            if host_config.pairing_locked_until > now {
                send_response(&mut stream, "429 Too Many Requests", "text/plain; charset=utf-8", b"Pairing is temporarily locked after too many failed attempts. Generate a new code or wait 5 minutes.");
                return;
            }
            let body = match request_body(&mut stream, &buffer, headers) {
                Ok(body) => body,
                Err(error) => {
                    send_response(
                        &mut stream,
                        "400 Bad Request",
                        "text/plain; charset=utf-8",
                        error.as_bytes(),
                    );
                    return;
                }
            };
            let request = match serde_json::from_slice::<PairDeviceRequest>(&body) {
                Ok(request) => request,
                Err(error) => {
                    send_response(
                        &mut stream,
                        "400 Bad Request",
                        "text/plain; charset=utf-8",
                        format!("Invalid pairing request: {error}").as_bytes(),
                    );
                    return;
                }
            };
            if host_config.pairing_code.trim().is_empty()
                || host_config.pairing_code_expires_at < now_seconds()
                || request.pairing_code.trim() != host_config.pairing_code
            {
                host_config.pairing_failed_attempts =
                    host_config.pairing_failed_attempts.saturating_add(1);
                if host_config.pairing_failed_attempts >= 5 {
                    host_config.pairing_locked_until = now_seconds() + 5 * 60;
                    host_config.pairing_code.clear();
                    host_config.pairing_code_expires_at = 0;
                    host_config.pairing_failed_attempts = 0;
                }
                let _ = save_sync_config(&app, &host_config);
                send_response(
                    &mut stream,
                    "401 Unauthorized",
                    "text/plain; charset=utf-8",
                    b"Pairing code is invalid or expired.",
                );
                return;
            }
            if request.device_id.trim().is_empty() {
                send_response(
                    &mut stream,
                    "400 Bad Request",
                    "text/plain; charset=utf-8",
                    b"Pairing request is missing a device id.",
                );
                return;
            }
            let device_token = generated_secret("device-token");
            let now = now_seconds();
            host_config.pairing_code.clear();
            host_config.pairing_code_expires_at = 0;
            host_config.pairing_failed_attempts = 0;
            host_config.pairing_locked_until = 0;
            host_config
                .paired_devices
                .retain(|device| device.device_id != request.device_id);
            host_config.paired_devices.push(PairedDevice {
                device_id: request.device_id,
                device_name: if request.device_name.trim().is_empty() {
                    "BuildBook Computer".to_string()
                } else {
                    request.device_name
                },
                token_hash: sha256_hex(&device_token),
                paired_at: now,
                last_seen_at: now,
                revoked: false,
            });
            if let Err(error) = save_sync_config(&app, &host_config) {
                send_response(
                    &mut stream,
                    "500 Internal Server Error",
                    "text/plain; charset=utf-8",
                    error.as_bytes(),
                );
                return;
            }
            let url = lan_mutex()
                .lock()
                .ok()
                .and_then(|guard| guard.as_ref().map(|server| server.url.clone()))
                .unwrap_or_default();
            let response = PairDeviceResponse {
                host: host_info(&app, url),
                device_token,
            };
            send_response(
                &mut stream,
                "200 OK",
                "application/json; charset=utf-8",
                serde_json::to_string(&response)
                    .unwrap_or_default()
                    .as_bytes(),
            );
            return;
        }
    }

    if path.starts_with("/api/sync/checkout") {
        if let Some(error) = request_sync_auth_error(&app, path, headers) {
            send_response(
                &mut stream,
                "401 Unauthorized",
                "text/plain; charset=utf-8",
                error.as_bytes(),
            );
            return;
        }
        let host_config = load_sync_config(&app).unwrap_or_default();
        if host_config.mode != "host" {
            send_response(
                &mut stream,
                "409 Conflict",
                "text/plain; charset=utf-8",
                b"This BuildBook installation is not configured as the authoritative host.",
            );
            return;
        }
        if method == "POST" {
            let body = match request_body(&mut stream, &buffer, headers) {
                Ok(body) => body,
                Err(error) => {
                    send_response(
                        &mut stream,
                        "400 Bad Request",
                        "text/plain; charset=utf-8",
                        error.as_bytes(),
                    );
                    return;
                }
            };
            match serde_json::from_slice::<FileCheckoutRequest>(&body)
                .map_err(|error| format!("Invalid checkout request: {error}"))
                .and_then(apply_file_checkout)
            {
                Ok(result) => send_response(
                    &mut stream,
                    "200 OK",
                    "application/json; charset=utf-8",
                    serde_json::to_string(&result)
                        .unwrap_or_default()
                        .as_bytes(),
                ),
                Err(error) => send_response(
                    &mut stream,
                    "400 Bad Request",
                    "text/plain; charset=utf-8",
                    error.as_bytes(),
                ),
            }
            return;
        }
    }

    if path.starts_with("/api/sync/revision") {
        if let Some(error) = request_sync_auth_error(&app, path, headers) {
            send_response(
                &mut stream,
                "401 Unauthorized",
                "text/plain; charset=utf-8",
                error.as_bytes(),
            );
            return;
        }
        let host_config = load_sync_config(&app).unwrap_or_default();
        if host_config.mode != "host" {
            send_response(
                &mut stream,
                "409 Conflict",
                "text/plain; charset=utf-8",
                b"This BuildBook installation is not configured as the authoritative host.",
            );
            return;
        }
        if method == "GET" {
            match read_app_state(app.clone()) {
                Ok(contents) => {
                    let contents = contents.unwrap_or_else(|| "{}".to_string());
                    match state_revision(&contents) {
                        Ok(revision) => send_response(
                            &mut stream,
                            "200 OK",
                            "text/plain; charset=utf-8",
                            revision.as_bytes(),
                        ),
                        Err(error) => send_response(
                            &mut stream,
                            "500 Internal Server Error",
                            "text/plain; charset=utf-8",
                            error.as_bytes(),
                        ),
                    }
                }
                Err(error) => send_response(
                    &mut stream,
                    "500 Internal Server Error",
                    "text/plain; charset=utf-8",
                    error.as_bytes(),
                ),
            }
            return;
        }
    }

    if path.starts_with("/api/sync/state") {
        if let Some(error) = request_sync_auth_error(&app, path, headers) {
            send_response(
                &mut stream,
                "401 Unauthorized",
                "text/plain; charset=utf-8",
                error.as_bytes(),
            );
            return;
        }
        let host_config = load_sync_config(&app).unwrap_or_default();
        if host_config.mode != "host" {
            send_response(
                &mut stream,
                "409 Conflict",
                "text/plain; charset=utf-8",
                b"This BuildBook installation is not configured as the authoritative host.",
            );
            return;
        }
        if method == "GET" {
            let contents = match read_app_state(app.clone()) {
                Ok(value) => value.unwrap_or_else(|| "{}".to_string()),
                Err(error) => {
                    send_response(
                        &mut stream,
                        "500 Internal Server Error",
                        "text/plain; charset=utf-8",
                        error.as_bytes(),
                    );
                    return;
                }
            };
            let state = match serde_json::from_str::<serde_json::Value>(&contents) {
                Ok(state) => state,
                Err(error) => {
                    send_response(
                        &mut stream,
                        "500 Internal Server Error",
                        "text/plain; charset=utf-8",
                        format!("Host state is invalid: {error}").as_bytes(),
                    );
                    return;
                }
            };
            let envelope = SyncStateEnvelope {
                revision: state_revision(&contents).unwrap_or_default(),
                contents: state,
            };
            let body = serde_json::to_vec(&envelope).unwrap_or_default();
            send_response(
                &mut stream,
                "200 OK",
                "application/json; charset=utf-8",
                &body,
            );
            return;
        }
        if method == "POST" {
            let body = match request_body(&mut stream, &buffer, headers) {
                Ok(body) => body,
                Err(error) => {
                    send_response(
                        &mut stream,
                        "400 Bad Request",
                        "text/plain; charset=utf-8",
                        error.as_bytes(),
                    );
                    return;
                }
            };
            let request = match serde_json::from_slice::<SyncStateWriteRequest>(&body) {
                Ok(request) => request,
                Err(error) => {
                    send_response(
                        &mut stream,
                        "400 Bad Request",
                        "text/plain; charset=utf-8",
                        format!("Invalid sync request: {error}").as_bytes(),
                    );
                    return;
                }
            };
            if request.device_id.trim().is_empty() {
                send_response(
                    &mut stream,
                    "400 Bad Request",
                    "text/plain; charset=utf-8",
                    b"Sync request is missing a device id.",
                );
                return;
            }
            let _guard = match state_write_lock().lock() {
                Ok(guard) => guard,
                Err(_) => {
                    send_response(
                        &mut stream,
                        "500 Internal Server Error",
                        "text/plain; charset=utf-8",
                        b"Could not lock BuildBook state.",
                    );
                    return;
                }
            };
            let current_contents = match read_app_state(app.clone()) {
                Ok(value) => value.unwrap_or_else(|| "{}".to_string()),
                Err(error) => {
                    send_response(
                        &mut stream,
                        "500 Internal Server Error",
                        "text/plain; charset=utf-8",
                        error.as_bytes(),
                    );
                    return;
                }
            };
            let current_revision = state_revision(&current_contents).unwrap_or_default();
            if request.force != Some(true) && request.base_revision != current_revision {
                let current_state = serde_json::from_str::<serde_json::Value>(&current_contents)
                    .unwrap_or_else(|_| serde_json::json!({}));
                let envelope = SyncStateEnvelope {
                    revision: current_revision,
                    contents: current_state,
                };
                let response = serde_json::to_vec(&envelope).unwrap_or_default();
                send_response(
                    &mut stream,
                    "409 Conflict",
                    "application/json; charset=utf-8",
                    &response,
                );
                return;
            }
            let next_contents = match serde_json::to_string_pretty(&request.contents) {
                Ok(contents) => contents,
                Err(error) => {
                    send_response(
                        &mut stream,
                        "400 Bad Request",
                        "text/plain; charset=utf-8",
                        format!("Could not encode sync state: {error}").as_bytes(),
                    );
                    return;
                }
            };
            if let Err(error) = write_app_state_inner(&app, &next_contents) {
                send_response(
                    &mut stream,
                    "500 Internal Server Error",
                    "text/plain; charset=utf-8",
                    error.as_bytes(),
                );
                return;
            }
            let envelope = SyncStateEnvelope {
                revision: state_revision(&next_contents).unwrap_or_default(),
                contents: request.contents,
            };
            let response = serde_json::to_vec(&envelope).unwrap_or_default();
            send_response(
                &mut stream,
                "200 OK",
                "application/json; charset=utf-8",
                &response,
            );
            return;
        }
    }

    if path.starts_with("/api/login") {
        if method == "POST" {
            if !request_has_app_header(headers) {
                send_response(
                    &mut stream,
                    "401 Unauthorized",
                    "text/plain; charset=utf-8",
                    b"BuildBook request header is required.",
                );
                return;
            }
            let body = match request_body(&mut stream, &buffer, headers) {
                Ok(body) => body,
                Err(error) => {
                    send_response(
                        &mut stream,
                        "400 Bad Request",
                        "text/plain; charset=utf-8",
                        error.as_bytes(),
                    );
                    return;
                }
            };
            handle_web_login(&mut stream, &body, headers);
            return;
        }
    }

    if path.starts_with("/api/logout") {
        if method == "POST" {
            if !request_has_app_header(headers) {
                send_response(
                    &mut stream,
                    "401 Unauthorized",
                    "text/plain; charset=utf-8",
                    b"BuildBook request header is required.",
                );
                return;
            }
            handle_web_logout(&mut stream);
            return;
        }
    }

    if path.starts_with("/api/state") {
        if let Some(error) = request_auth_error(method, path, headers) {
            send_response(
                &mut stream,
                "401 Unauthorized",
                "text/plain; charset=utf-8",
                error.as_bytes(),
            );
            return;
        }
        if method == "GET" {
            match read_app_state(app)
                .and_then(|value| Ok(value.unwrap_or_else(|| "{}".to_string())))
            {
                Ok(contents) => send_response(
                    &mut stream,
                    "200 OK",
                    "application/json; charset=utf-8",
                    contents.as_bytes(),
                ),
                Err(error) => send_response(
                    &mut stream,
                    "500 Internal Server Error",
                    "text/plain; charset=utf-8",
                    error.as_bytes(),
                ),
            }
            return;
        }
        if method == "POST" {
            let body = match request_body(&mut stream, &buffer, headers) {
                Ok(body) => body,
                Err(error) => {
                    send_response(
                        &mut stream,
                        "400 Bad Request",
                        "text/plain; charset=utf-8",
                        error.as_bytes(),
                    );
                    return;
                }
            };
            let contents = match String::from_utf8(body) {
                Ok(contents) => contents,
                Err(error) => {
                    let message = format!("App state request was not valid UTF-8: {error}");
                    send_response(
                        &mut stream,
                        "400 Bad Request",
                        "text/plain; charset=utf-8",
                        message.as_bytes(),
                    );
                    return;
                }
            };
            match write_app_state(app, contents) {
                Ok(()) => send_response(
                    &mut stream,
                    "200 OK",
                    "application/json; charset=utf-8",
                    b"{\"ok\":true}",
                ),
                Err(error) => send_response(
                    &mut stream,
                    "500 Internal Server Error",
                    "text/plain; charset=utf-8",
                    error.as_bytes(),
                ),
            }
            return;
        }
    }

    if path.starts_with("/api/files") {
        if let Some(error) = request_file_auth_error(&app, method, path, headers) {
            send_response(
                &mut stream,
                "401 Unauthorized",
                "text/plain; charset=utf-8",
                error.as_bytes(),
            );
            return;
        }
        if method == "GET" {
            let file_path = query_value(path, "path");
            match read_file_bytes(file_path.clone()) {
                Ok(bytes) => send_response(&mut stream, "200 OK", content_type(&file_path), &bytes),
                Err(error) => send_response(
                    &mut stream,
                    "404 Not Found",
                    "text/plain; charset=utf-8",
                    error.as_bytes(),
                ),
            }
            return;
        }
        if method == "POST" {
            let body = match request_body(&mut stream, &buffer, headers) {
                Ok(body) => body,
                Err(error) => {
                    send_response(
                        &mut stream,
                        "400 Bad Request",
                        "text/plain; charset=utf-8",
                        error.as_bytes(),
                    );
                    return;
                }
            };
            let name = query_value(path, "name");
            let library = query_value(path, "library");
            match save_uploaded_file(app, name, library, body) {
                Ok(stored) => send_response(
                    &mut stream,
                    "200 OK",
                    "application/json; charset=utf-8",
                    serde_json::to_string(&stored)
                        .unwrap_or_default()
                        .as_bytes(),
                ),
                Err(error) => send_response(
                    &mut stream,
                    "500 Internal Server Error",
                    "text/plain; charset=utf-8",
                    error.as_bytes(),
                ),
            }
            return;
        }
        if method == "PUT" {
            let body = match request_body(&mut stream, &buffer, headers) {
                Ok(body) => body,
                Err(error) => {
                    send_response(
                        &mut stream,
                        "400 Bad Request",
                        "text/plain; charset=utf-8",
                        error.as_bytes(),
                    );
                    return;
                }
            };
            let file_path = query_value(path, "path");
            match overwrite_file_bytes(app, file_path, body) {
                Ok(stored) => send_response(
                    &mut stream,
                    "200 OK",
                    "application/json; charset=utf-8",
                    serde_json::to_string(&stored)
                        .unwrap_or_default()
                        .as_bytes(),
                ),
                Err(error) => send_response(
                    &mut stream,
                    "500 Internal Server Error",
                    "text/plain; charset=utf-8",
                    error.as_bytes(),
                ),
            }
            return;
        }
        if method == "DELETE" {
            let body = match request_body(&mut stream, &buffer, headers) {
                Ok(body) => body,
                Err(error) => {
                    send_response(
                        &mut stream,
                        "400 Bad Request",
                        "text/plain; charset=utf-8",
                        error.as_bytes(),
                    );
                    return;
                }
            };
            let paths = match serde_json::from_slice::<Vec<String>>(&body) {
                Ok(paths) => paths,
                Err(error) => {
                    send_response(
                        &mut stream,
                        "400 Bad Request",
                        "text/plain; charset=utf-8",
                        format!("Invalid file delete request: {error}").as_bytes(),
                    );
                    return;
                }
            };
            match delete_managed_files(app, paths) {
                Ok(result) => send_response(
                    &mut stream,
                    "200 OK",
                    "application/json; charset=utf-8",
                    serde_json::to_string(&result)
                        .unwrap_or_default()
                        .as_bytes(),
                ),
                Err(error) => send_response(
                    &mut stream,
                    "500 Internal Server Error",
                    "text/plain; charset=utf-8",
                    error.as_bytes(),
                ),
            }
            return;
        }
    }

    if path.starts_with("/api/download-url") {
        if let Some(error) = request_file_auth_error(&app, method, path, headers) {
            send_response(
                &mut stream,
                "401 Unauthorized",
                "text/plain; charset=utf-8",
                error.as_bytes(),
            );
            return;
        }
        if method == "POST" {
            match download_url_to_file(
                app,
                query_value(path, "url"),
                query_value(path, "library"),
                query_value(path, "name"),
            ) {
                Ok(stored) => send_response(
                    &mut stream,
                    "200 OK",
                    "application/json; charset=utf-8",
                    serde_json::to_string(&stored)
                        .unwrap_or_default()
                        .as_bytes(),
                ),
                Err(error) => send_response(
                    &mut stream,
                    "502 Bad Gateway",
                    "text/plain; charset=utf-8",
                    error.as_bytes(),
                ),
            }
            return;
        }
    }

    if path.starts_with("/api/storage-scan") {
        if let Some(error) = request_auth_error(method, path, headers) {
            send_response(
                &mut stream,
                "401 Unauthorized",
                "text/plain; charset=utf-8",
                error.as_bytes(),
            );
            return;
        }
        if method == "POST" {
            let body = match request_body(&mut stream, &buffer, headers) {
                Ok(body) => body,
                Err(error) => {
                    send_response(
                        &mut stream,
                        "400 Bad Request",
                        "text/plain; charset=utf-8",
                        error.as_bytes(),
                    );
                    return;
                }
            };
            match serde_json::from_slice::<StorageScanRequest>(&body)
                .map_err(|error| format!("Invalid storage scan request: {error}"))
                .and_then(|request| {
                    scan_storage_inner(
                        app,
                        request.referenced_paths,
                        request.delete_paths.unwrap_or_default(),
                    )
                }) {
                Ok(scan) => send_response(
                    &mut stream,
                    "200 OK",
                    "application/json; charset=utf-8",
                    serde_json::to_string(&scan).unwrap_or_default().as_bytes(),
                ),
                Err(error) => send_response(
                    &mut stream,
                    "500 Internal Server Error",
                    "text/plain; charset=utf-8",
                    error.as_bytes(),
                ),
            }
            return;
        }
    }

    if path.starts_with("/api/reset-storage") {
        if let Some(error) = request_auth_error(method, path, headers) {
            send_response(
                &mut stream,
                "401 Unauthorized",
                "text/plain; charset=utf-8",
                error.as_bytes(),
            );
            return;
        }
        if method == "POST" {
            match reset_managed_storage(app) {
                Ok(result) => send_response(
                    &mut stream,
                    "200 OK",
                    "application/json; charset=utf-8",
                    serde_json::to_string(&result)
                        .unwrap_or_default()
                        .as_bytes(),
                ),
                Err(error) => send_response(
                    &mut stream,
                    "500 Internal Server Error",
                    "text/plain; charset=utf-8",
                    error.as_bytes(),
                ),
            }
            return;
        }
    }

    let Some(dist) = dist_dir(&app) else {
        send_response(
            &mut stream,
            "503 Service Unavailable",
            "text/plain; charset=utf-8",
            b"BuildBook web files are not available. Run a production build first.",
        );
        return;
    };
    let relative = path
        .split('?')
        .next()
        .unwrap_or("/")
        .trim_start_matches('/');
    let safe_relative = if relative.is_empty() {
        "index.html"
    } else {
        relative
    };
    let target = dist.join(safe_library_path(safe_relative));
    let file_path = if target.is_file() {
        target
    } else {
        dist.join("index.html")
    };
    match std::fs::read(&file_path) {
        Ok(bytes) => send_response(
            &mut stream,
            "200 OK",
            content_type(file_path.to_string_lossy().as_ref()),
            &bytes,
        ),
        Err(_) => send_response(
            &mut stream,
            "404 Not Found",
            "text/plain; charset=utf-8",
            b"Not found",
        ),
    }
}

#[tauri::command]
fn start_lan_server(
    app: tauri::AppHandle,
    port: u16,
    token: String,
    require_token: bool,
    web_auth: Option<WebAuthConfig>,
) -> Result<LanServerInfo, String> {
    if require_token && token.trim().is_empty() {
        return Err("LAN access code is missing.".to_string());
    }
    let web_auth = web_auth.unwrap_or_default();
    if web_auth.enabled
        && (web_auth.password_hash.is_empty()
            || web_auth.password_salt.is_empty()
            || web_auth.session_secret.is_empty())
    {
        return Err("Web login is enabled but no admin password is configured.".to_string());
    }
    let mut guard = lan_mutex()
        .lock()
        .map_err(|_| "Could not lock LAN server state.".to_string())?;
    if let Some(server) = guard.as_ref() {
        if server.port == port
            && server.token == token
            && server.require_token == require_token
            && server.web_auth == web_auth
        {
            return Ok(LanServerInfo {
                running: true,
                url: server.url.clone(),
                port: server.port,
            });
        }
        drop(guard);
        let _ = stop_lan_server();
        guard = lan_mutex()
            .lock()
            .map_err(|_| "Could not lock LAN server state.".to_string())?;
    }
    if let Some(server) = guard.as_ref() {
        return Ok(LanServerInfo {
            running: true,
            url: server.url.clone(),
            port: server.port,
        });
    }

    let listener = TcpListener::bind(("0.0.0.0", port))
        .map_err(|error| format!("Could not start LAN server: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("Could not configure LAN server: {error}"))?;
    let stop = Arc::new(AtomicBool::new(false));
    let stop_thread = stop.clone();
    let discovery_stop = stop.clone();
    let app_thread = app.clone();
    let discovery_app = app.clone();
    let url = format!("http://{}:{}/", local_lan_ip(), port);
    let discovery_url = url.clone();
    let thread = std::thread::spawn(move || {
        while !stop_thread.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => {
                    let _ = stream.set_nonblocking(false);
                    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(15)));
                    serve_lan_request(app_thread.clone(), stream);
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(std::time::Duration::from_millis(80))
                }
                Err(_) => break,
            }
        }
    });

    let discovery_thread = UdpSocket::bind(("0.0.0.0", port)).ok().map(|socket| {
        let _ = socket.set_read_timeout(Some(std::time::Duration::from_millis(250)));
        std::thread::spawn(move || {
            while !discovery_stop.load(Ordering::Relaxed) {
                let mut buffer = [0u8; 256];
                match socket.recv_from(&mut buffer) {
                    Ok((count, source)) if &buffer[..count] == DISCOVERY_REQUEST => {
                        if let Ok(bytes) =
                            serde_json::to_vec(&host_info(&discovery_app, discovery_url.clone()))
                        {
                            let _ = socket.send_to(&bytes, source);
                        }
                    }
                    Ok(_) => {}
                    Err(error)
                        if matches!(
                            error.kind(),
                            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                        ) => {}
                    Err(_) => break,
                }
            }
        })
    });

    *guard = Some(LanServerHandle {
        port,
        url: url.clone(),
        token,
        require_token,
        web_auth,
        stop,
        thread: Some(thread),
        discovery_thread,
    });
    Ok(LanServerInfo {
        running: true,
        url,
        port,
    })
}

#[tauri::command]
fn stop_lan_server() -> Result<LanServerInfo, String> {
    let mut guard = lan_mutex()
        .lock()
        .map_err(|_| "Could not lock LAN server state.".to_string())?;
    if let Some(mut server) = guard.take() {
        server.stop.store(true, Ordering::Relaxed);
        let _ = TcpStream::connect(("127.0.0.1", server.port));
        if let Some(thread) = server.thread.take() {
            let _ = thread.join();
        }
        if let Some(thread) = server.discovery_thread.take() {
            let _ = thread.join();
        }
    }
    Ok(LanServerInfo {
        running: false,
        url: String::new(),
        port: 0,
    })
}

#[tauri::command]
fn lan_server_status() -> Result<LanServerInfo, String> {
    let guard = lan_mutex()
        .lock()
        .map_err(|_| "Could not lock LAN server state.".to_string())?;
    if let Some(server) = guard.as_ref() {
        return Ok(LanServerInfo {
            running: true,
            url: server.url.clone(),
            port: server.port,
        });
    }
    Ok(LanServerInfo {
        running: false,
        url: String::new(),
        port: 0,
    })
}

#[tauri::command]
fn prepare_edit_file(
    app: tauri::AppHandle,
    path: String,
    name: String,
    library: String,
) -> Result<StoredFile, String> {
    let source = std::path::PathBuf::from(path.trim_matches('"'));

    if !source.is_file() {
        return Err("The file to edit could not be found.".to_string());
    }

    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data folder: {error}"))?;
    let target_dir = app_dir.join("working").join(safe_library_path(&library));
    let target = editable_target_path(&target_dir, &name)?;

    std::fs::copy(&source, &target)
        .map_err(|error| format!("Could not prepare editable file: {error}"))?;
    let size = target
        .metadata()
        .map_err(|error| format!("Could not read editable file metadata: {error}"))?
        .len();

    Ok(StoredFile {
        name,
        path: target.to_string_lossy().to_string(),
        size,
    })
}

#[tauri::command]
fn download_url_to_file(
    app: tauri::AppHandle,
    url: String,
    library: String,
    name: String,
) -> Result<StoredFile, String> {
    let url = validate_public_web_url(&url)?;
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data folder: {error}"))?;
    let target_dir = app_dir.join("uploads").join(safe_library_path(&library));
    std::fs::create_dir_all(&target_dir)
        .map_err(|error| format!("Could not create upload folder: {error}"))?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| format!("Could not create timestamp: {error}"))?
        .as_millis();
    let stored_name = format!("{timestamp}-{}", safe_file_name(&name));
    let target = target_dir.join(&stored_name);

    #[cfg(target_os = "windows")]
    let mut command = {
        use std::os::windows::process::CommandExt;
        let mut cmd = std::process::Command::new("curl.exe");
        cmd.args([
            "-L",
            "--fail",
            "--silent",
            "--show-error",
            "--connect-timeout",
            "15",
            "--max-time",
            "60",
            "--user-agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
            "--referer",
            "https://www.google.com/",
        ])
            .arg(&url)
            .args(["--output"])
            .arg(&target);
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    };

    #[cfg(not(target_os = "windows"))]
    let mut command = {
        let mut cmd = std::process::Command::new("curl");
        cmd.args([
            "-L",
            "--fail",
            "--silent",
            "--show-error",
            "--connect-timeout",
            "15",
            "--max-time",
            "60",
            "--user-agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
            "--referer",
            "https://www.google.com/",
        ])
            .arg(&url)
            .args(["--output"])
            .arg(&target);
        cmd
    };

    let output = command
        .output()
        .map_err(|error| format!("Could not download file: {error}"))?;

    if !output.status.success() {
        let _ = std::fs::remove_file(&target);
        let details = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if details.is_empty() {
            "Could not download remote file.".to_string()
        } else {
            format!("Could not download remote file: {details}")
        });
    }

    let size = target
        .metadata()
        .map_err(|error| format!("Could not read downloaded file metadata: {error}"))?
        .len();

    Ok(StoredFile {
        name,
        path: target.to_string_lossy().to_string(),
        size,
    })
}

#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    let target = std::path::PathBuf::from(path.trim_matches('"'));

    if !target.is_file() {
        return Err("The saved file could not be found.".to_string());
    }

    std::fs::read(target).map_err(|error| format!("Could not read file: {error}"))
}

#[tauri::command]
fn pick_file_path() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let script = r#"
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Multiselect = $false
$dialog.CheckFileExists = $true
$dialog.Title = 'Select file to link'
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dialog.FileName
}
"#;
        let output = std::process::Command::new("powershell")
            .args(["-NoProfile", "-STA", "-Command", script])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|error| format!("Could not open file picker: {error}"))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("File picker is only available on Windows right now.".to_string())
    }
}

#[tauri::command]
fn pick_folder_path() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let script = r#"
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select folder to link'
$dialog.ShowNewFolderButton = $false
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dialog.SelectedPath
}
"#;
        let output = std::process::Command::new("powershell")
            .args(["-NoProfile", "-STA", "-Command", script])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|error| format!("Could not open folder picker: {error}"))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Folder picker is only available on Windows right now.".to_string())
    }
}

fn collect_folder_files(
    root: &std::path::Path,
    current: &std::path::Path,
    files: &mut Vec<LinkedFolderFile>,
) -> Result<(), String> {
    for entry in
        std::fs::read_dir(current).map_err(|error| format!("Could not read folder: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Could not read folder entry: {error}"))?;
        let path = entry.path();
        if path.is_dir() {
            collect_folder_files(root, &path, files)?;
        } else if path.is_file() {
            let relative_path = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            files.push(LinkedFolderFile {
                name: path
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string())
                    .unwrap_or_else(|| relative_path.clone()),
                relative_path,
                path: path.to_string_lossy().to_string(),
                size: path.metadata().map(|metadata| metadata.len()).unwrap_or(0),
            });
        }
    }
    Ok(())
}

#[tauri::command]
fn list_folder_files(path: String) -> Result<Vec<LinkedFolderFile>, String> {
    let root = std::path::PathBuf::from(path.trim_matches('"'));
    if !root.is_dir() {
        return Err("The selected folder could not be found.".to_string());
    }
    let mut files = Vec::new();
    collect_folder_files(&root, &root, &mut files)?;
    Ok(files)
}

fn collect_storage_files(
    current: &std::path::Path,
    files: &mut Vec<std::path::PathBuf>,
) -> Result<(), String> {
    if !current.exists() {
        return Ok(());
    }
    for entry in
        std::fs::read_dir(current).map_err(|error| format!("Could not scan storage: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Could not read storage entry: {error}"))?;
        let path = entry.path();
        if path.is_dir() {
            collect_storage_files(&path, files)?;
        } else if path.is_file() {
            files.push(path);
        }
    }
    Ok(())
}

fn storage_roots(app: &tauri::AppHandle) -> Result<Vec<std::path::PathBuf>, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data folder: {error}"))?;
    Ok(vec![app_dir.join("uploads"), app_dir.join("working")])
}

fn storage_relative_path(roots: &[std::path::PathBuf], path: &std::path::Path) -> String {
    roots
        .iter()
        .find_map(|root| {
            path.strip_prefix(root)
                .ok()
                .map(|value| value.to_string_lossy().replace('\\', "/"))
        })
        .unwrap_or_else(|| {
            path.file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_default()
        })
}

fn canonical_under_roots(path: &str, roots: &[std::path::PathBuf]) -> Option<std::path::PathBuf> {
    let canonical = std::fs::canonicalize(path.trim_matches('"')).ok()?;
    let lower = canonical.to_string_lossy().to_lowercase();
    let allowed = roots
        .iter()
        .filter_map(|root| std::fs::canonicalize(root).ok())
        .any(|root| {
            let prefix = root.to_string_lossy().to_lowercase();
            lower == prefix || lower.starts_with(&(prefix + "\\"))
        });
    allowed.then_some(canonical)
}

fn modified_millis(path: &std::path::Path) -> String {
    path.metadata()
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_default()
}

fn scan_storage_inner(
    app: tauri::AppHandle,
    referenced_paths: Vec<String>,
    delete_paths: Vec<String>,
) -> Result<StorageScan, String> {
    let roots = storage_roots(&app)?;
    let referenced: std::collections::HashSet<String> = referenced_paths
        .into_iter()
        .filter_map(|path| std::fs::canonicalize(path.trim_matches('"')).ok())
        .map(|path| path.to_string_lossy().to_lowercase())
        .collect();
    let delete_set: std::collections::HashSet<String> = delete_paths
        .into_iter()
        .filter_map(|path| std::fs::canonicalize(path.trim_matches('"')).ok())
        .map(|path| path.to_string_lossy().to_lowercase())
        .collect();
    let mut files = Vec::new();
    for root in &roots {
        collect_storage_files(root, &mut files)?;
    }

    let mut result = StorageScan {
        file_count: 0,
        total_bytes: 0,
        orphan_count: 0,
        orphan_bytes: 0,
        deleted_count: 0,
        deleted_bytes: 0,
        orphans: Vec::new(),
    };

    for file in files {
        let size = file.metadata().map(|metadata| metadata.len()).unwrap_or(0);
        result.file_count += 1;
        result.total_bytes += size;
        let canonical = std::fs::canonicalize(&file)
            .unwrap_or(file.clone())
            .to_string_lossy()
            .to_lowercase();
        if referenced.contains(&canonical) {
            continue;
        }
        if delete_set.contains(&canonical) && std::fs::remove_file(&file).is_ok() {
            result.deleted_count += 1;
            result.deleted_bytes += size;
            continue;
        }
        result.orphan_count += 1;
        result.orphan_bytes += size;
        result.orphans.push(OrphanFile {
            name: file
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_default(),
            path: file.to_string_lossy().to_string(),
            relative_path: storage_relative_path(&roots, &file),
            size,
            modified_at: modified_millis(&file),
        });
    }
    Ok(result)
}

#[tauri::command]
fn scan_storage(
    app: tauri::AppHandle,
    referenced_paths: Vec<String>,
) -> Result<StorageScan, String> {
    scan_storage_inner(app, referenced_paths, Vec::new())
}

#[tauri::command]
fn cleanup_orphaned_files(
    app: tauri::AppHandle,
    referenced_paths: Vec<String>,
    delete_paths: Vec<String>,
) -> Result<StorageScan, String> {
    scan_storage_inner(app, referenced_paths, delete_paths)
}

#[tauri::command]
fn delete_managed_files(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<DeleteManagedFilesResult, String> {
    let roots = storage_roots(&app)?;
    let mut deleted_paths = Vec::new();
    let mut failed_paths = Vec::new();
    for path in paths {
        let Some(target) = canonical_under_roots(&path, &roots) else {
            failed_paths.push(path);
            continue;
        };
        let result = if target.is_dir() {
            std::fs::remove_dir_all(&target)
        } else {
            std::fs::remove_file(&target)
        };
        if result.is_ok() {
            deleted_paths.push(target.to_string_lossy().to_string());
        } else {
            failed_paths.push(target.to_string_lossy().to_string());
        }
    }
    Ok(DeleteManagedFilesResult {
        deleted_paths,
        failed_paths,
    })
}

#[tauri::command]
fn reset_managed_storage(app: tauri::AppHandle) -> Result<ResetStorageResult, String> {
    let mut retained_files = Vec::new();
    for root in storage_roots(&app)? {
        if root.exists() {
            remove_managed_contents(&root, &mut retained_files);
            let _ = std::fs::remove_dir(&root);
        }
    }
    Ok(ResetStorageResult { retained_files })
}

fn remove_managed_contents(path: &std::path::Path, retained_files: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(path) else {
        retained_files.push(path.to_string_lossy().to_string());
        return;
    };
    for entry in entries.flatten() {
        let child = entry.path();
        if child.is_dir() {
            remove_managed_contents(&child, retained_files);
            let _ = std::fs::remove_dir(&child);
        } else if child.is_file() && std::fs::remove_file(&child).is_err() {
            retained_files.push(child.to_string_lossy().to_string());
        }
    }
}

#[cfg(test)]
mod sync_tests {
    use super::{apply_file_checkout, merge_sync_values, FileCheckoutRequest};

    #[test]
    fn merges_independent_entity_changes() {
        let base = serde_json::json!({
            "projects": [
                { "id": "a", "name": "Alpha", "notes": "Base" },
                { "id": "b", "name": "Beta", "notes": "" }
            ]
        });
        let local = serde_json::json!({
            "projects": [
                { "id": "a", "name": "Alpha local", "notes": "Base" },
                { "id": "b", "name": "Beta", "notes": "" }
            ]
        });
        let host = serde_json::json!({
            "projects": [
                { "id": "a", "name": "Alpha", "notes": "Base" },
                { "id": "b", "name": "Beta host", "notes": "" }
            ]
        });

        let merged = merge_sync_values(&base, &local, &host, "", "Client");
        assert_eq!(merged["projects"][0]["name"], "Alpha local");
        assert_eq!(merged["projects"][1]["name"], "Beta host");
    }

    #[test]
    fn combines_conflicting_project_notes() {
        let base = serde_json::json!({ "projects": [{ "id": "a", "notes": "Base" }] });
        let local = serde_json::json!({ "projects": [{ "id": "a", "notes": "Local note" }] });
        let host = serde_json::json!({ "projects": [{ "id": "a", "notes": "Host note" }] });

        let merged = merge_sync_values(&base, &local, &host, "", "Laptop");
        let notes = merged["projects"][0]["notes"].as_str().unwrap_or_default();
        assert!(notes.contains("Host note"));
        assert!(notes.contains("Combined notes from Laptop"));
        assert!(notes.contains("Local note"));
    }

    #[test]
    fn combines_conflicting_project_note_sheet_content() {
        let base = serde_json::json!({ "projects": [{ "id": "a", "noteSheets": [{ "id": "sheet-1", "content": "Base" }] }] });
        let local = serde_json::json!({ "projects": [{ "id": "a", "noteSheets": [{ "id": "sheet-1", "content": "Local note" }] }] });
        let host = serde_json::json!({ "projects": [{ "id": "a", "noteSheets": [{ "id": "sheet-1", "content": "Host note" }] }] });

        let merged = merge_sync_values(&base, &local, &host, "", "Laptop");
        let notes = merged["projects"][0]["noteSheets"][0]["content"].as_str().unwrap_or_default();
        assert!(notes.contains("Host note"));
        assert!(notes.contains("Combined notes from Laptop"));
        assert!(notes.contains("Local note"));
    }

    #[test]
    fn file_checkout_blocks_other_devices_until_release() {
        let path = format!("checkout-test-{}", std::process::id());
        let first = apply_file_checkout(FileCheckoutRequest {
            action: "acquire".to_string(),
            path: path.clone(),
            device_id: "device-a".to_string(),
            device_name: "Computer A".to_string(),
        })
        .expect("first checkout");
        assert!(first.acquired);

        let blocked = apply_file_checkout(FileCheckoutRequest {
            action: "acquire".to_string(),
            path: path.clone(),
            device_id: "device-b".to_string(),
            device_name: "Computer B".to_string(),
        })
        .expect("blocked checkout");
        assert!(!blocked.acquired);

        apply_file_checkout(FileCheckoutRequest {
            action: "release".to_string(),
            path: path.clone(),
            device_id: "device-a".to_string(),
            device_name: "Computer A".to_string(),
        })
        .expect("release checkout");

        let second = apply_file_checkout(FileCheckoutRequest {
            action: "acquire".to_string(),
            path,
            device_id: "device-b".to_string(),
            device_name: "Computer B".to_string(),
        })
        .expect("second checkout");
        assert!(second.acquired);
    }
}

#[tauri::command]
fn open_file_path(path: String) -> Result<(), String> {
    let target = std::path::PathBuf::from(path.trim_matches('"'));

    if !target.exists() {
        return Err("The saved file could not be found.".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        windows_shell_execute(&target, None)?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&target)
            .spawn()
            .map_err(|error| format!("Could not open file: {error}"))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&target)
            .spawn()
            .map_err(|error| format!("Could not open file: {error}"))?;
    }

    Ok(())
}

#[tauri::command]
fn open_file_with_program(program_path: String, file_path: String) -> Result<(), String> {
    let program = std::path::PathBuf::from(program_path.trim_matches('"'));
    let file = std::path::PathBuf::from(file_path.trim_matches('"'));

    if !program.exists() {
        return Err("The configured program could not be found.".to_string());
    }

    if !file.exists() {
        return Err("The saved file could not be found.".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        windows_shell_execute(&program, Some(&file))
            .map_err(|error| format!("Could not launch program: {error}"))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new(program)
            .arg(file)
            .spawn()
            .map_err(|error| format!("Could not launch program: {error}"))?;
    }

    Ok(())
}
