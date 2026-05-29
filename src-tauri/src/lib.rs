use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex, OnceLock};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
    WindowEvent,
};

static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(target_os = "windows")]
fn windows_shell_execute(target: &std::path::Path, parameters: Option<&std::path::Path>) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SHOW_WINDOW_CMD;

    let operation: Vec<u16> = OsStr::new("open").encode_wide().chain(std::iter::once(0)).collect();
    let file: Vec<u16> = target.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let parameters = parameters.map(|value| {
        value.as_os_str()
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
                .icon(app.default_window_icon().expect("BuildBook tray icon is missing").clone())
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
            let modified = entry.metadata().and_then(|metadata| metadata.modified()).ok()?;
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
    let Some(dir) = path.parent() else { return Ok(vec![]) };
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
            let modified_ms = metadata.modified().ok()
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
    if !file_name.starts_with("buildbook-state-recent-") && !file_name.starts_with("buildbook-state-week-") {
        return Err("Invalid state backup name.".to_string());
    }
    let path = state_file_path(&app)?;
    let Some(dir) = path.parent() else { return Err("Could not resolve app data folder.".to_string()) };
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

#[tauri::command]
fn write_app_state(app: tauri::AppHandle, contents: String) -> Result<(), String> {
    validate_state_contents(&contents)?;
    let path = state_file_path(&app)?;
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
    std::fs::rename(&temp_path, &path).or_else(|_| {
        let _ = std::fs::remove_file(&path);
        std::fs::rename(&temp_path, &path)
    }).map_err(|error| format!("Could not replace app state: {error}"))
}

#[derive(serde::Serialize)]
struct StoredFile {
    name: String,
    path: String,
    size: u64,
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

#[derive(serde::Serialize)]
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

struct LanServerHandle {
    port: u16,
    url: String,
    token: String,
    require_token: bool,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

static LAN_SERVER: OnceLock<Mutex<Option<LanServerHandle>>> = OnceLock::new();

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
    use windows::Win32::UI::Shell::{IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK};

    let wide: Vec<u16> = OsStr::new(&target)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let size = size.clamp(64, 1024) as i32;

    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|error| format!("Windows thumbnail COM setup failed: {error}"))?;
        let factory: IShellItemImageFactory = SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None)
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

fn upload_target_path(target_dir: &std::path::Path, original_name: &str) -> Result<std::path::PathBuf, String> {
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

fn editable_target_path(target_dir: &std::path::Path, original_name: &str) -> Result<std::path::PathBuf, String> {
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
fn overwrite_file_bytes(app: tauri::AppHandle, path: String, bytes: Vec<u8>) -> Result<StoredFile, String> {
    let roots = storage_roots(&app)?;
    let target = canonical_under_roots(&path, &roots)
        .ok_or_else(|| "Only BuildBook-managed files can be updated from this action.".to_string())?;

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
        output.push(if bytes[index] == b'+' { b' ' } else { bytes[index] });
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
                line.split_once(':').map(|(_, value)| value.trim().to_string())
            } else {
                None
            }
        })
        .unwrap_or_default()
}

fn request_is_authorized(path: &str, headers: &str) -> bool {
    let (expected, require_token) = lan_mutex()
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|server| (server.token.clone(), server.require_token)))
        .unwrap_or_else(|| (String::new(), true));
    if !require_token {
        return true;
    }
    if expected.is_empty() {
        return false;
    }
    query_value(path, "access") == expected || header_value(headers, "X-BuildBook-Token") == expected
}

fn validate_public_web_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim().to_string();
    let lower = trimmed.to_lowercase();
    let remainder = lower
        .strip_prefix("https://")
        .or_else(|| lower.strip_prefix("http://"))
        .ok_or_else(|| "Paste a public http or https product link.".to_string())?;
    let host_port = remainder.split('/').next().unwrap_or("").rsplit('@').next().unwrap_or("");
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
            .is_some_and(|_| host.split('.').nth(1).and_then(|value| value.parse::<u8>().ok()).is_some_and(|second| (16..=31).contains(&second)));
    if blocked {
        return Err("Only public product web links can be read.".to_string());
    }
    Ok(trimmed)
}

fn content_type(path: &str) -> &'static str {
    if path.ends_with(".js") { "text/javascript; charset=utf-8" }
    else if path.ends_with(".css") { "text/css; charset=utf-8" }
    else if path.ends_with(".html") { "text/html; charset=utf-8" }
    else if path.ends_with(".svg") { "image/svg+xml" }
    else if path.ends_with(".png") { "image/png" }
    else if path.ends_with(".ico") { "image/x-icon" }
    else if path.ends_with(".pdf") { "application/pdf" }
    else { "application/octet-stream" }
}

fn send_response(stream: &mut TcpStream, status: &str, content_type: &str, body: &[u8]) {
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(body);
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
    let parent_dist = std::env::current_dir().ok().and_then(|path| path.parent().map(|parent| parent.join("dist")));
    let executable_dir = std::env::current_exe().ok().and_then(|path| path.parent().map(|parent| parent.to_path_buf()));
    let executable_dist = executable_dir.as_ref().map(|path| path.join("dist"));
    let recursive_resource = resource_root.as_ref().and_then(|path| find_index_html(path, 4));
    [resource_root, resource_dist, current_dist, parent_dist, executable_dir, executable_dist, recursive_resource]
        .into_iter()
        .flatten()
        .find(|path| path.join("index.html").is_file())
}

fn body_from_request(stream: &mut TcpStream, initial: &[u8], headers: &str) -> Vec<u8> {
    let length = headers
        .lines()
        .find_map(|line| line.strip_prefix("Content-Length:").or_else(|| line.strip_prefix("content-length:")))
        .and_then(|value| value.trim().parse::<usize>().ok())
        .unwrap_or(0);
    let header_end = initial.windows(4).position(|window| window == b"\r\n\r\n").map(|index| index + 4).unwrap_or(initial.len());
    let mut body = initial.get(header_end..).unwrap_or(&[]).to_vec();
    while body.len() < length {
        let mut buffer = vec![0; length - body.len()];
        match stream.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(count) => body.extend_from_slice(&buffer[..count]),
        }
    }
    body.truncate(length);
    body
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
    let Some(first_line) = lines.next() else { return };
    let parts: Vec<&str> = first_line.split_whitespace().collect();
    if parts.len() < 2 {
        send_response(&mut stream, "400 Bad Request", "text/plain; charset=utf-8", b"Bad request");
        return;
    }
    let method = parts[0];
    let path = parts[1];

    let headers = request.split("\r\n\r\n").next().unwrap_or("");

    if path.starts_with("/api/state") {
        if !request_is_authorized(path, headers) {
            send_response(&mut stream, "401 Unauthorized", "text/plain; charset=utf-8", b"BuildBook access code is required.");
            return;
        }
        if method == "GET" {
            match read_app_state(app).and_then(|value| Ok(value.unwrap_or_else(|| "{}".to_string()))) {
                Ok(contents) => send_response(&mut stream, "200 OK", "application/json; charset=utf-8", contents.as_bytes()),
                Err(error) => send_response(&mut stream, "500 Internal Server Error", "text/plain; charset=utf-8", error.as_bytes()),
            }
            return;
        }
        if method == "POST" {
            let body = body_from_request(&mut stream, &buffer, headers);
            match write_app_state(app, String::from_utf8_lossy(&body).to_string()) {
                Ok(()) => send_response(&mut stream, "200 OK", "application/json; charset=utf-8", b"{\"ok\":true}"),
                Err(error) => send_response(&mut stream, "500 Internal Server Error", "text/plain; charset=utf-8", error.as_bytes()),
            }
            return;
        }
    }

    if path.starts_with("/api/files") {
        if !request_is_authorized(path, headers) {
            send_response(&mut stream, "401 Unauthorized", "text/plain; charset=utf-8", b"BuildBook access code is required.");
            return;
        }
        if method == "GET" {
            let file_path = query_value(path, "path");
            match read_file_bytes(file_path.clone()) {
                Ok(bytes) => send_response(&mut stream, "200 OK", content_type(&file_path), &bytes),
                Err(error) => send_response(&mut stream, "404 Not Found", "text/plain; charset=utf-8", error.as_bytes()),
            }
            return;
        }
        if method == "POST" {
            let body = body_from_request(&mut stream, &buffer, headers);
            let name = query_value(path, "name");
            let library = query_value(path, "library");
            match save_uploaded_file(app, name, library, body) {
                Ok(stored) => send_response(&mut stream, "200 OK", "application/json; charset=utf-8", serde_json::to_string(&stored).unwrap_or_default().as_bytes()),
                Err(error) => send_response(&mut stream, "500 Internal Server Error", "text/plain; charset=utf-8", error.as_bytes()),
            }
            return;
        }
        if method == "PUT" {
            let body = body_from_request(&mut stream, &buffer, headers);
            let file_path = query_value(path, "path");
            match overwrite_file_bytes(app, file_path, body) {
                Ok(stored) => send_response(&mut stream, "200 OK", "application/json; charset=utf-8", serde_json::to_string(&stored).unwrap_or_default().as_bytes()),
                Err(error) => send_response(&mut stream, "500 Internal Server Error", "text/plain; charset=utf-8", error.as_bytes()),
            }
            return;
        }
    }

    if path.starts_with("/api/download-url") {
        if !request_is_authorized(path, headers) {
            send_response(&mut stream, "401 Unauthorized", "text/plain; charset=utf-8", b"BuildBook access code is required.");
            return;
        }
        if method == "POST" {
            match download_url_to_file(app, query_value(path, "url"), query_value(path, "library"), query_value(path, "name")) {
                Ok(stored) => send_response(&mut stream, "200 OK", "application/json; charset=utf-8", serde_json::to_string(&stored).unwrap_or_default().as_bytes()),
                Err(error) => send_response(&mut stream, "502 Bad Gateway", "text/plain; charset=utf-8", error.as_bytes()),
            }
            return;
        }
    }

    if path.starts_with("/api/storage-scan") {
        if !request_is_authorized(path, headers) {
            send_response(&mut stream, "401 Unauthorized", "text/plain; charset=utf-8", b"BuildBook access code is required.");
            return;
        }
        if method == "POST" {
            let body = body_from_request(&mut stream, &buffer, headers);
            match serde_json::from_slice::<StorageScanRequest>(&body)
                .map_err(|error| format!("Invalid storage scan request: {error}"))
                .and_then(|request| scan_storage_inner(app, request.referenced_paths, request.delete_paths.unwrap_or_default()))
            {
                Ok(scan) => send_response(&mut stream, "200 OK", "application/json; charset=utf-8", serde_json::to_string(&scan).unwrap_or_default().as_bytes()),
                Err(error) => send_response(&mut stream, "500 Internal Server Error", "text/plain; charset=utf-8", error.as_bytes()),
            }
            return;
        }
    }

    if path.starts_with("/api/reset-storage") {
        if !request_is_authorized(path, headers) {
            send_response(&mut stream, "401 Unauthorized", "text/plain; charset=utf-8", b"BuildBook access code is required.");
            return;
        }
        if method == "POST" {
            match reset_managed_storage(app) {
                Ok(result) => send_response(&mut stream, "200 OK", "application/json; charset=utf-8", serde_json::to_string(&result).unwrap_or_default().as_bytes()),
                Err(error) => send_response(&mut stream, "500 Internal Server Error", "text/plain; charset=utf-8", error.as_bytes()),
            }
            return;
        }
    }

    let Some(dist) = dist_dir(&app) else {
        send_response(&mut stream, "503 Service Unavailable", "text/plain; charset=utf-8", b"BuildBook web files are not available. Run a production build first.");
        return;
    };
    let relative = path.split('?').next().unwrap_or("/").trim_start_matches('/');
    let safe_relative = if relative.is_empty() { "index.html" } else { relative };
    let target = dist.join(safe_library_path(safe_relative));
    let file_path = if target.is_file() { target } else { dist.join("index.html") };
    match std::fs::read(&file_path) {
        Ok(bytes) => send_response(&mut stream, "200 OK", content_type(file_path.to_string_lossy().as_ref()), &bytes),
        Err(_) => send_response(&mut stream, "404 Not Found", "text/plain; charset=utf-8", b"Not found"),
    }
}

#[tauri::command]
fn start_lan_server(app: tauri::AppHandle, port: u16, token: String, require_token: bool) -> Result<LanServerInfo, String> {
    if require_token && token.trim().is_empty() {
        return Err("LAN access code is missing.".to_string());
    }
    let mut guard = lan_mutex().lock().map_err(|_| "Could not lock LAN server state.".to_string())?;
    if let Some(server) = guard.as_ref() {
        if server.port == port && server.token == token && server.require_token == require_token {
            return Ok(LanServerInfo { running: true, url: server.url.clone(), port: server.port });
        }
        drop(guard);
        let _ = stop_lan_server();
        guard = lan_mutex().lock().map_err(|_| "Could not lock LAN server state.".to_string())?;
    }
    if let Some(server) = guard.as_ref() {
        return Ok(LanServerInfo { running: true, url: server.url.clone(), port: server.port });
    }

    let listener = TcpListener::bind(("0.0.0.0", port)).map_err(|error| format!("Could not start LAN server: {error}"))?;
    listener.set_nonblocking(true).map_err(|error| format!("Could not configure LAN server: {error}"))?;
    let stop = Arc::new(AtomicBool::new(false));
    let stop_thread = stop.clone();
    let app_thread = app.clone();
    let url = format!("http://{}:{}/", local_lan_ip(), port);
    let thread = std::thread::spawn(move || {
        while !stop_thread.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => serve_lan_request(app_thread.clone(), stream),
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(std::time::Duration::from_millis(80)),
                Err(_) => break,
            }
        }
    });

    *guard = Some(LanServerHandle { port, url: url.clone(), token, require_token, stop, thread: Some(thread) });
    Ok(LanServerInfo { running: true, url, port })
}

#[tauri::command]
fn stop_lan_server() -> Result<LanServerInfo, String> {
    let mut guard = lan_mutex().lock().map_err(|_| "Could not lock LAN server state.".to_string())?;
    if let Some(mut server) = guard.take() {
        server.stop.store(true, Ordering::Relaxed);
        let _ = TcpStream::connect(("127.0.0.1", server.port));
        if let Some(thread) = server.thread.take() {
            let _ = thread.join();
        }
    }
    Ok(LanServerInfo { running: false, url: String::new(), port: 0 })
}

#[tauri::command]
fn lan_server_status() -> Result<LanServerInfo, String> {
    let guard = lan_mutex().lock().map_err(|_| "Could not lock LAN server state.".to_string())?;
    if let Some(server) = guard.as_ref() {
        return Ok(LanServerInfo { running: true, url: server.url.clone(), port: server.port });
    }
    Ok(LanServerInfo { running: false, url: String::new(), port: 0 })
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

    std::fs::copy(&source, &target).map_err(|error| format!("Could not prepare editable file: {error}"))?;
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
        cmd.args(["-L", "--fail", "--silent", "--show-error"])
            .arg(&url)
            .args(["--output"])
            .arg(&target);
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    };

    #[cfg(not(target_os = "windows"))]
    let mut command = {
        let mut cmd = std::process::Command::new("curl");
        cmd.args(["-L", "--fail", "--silent", "--show-error"])
            .arg(&url)
            .args(["--output"])
            .arg(&target);
        cmd
    };

    let status = command
        .status()
        .map_err(|error| format!("Could not download file: {error}"))?;

    if !status.success() {
        let _ = std::fs::remove_file(&target);
        return Err("Could not download remote file.".to_string());
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

fn collect_folder_files(root: &std::path::Path, current: &std::path::Path, files: &mut Vec<LinkedFolderFile>) -> Result<(), String> {
    for entry in std::fs::read_dir(current).map_err(|error| format!("Could not read folder: {error}"))? {
        let entry = entry.map_err(|error| format!("Could not read folder entry: {error}"))?;
        let path = entry.path();
        if path.is_dir() {
            collect_folder_files(root, &path, files)?;
        } else if path.is_file() {
            let relative_path = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
            files.push(LinkedFolderFile {
                name: path.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_else(|| relative_path.clone()),
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

fn collect_storage_files(current: &std::path::Path, files: &mut Vec<std::path::PathBuf>) -> Result<(), String> {
    if !current.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(current).map_err(|error| format!("Could not scan storage: {error}"))? {
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
        .find_map(|root| path.strip_prefix(root).ok().map(|value| value.to_string_lossy().replace('\\', "/")))
        .unwrap_or_else(|| path.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default())
}

fn canonical_under_roots(path: &str, roots: &[std::path::PathBuf]) -> Option<std::path::PathBuf> {
    let canonical = std::fs::canonicalize(path.trim_matches('"')).ok()?;
    let lower = canonical.to_string_lossy().to_lowercase();
    let allowed = roots.iter().filter_map(|root| std::fs::canonicalize(root).ok()).any(|root| {
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

fn scan_storage_inner(app: tauri::AppHandle, referenced_paths: Vec<String>, delete_paths: Vec<String>) -> Result<StorageScan, String> {
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
        let canonical = std::fs::canonicalize(&file).unwrap_or(file.clone()).to_string_lossy().to_lowercase();
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
            name: file.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default(),
            path: file.to_string_lossy().to_string(),
            relative_path: storage_relative_path(&roots, &file),
            size,
            modified_at: modified_millis(&file),
        });
    }
    Ok(result)
}

#[tauri::command]
fn scan_storage(app: tauri::AppHandle, referenced_paths: Vec<String>) -> Result<StorageScan, String> {
    scan_storage_inner(app, referenced_paths, Vec::new())
}

#[tauri::command]
fn cleanup_orphaned_files(app: tauri::AppHandle, referenced_paths: Vec<String>, delete_paths: Vec<String>) -> Result<StorageScan, String> {
    scan_storage_inner(app, referenced_paths, delete_paths)
}

#[tauri::command]
fn delete_managed_files(app: tauri::AppHandle, paths: Vec<String>) -> Result<DeleteManagedFilesResult, String> {
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
    Ok(DeleteManagedFilesResult { deleted_paths, failed_paths })
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
