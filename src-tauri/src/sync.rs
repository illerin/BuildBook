pub(crate) fn sync_config_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
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
    last_sync_attempt_at: u64,
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
            last_sync_attempt_at: 0,
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
    browser_enabled: bool,
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

fn append_sync_device_query(endpoint: &mut reqwest::Url, config: &SyncConfig) {
    if !config.client_auth_token.trim().is_empty() {
        endpoint
            .query_pairs_mut()
            .append_pair("device", &config.device_id);
    }
}

fn sync_endpoint(config: &SyncConfig, path: &str) -> Result<reqwest::Url, String> {
    let host_url = normalized_host_url(&config.host_url)?;
    let mut endpoint = reqwest::Url::parse(&format!("{host_url}{path}"))
        .map_err(|error| format!("Could not create host sync address: {error}"))?;
    append_sync_device_query(&mut endpoint, config);
    Ok(endpoint)
}

pub(crate) fn sync_base_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let path = sync_config_path(app)?;
    Ok(path.with_file_name("buildbook-sync-base.json"))
}

pub(crate) fn sync_conflict_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
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
        return "Host returned 502 Bad Gateway. The BuildBook host or proxy is not reachable."
            .to_string();
    }
    if status.as_u16() == 503 {
        return "Host returned 503 Service Unavailable. The BuildBook host may be stopped."
            .to_string();
    }
    if text.trim().is_empty() {
        format!("BuildBook host returned {status} {context}.")
    } else {
        text.chars().take(220).collect()
    }
}

fn host_sync_get(config: &SyncConfig) -> Result<SyncStateEnvelope, String> {
    let endpoint = sync_endpoint(config, "/api/sync/state")?;
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_millis(1200))
        .timeout(std::time::Duration::from_secs(4))
        .build()
        .map_err(|error| format!("Could not prepare host connection: {error}"))?;
    let response = client
        .get(endpoint)
        .header("X-BuildBook-Request", "1")
        .header(auth_header_name(config), client_auth_header(config))
        .send()
        .map_err(|error| format!("Could not reach BuildBook host: {error}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let message = response.text().unwrap_or_default();
        return Err(compact_host_error(
            status,
            message,
            "while loading sync state",
        ));
    }
    response
        .json::<SyncStateEnvelope>()
        .map_err(|error| format!("Host sync response was invalid: {error}"))
}

fn host_sync_revision(config: &SyncConfig) -> Result<String, String> {
    let endpoint = sync_endpoint(config, "/api/sync/revision")?;
    let response = reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_millis(1200))
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|error| format!("Could not prepare host connection: {error}"))?
        .get(endpoint)
        .header("X-BuildBook-Request", "1")
        .header(auth_header_name(config), client_auth_header(config))
        .send()
        .map_err(|error| format!("Could not reach BuildBook host: {error}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let message = response.text().unwrap_or_default();
        return Err(compact_host_error(
            status,
            message,
            "while checking sync revision",
        ));
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
    let endpoint = sync_endpoint(config, "/api/sync/state")?;
    let state = serde_json::from_str::<serde_json::Value>(contents)
        .map_err(|error| format!("App state is not valid JSON: {error}"))?;
    let request = SyncStateWriteRequest {
        base_revision: config.host_revision.clone(),
        device_id: config.device_id.clone(),
        contents: state,
        force: Some(force),
    };
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_millis(1200))
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|error| format!("Could not prepare host connection: {error}"))?;
    let response = client
        .post(endpoint)
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
        return Err(compact_host_error(
            status,
            message,
            "while saving sync state",
        ));
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
    config.last_sync_attempt_at = 0;
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

fn host_retry_on_cooldown(config: &SyncConfig) -> bool {
    config.pending_sync
        && !config.last_sync_error.trim().is_empty()
        && now_seconds().saturating_sub(config.last_sync_attempt_at) < HOST_RETRY_COOLDOWN_SECONDS
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
        ) if path.starts_with("projects[")
            && (path.ends_with(".notes")
                || (path.contains(".noteSheets[") && path.ends_with(".content"))) =>
        {
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
        (
            "projects",
            value
                .get("projects")
                .and_then(|items| items.as_array())
                .map(|items| items.len()),
        ),
        (
            "parts",
            value
                .get("parts")
                .and_then(|items| items.as_array())
                .map(|items| items.len()),
        ),
        (
            "files",
            value
                .get("files")
                .and_then(|items| items.as_array())
                .map(|items| items.len()),
        ),
        (
            "photos",
            value
                .get("photoFolders")
                .and_then(|items| items.as_array())
                .map(|items| items.len()),
        ),
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
        apply_conflict_value(
            &mut host_safe,
            &item.path,
            value_at_conflict_path(&host, &item.path),
        );
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
    let base_contents =
        std::fs::read_to_string(sync_base_path(&app)?).unwrap_or_else(|_| "{}".to_string());
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
        HostSyncWrite::Conflict(_) => {
            Err("The host changed again while resolving the conflict. Try again.".to_string())
        }
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
                message:
                    "Resolve the synchronization conflict before full synchronization can continue."
                        .to_string(),
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
    if host_retry_on_cooldown(&config) {
        save_sync_config(&app, &config)?;
        return Ok(ClientSyncResult {
            contents,
            status: "offline".to_string(),
            revision: config.host_revision,
            pending: true,
            message: format!(
                "Saved locally. Host retry paused briefly: {}",
                config.last_sync_error
            ),
        });
    }
    config.last_sync_attempt_at = now_seconds();
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
        .connect_timeout(std::time::Duration::from_millis(1200))
        .timeout(std::time::Duration::from_secs(20))
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
        .connect_timeout(std::time::Duration::from_millis(1200))
        .timeout(std::time::Duration::from_secs(45))
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
    open_file_path_inner(&target)?;
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
fn discover_buildbook_hosts(
    app: tauri::AppHandle,
    port: u16,
) -> Result<Vec<BuildBookHostInfo>, String> {
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
        let notes = merged["projects"][0]["noteSheets"][0]["content"]
            .as_str()
            .unwrap_or_default();
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
