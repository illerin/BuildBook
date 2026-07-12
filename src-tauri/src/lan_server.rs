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

#[derive(Clone, Copy)]
struct WebLoginAttempt {
    failed_attempts: u32,
    locked_until: u64,
    last_attempt: u64,
}

static WEB_LOGIN_ATTEMPTS: OnceLock<Mutex<HashMap<String, WebLoginAttempt>>> = OnceLock::new();

fn web_login_attempts() -> &'static Mutex<HashMap<String, WebLoginAttempt>> {
    WEB_LOGIN_ATTEMPTS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn login_source(stream: &TcpStream) -> String {
    stream
        .peer_addr()
        .map(|address| address.ip().to_string())
        .unwrap_or_else(|_| "unknown".to_string())
}

fn web_login_locked(source: &str) -> bool {
    let now = now_seconds();
    let Ok(mut attempts) = web_login_attempts().lock() else {
        return true;
    };
    attempts.retain(|_, attempt| now.saturating_sub(attempt.last_attempt) <= 15 * 60);
    attempts
        .get(source)
        .is_some_and(|attempt| attempt.locked_until > now)
}

fn record_web_login_failure(source: &str) {
    let now = now_seconds();
    let Ok(mut attempts) = web_login_attempts().lock() else {
        return;
    };
    attempts.retain(|_, attempt| now.saturating_sub(attempt.last_attempt) <= 15 * 60);
    if attempts.len() >= 1024 && !attempts.contains_key(source) {
        return;
    }
    let attempt = attempts.entry(source.to_string()).or_insert(WebLoginAttempt {
        failed_attempts: 0,
        locked_until: 0,
        last_attempt: now,
    });
    attempt.failed_attempts = attempt.failed_attempts.saturating_add(1);
    attempt.last_attempt = now;
    if attempt.failed_attempts >= 5 {
        attempt.failed_attempts = 0;
        attempt.locked_until = now + 5 * 60;
    }
}

fn clear_web_login_failures(source: &str) {
    if let Ok(mut attempts) = web_login_attempts().lock() {
        attempts.remove(source);
    }
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
        || !header_value(headers, "X-BuildBook-Device-Token")
            .trim()
            .is_empty()
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

fn blocked_public_fetch_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(value) => {
            value.is_private()
                || value.is_loopback()
                || value.is_link_local()
                || value.is_broadcast()
                || value.is_multicast()
                || value.is_unspecified()
        }
        IpAddr::V6(value) => {
            value.is_loopback()
                || value.is_multicast()
                || value.is_unspecified()
                || value.is_unique_local()
                || value.is_unicast_link_local()
        }
    }
}

struct ValidatedPublicWebUrl {
    url: String,
    hostname: Option<String>,
    addresses: Vec<SocketAddr>,
}

fn validate_public_web_url(url: &str) -> Result<ValidatedPublicWebUrl, String> {
    let trimmed = url.trim();
    let parsed = reqwest::Url::parse(trimmed)
        .map_err(|_| "Paste a public http or https product link.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.cannot_be_a_base() {
        return Err("Paste a public http or https product link.".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Product links with embedded credentials are not allowed.".to_string());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "Paste a public http or https product link.".to_string())?;
    if host.eq_ignore_ascii_case("localhost") {
        return Err("Only public product web links can be read.".to_string());
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        if blocked_public_fetch_ip(ip) {
            return Err("Only public product web links can be read.".to_string());
        }
        return Ok(ValidatedPublicWebUrl {
            url: trimmed.to_string(),
            hostname: None,
            addresses: Vec::new(),
        });
    }

    let port = parsed
        .port_or_known_default()
        .ok_or_else(|| "Paste a public http or https product link.".to_string())?;
    let addresses = (host, port)
        .to_socket_addrs()
        .map_err(|_| "Could not resolve that product link.".to_string())?
        .collect::<Vec<_>>();
    if addresses.is_empty()
        || addresses
            .iter()
            .any(|address| blocked_public_fetch_ip(address.ip()))
    {
        return Err("Only public product web links can be read.".to_string());
    }
    Ok(ValidatedPublicWebUrl {
        url: trimmed.to_string(),
        hostname: Some(host.to_string()),
        addresses,
    })
}

fn collect_state_file_paths(value: &serde_json::Value, paths: &mut HashSet<String>) {
    const PATH_KEYS: &[&str] = &[
        "baselinePath",
        "image",
        "imageThumbnail",
        "markupPath",
        "markupThumbnailPath",
        "path",
        "sourcePath",
        "thumbnailPath",
    ];

    match value {
        serde_json::Value::Object(map) => {
            for (key, child) in map {
                if PATH_KEYS.contains(&key.as_str()) {
                    if let Some(path) = child
                        .as_str()
                        .map(str::trim)
                        .filter(|path| !path.is_empty())
                    {
                        if let Ok(canonical) = std::fs::canonicalize(path.trim_matches('"')) {
                            paths.insert(canonical.to_string_lossy().to_lowercase());
                        }
                    }
                }
                collect_state_file_paths(child, paths);
            }
        }
        serde_json::Value::Array(items) => {
            for child in items {
                collect_state_file_paths(child, paths);
            }
        }
        _ => {}
    }
}

fn file_api_path_allowed(app: &tauri::AppHandle, path: &str) -> bool {
    let Ok(canonical) = std::fs::canonicalize(path.trim_matches('"')) else {
        return false;
    };
    if storage_roots(app)
        .ok()
        .and_then(|roots| canonical_under_roots(path, &roots))
        .is_some()
    {
        return true;
    }

    let Ok(state_path) = state_file_path(app) else {
        return false;
    };
    let Ok(contents) = std::fs::read_to_string(state_path) else {
        return false;
    };
    let Ok(state) = serde_json::from_str::<serde_json::Value>(&contents) else {
        return false;
    };
    let mut referenced = HashSet::new();
    collect_state_file_paths(&state, &mut referenced);
    referenced.contains(&canonical.to_string_lossy().to_lowercase())
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

fn handle_web_login(stream: &mut TcpStream, body: &[u8], headers: &str, source: &str) {
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
    if web_login_locked(source) {
        send_response(
            stream,
            "429 Too Many Requests",
            "text/plain; charset=utf-8",
            b"Too many failed login attempts. Try again in a few minutes.",
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
        record_web_login_failure(source);
        send_response(
            stream,
            "401 Unauthorized",
            "text/plain; charset=utf-8",
            b"Invalid BuildBook username or password.",
        );
        return;
    }
    clear_web_login_failures(source);
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

fn current_lan_url() -> String {
    lan_mutex()
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|server| server.url.clone()))
        .unwrap_or_default()
}

fn request_body_or_bad_request(
    stream: &mut TcpStream,
    initial: &[u8],
    headers: &str,
) -> Option<Vec<u8>> {
    match request_body(stream, initial, headers) {
        Ok(body) => Some(body),
        Err(error) => {
            send_response(
                stream,
                "400 Bad Request",
                "text/plain; charset=utf-8",
                error.as_bytes(),
            );
            None
        }
    }
}

fn handle_lan_info_routes(
    app: &tauri::AppHandle,
    path: &str,
    headers: &str,
    stream: &mut TcpStream,
) -> bool {
    if path.starts_with("/api/discovery") {
        let host_config = load_sync_config(app).unwrap_or_default();
        if host_config.mode != "host" {
            send_response(
                stream,
                "404 Not Found",
                "text/plain; charset=utf-8",
                b"BuildBook host mode is not enabled.",
            );
            return true;
        }
        let body = serde_json::to_vec(&host_info(app, current_lan_url()))
            .unwrap_or_else(|_| b"{}".to_vec());
        send_response(stream, "200 OK", "application/json; charset=utf-8", &body);
        return true;
    }

    if path.starts_with("/api/host-info") {
        if let Some(error) = request_token_error(path, headers) {
            send_response(
                stream,
                "401 Unauthorized",
                "text/plain; charset=utf-8",
                error.as_bytes(),
            );
            return true;
        }
        let body = serde_json::to_vec(&host_info(app, current_lan_url()))
            .unwrap_or_else(|_| b"{}".to_vec());
        send_response(stream, "200 OK", "application/json; charset=utf-8", &body);
        return true;
    }

    if path.starts_with("/api/auth-status") {
        send_web_auth_status(stream, headers);
        return true;
    }

    false
}

fn handle_web_session_routes(
    method: &str,
    path: &str,
    headers: &str,
    initial: &[u8],
    stream: &mut TcpStream,
) -> bool {
    if path.starts_with("/api/login") {
        if method == "POST" {
            if !request_has_app_header(headers) {
                send_response(
                    stream,
                    "401 Unauthorized",
                    "text/plain; charset=utf-8",
                    b"BuildBook request header is required.",
                );
                return true;
            }
            let Some(body) = request_body_or_bad_request(stream, initial, headers) else {
                return true;
            };
            let source = login_source(stream);
            handle_web_login(stream, &body, headers, &source);
            return true;
        }
        return false;
    }

    if path.starts_with("/api/logout") {
        if method == "POST" {
            if !request_has_app_header(headers) {
                send_response(
                    stream,
                    "401 Unauthorized",
                    "text/plain; charset=utf-8",
                    b"BuildBook request header is required.",
                );
                return true;
            }
            handle_web_logout(stream);
            return true;
        }
    }

    false
}

fn handle_lan_sync_pair_route(
    app: &tauri::AppHandle,
    method: &str,
    path: &str,
    headers: &str,
    initial: &[u8],
    stream: &mut TcpStream,
) -> bool {
    if !path.starts_with("/api/sync/pair") {
        return false;
    }
    let mut host_config = load_sync_config(app).unwrap_or_default();
    if host_config.mode != "host" {
        send_response(
            stream,
            "409 Conflict",
            "text/plain; charset=utf-8",
            b"This BuildBook installation is not configured as the authoritative host.",
        );
        return true;
    }
    if method != "POST" {
        return true;
    }
    let now = now_seconds();
    if host_config.pairing_locked_until > now {
        send_response(stream, "429 Too Many Requests", "text/plain; charset=utf-8", b"Pairing is temporarily locked after too many failed attempts. Generate a new code or wait 5 minutes.");
        return true;
    }
    let Some(body) = request_body_or_bad_request(stream, initial, headers) else {
        return true;
    };
    let request = match serde_json::from_slice::<PairDeviceRequest>(&body) {
        Ok(request) => request,
        Err(error) => {
            send_response(
                stream,
                "400 Bad Request",
                "text/plain; charset=utf-8",
                format!("Invalid pairing request: {error}").as_bytes(),
            );
            return true;
        }
    };
    if host_config.pairing_code.trim().is_empty()
        || host_config.pairing_code_expires_at < now_seconds()
        || request.pairing_code.trim() != host_config.pairing_code
    {
        host_config.pairing_failed_attempts = host_config.pairing_failed_attempts.saturating_add(1);
        if host_config.pairing_failed_attempts >= 5 {
            host_config.pairing_locked_until = now_seconds() + 5 * 60;
            host_config.pairing_code.clear();
            host_config.pairing_code_expires_at = 0;
            host_config.pairing_failed_attempts = 0;
        }
        let _ = save_sync_config(app, &host_config);
        send_response(
            stream,
            "401 Unauthorized",
            "text/plain; charset=utf-8",
            b"Pairing code is invalid or expired.",
        );
        return true;
    }
    if request.device_id.trim().is_empty() {
        send_response(
            stream,
            "400 Bad Request",
            "text/plain; charset=utf-8",
            b"Pairing request is missing a device id.",
        );
        return true;
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
    if let Err(error) = save_sync_config(app, &host_config) {
        send_response(
            stream,
            "500 Internal Server Error",
            "text/plain; charset=utf-8",
            error.as_bytes(),
        );
        return true;
    }
    let response = PairDeviceResponse {
        host: host_info(app, current_lan_url()),
        device_token,
    };
    send_response(
        stream,
        "200 OK",
        "application/json; charset=utf-8",
        serde_json::to_string(&response)
            .unwrap_or_default()
            .as_bytes(),
    );
    true
}

fn handle_lan_sync_checkout_route(
    app: &tauri::AppHandle,
    method: &str,
    path: &str,
    headers: &str,
    initial: &[u8],
    stream: &mut TcpStream,
) -> bool {
    if !path.starts_with("/api/sync/checkout") {
        return false;
    }
    if let Some(error) = request_sync_auth_error(app, path, headers) {
        send_response(
            stream,
            "401 Unauthorized",
            "text/plain; charset=utf-8",
            error.as_bytes(),
        );
        return true;
    }
    let host_config = load_sync_config(app).unwrap_or_default();
    if host_config.mode != "host" {
        send_response(
            stream,
            "409 Conflict",
            "text/plain; charset=utf-8",
            b"This BuildBook installation is not configured as the authoritative host.",
        );
        return true;
    }
    if method != "POST" {
        return true;
    }
    let Some(body) = request_body_or_bad_request(stream, initial, headers) else {
        return true;
    };
    match serde_json::from_slice::<FileCheckoutRequest>(&body)
        .map_err(|error| format!("Invalid checkout request: {error}"))
        .and_then(apply_file_checkout)
    {
        Ok(result) => send_response(
            stream,
            "200 OK",
            "application/json; charset=utf-8",
            serde_json::to_string(&result)
                .unwrap_or_default()
                .as_bytes(),
        ),
        Err(error) => send_response(
            stream,
            "400 Bad Request",
            "text/plain; charset=utf-8",
            error.as_bytes(),
        ),
    }
    true
}

fn ensure_host_sync_route(
    app: &tauri::AppHandle,
    path: &str,
    headers: &str,
    stream: &mut TcpStream,
) -> bool {
    if let Some(error) = request_sync_auth_error(app, path, headers) {
        send_response(
            stream,
            "401 Unauthorized",
            "text/plain; charset=utf-8",
            error.as_bytes(),
        );
        return false;
    }
    let host_config = load_sync_config(app).unwrap_or_default();
    if host_config.mode != "host" {
        send_response(
            stream,
            "409 Conflict",
            "text/plain; charset=utf-8",
            b"This BuildBook installation is not configured as the authoritative host.",
        );
        return false;
    }
    true
}

fn handle_lan_sync_revision_route(
    app: &tauri::AppHandle,
    method: &str,
    path: &str,
    headers: &str,
    stream: &mut TcpStream,
) -> bool {
    if !path.starts_with("/api/sync/revision") {
        return false;
    }
    if !ensure_host_sync_route(app, path, headers, stream) {
        return true;
    }
    if method == "GET" {
        match read_app_state(app.clone()) {
            Ok(contents) => {
                let contents = contents.unwrap_or_else(|| "{}".to_string());
                match state_revision(&contents) {
                    Ok(revision) => send_response(
                        stream,
                        "200 OK",
                        "text/plain; charset=utf-8",
                        revision.as_bytes(),
                    ),
                    Err(error) => send_response(
                        stream,
                        "500 Internal Server Error",
                        "text/plain; charset=utf-8",
                        error.as_bytes(),
                    ),
                }
            }
            Err(error) => send_response(
                stream,
                "500 Internal Server Error",
                "text/plain; charset=utf-8",
                error.as_bytes(),
            ),
        }
    }
    true
}

fn handle_lan_sync_state_route(
    app: &tauri::AppHandle,
    method: &str,
    path: &str,
    headers: &str,
    initial: &[u8],
    stream: &mut TcpStream,
) -> bool {
    if !path.starts_with("/api/sync/state") {
        return false;
    }
    if !ensure_host_sync_route(app, path, headers, stream) {
        return true;
    }
    if method == "GET" {
        let contents = match read_app_state(app.clone()) {
            Ok(value) => value.unwrap_or_else(|| "{}".to_string()),
            Err(error) => {
                send_response(
                    stream,
                    "500 Internal Server Error",
                    "text/plain; charset=utf-8",
                    error.as_bytes(),
                );
                return true;
            }
        };
        let state = match serde_json::from_str::<serde_json::Value>(&contents) {
            Ok(state) => state,
            Err(error) => {
                send_response(
                    stream,
                    "500 Internal Server Error",
                    "text/plain; charset=utf-8",
                    format!("Host state is invalid: {error}").as_bytes(),
                );
                return true;
            }
        };
        let envelope = SyncStateEnvelope {
            revision: state_revision(&contents).unwrap_or_default(),
            contents: state,
        };
        let body = serde_json::to_vec(&envelope).unwrap_or_default();
        send_response(stream, "200 OK", "application/json; charset=utf-8", &body);
        return true;
    }
    if method == "POST" {
        let Some(body) = request_body_or_bad_request(stream, initial, headers) else {
            return true;
        };
        let request = match serde_json::from_slice::<SyncStateWriteRequest>(&body) {
            Ok(request) => request,
            Err(error) => {
                send_response(
                    stream,
                    "400 Bad Request",
                    "text/plain; charset=utf-8",
                    format!("Invalid sync request: {error}").as_bytes(),
                );
                return true;
            }
        };
        if request.device_id.trim().is_empty() {
            send_response(
                stream,
                "400 Bad Request",
                "text/plain; charset=utf-8",
                b"Sync request is missing a device id.",
            );
            return true;
        }
        let _guard = match state_write_lock().lock() {
            Ok(guard) => guard,
            Err(_) => {
                send_response(
                    stream,
                    "500 Internal Server Error",
                    "text/plain; charset=utf-8",
                    b"Could not lock BuildBook state.",
                );
                return true;
            }
        };
        let current_contents = match read_app_state(app.clone()) {
            Ok(value) => value.unwrap_or_else(|| "{}".to_string()),
            Err(error) => {
                send_response(
                    stream,
                    "500 Internal Server Error",
                    "text/plain; charset=utf-8",
                    error.as_bytes(),
                );
                return true;
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
                stream,
                "409 Conflict",
                "application/json; charset=utf-8",
                &response,
            );
            return true;
        }
        let next_contents = match serde_json::to_string_pretty(&request.contents) {
            Ok(contents) => contents,
            Err(error) => {
                send_response(
                    stream,
                    "400 Bad Request",
                    "text/plain; charset=utf-8",
                    format!("Could not encode sync state: {error}").as_bytes(),
                );
                return true;
            }
        };
        if let Err(error) = write_app_state_inner(app, &next_contents) {
            send_response(
                stream,
                "500 Internal Server Error",
                "text/plain; charset=utf-8",
                error.as_bytes(),
            );
            return true;
        }
        let envelope = SyncStateEnvelope {
            revision: state_revision(&next_contents).unwrap_or_default(),
            contents: request.contents,
        };
        let response = serde_json::to_vec(&envelope).unwrap_or_default();
        send_response(
            stream,
            "200 OK",
            "application/json; charset=utf-8",
            &response,
        );
    }
    true
}

fn handle_lan_state_route(
    app: &tauri::AppHandle,
    method: &str,
    path: &str,
    headers: &str,
    initial: &[u8],
    stream: &mut TcpStream,
) -> bool {
    if !path.starts_with("/api/state") {
        return false;
    }
    if let Some(error) = request_auth_error(method, path, headers) {
        send_response(
            stream,
            "401 Unauthorized",
            "text/plain; charset=utf-8",
            error.as_bytes(),
        );
        return true;
    }
    if method == "GET" {
        match read_app_state(app.clone()).map(|value| value.unwrap_or_else(|| "{}".to_string())) {
            Ok(contents) => send_response(
                stream,
                "200 OK",
                "application/json; charset=utf-8",
                contents.as_bytes(),
            ),
            Err(error) => send_response(
                stream,
                "500 Internal Server Error",
                "text/plain; charset=utf-8",
                error.as_bytes(),
            ),
        }
        return true;
    }
    if method == "POST" {
        let Some(body) = request_body_or_bad_request(stream, initial, headers) else {
            return true;
        };
        let contents = match String::from_utf8(body) {
            Ok(contents) => contents,
            Err(error) => {
                let message = format!("App state request was not valid UTF-8: {error}");
                send_response(
                    stream,
                    "400 Bad Request",
                    "text/plain; charset=utf-8",
                    message.as_bytes(),
                );
                return true;
            }
        };
        match write_app_state(app.clone(), contents) {
            Ok(()) => send_response(
                stream,
                "200 OK",
                "application/json; charset=utf-8",
                b"{\"ok\":true}",
            ),
            Err(error) => send_response(
                stream,
                "500 Internal Server Error",
                "text/plain; charset=utf-8",
                error.as_bytes(),
            ),
        }
        return true;
    }
    false
}

fn handle_lan_file_route(
    app: &tauri::AppHandle,
    method: &str,
    path: &str,
    headers: &str,
    initial: &[u8],
    stream: &mut TcpStream,
) -> bool {
    if !path.starts_with("/api/files") {
        return false;
    }
    if let Some(error) = request_file_auth_error(app, method, path, headers) {
        send_response(
            stream,
            "401 Unauthorized",
            "text/plain; charset=utf-8",
            error.as_bytes(),
        );
        return true;
    }
    if method == "GET" {
        let file_path = query_value(path, "path");
        if !file_api_path_allowed(app, &file_path) {
            send_response(
                stream,
                "403 Forbidden",
                "text/plain; charset=utf-8",
                b"File access is not allowed for this path.",
            );
            return true;
        }
        match read_file_bytes(app.clone(), file_path.clone()) {
            Ok(bytes) => send_response(stream, "200 OK", content_type(&file_path), &bytes),
            Err(error) => send_response(
                stream,
                "404 Not Found",
                "text/plain; charset=utf-8",
                error.as_bytes(),
            ),
        }
        return true;
    }
    if method == "POST" {
        let Some(body) = request_body_or_bad_request(stream, initial, headers) else {
            return true;
        };
        let name = query_value(path, "name");
        let library = query_value(path, "library");
        match save_uploaded_file(app.clone(), name, library, body) {
            Ok(stored) => send_response(
                stream,
                "200 OK",
                "application/json; charset=utf-8",
                serde_json::to_string(&stored)
                    .unwrap_or_default()
                    .as_bytes(),
            ),
            Err(error) => send_response(
                stream,
                "500 Internal Server Error",
                "text/plain; charset=utf-8",
                error.as_bytes(),
            ),
        }
        return true;
    }
    if method == "PUT" {
        let Some(body) = request_body_or_bad_request(stream, initial, headers) else {
            return true;
        };
        let file_path = query_value(path, "path");
        if !file_api_path_allowed(app, &file_path) {
            send_response(
                stream,
                "403 Forbidden",
                "text/plain; charset=utf-8",
                b"File access is not allowed for this path.",
            );
            return true;
        }
        match overwrite_file_bytes(app.clone(), file_path, body) {
            Ok(stored) => send_response(
                stream,
                "200 OK",
                "application/json; charset=utf-8",
                serde_json::to_string(&stored)
                    .unwrap_or_default()
                    .as_bytes(),
            ),
            Err(error) => send_response(
                stream,
                "500 Internal Server Error",
                "text/plain; charset=utf-8",
                error.as_bytes(),
            ),
        }
        return true;
    }
    if method == "DELETE" {
        let Some(body) = request_body_or_bad_request(stream, initial, headers) else {
            return true;
        };
        let paths = match serde_json::from_slice::<Vec<String>>(&body) {
            Ok(paths) => paths,
            Err(error) => {
                send_response(
                    stream,
                    "400 Bad Request",
                    "text/plain; charset=utf-8",
                    format!("Invalid file delete request: {error}").as_bytes(),
                );
                return true;
            }
        };
        match delete_managed_files(app.clone(), paths) {
            Ok(result) => send_response(
                stream,
                "200 OK",
                "application/json; charset=utf-8",
                serde_json::to_string(&result)
                    .unwrap_or_default()
                    .as_bytes(),
            ),
            Err(error) => send_response(
                stream,
                "500 Internal Server Error",
                "text/plain; charset=utf-8",
                error.as_bytes(),
            ),
        }
        return true;
    }
    false
}

fn handle_lan_download_url_route(
    app: &tauri::AppHandle,
    method: &str,
    path: &str,
    headers: &str,
    stream: &mut TcpStream,
) -> bool {
    if !path.starts_with("/api/download-url") {
        return false;
    }
    if let Some(error) = request_file_auth_error(app, method, path, headers) {
        send_response(
            stream,
            "401 Unauthorized",
            "text/plain; charset=utf-8",
            error.as_bytes(),
        );
        return true;
    }
    if method == "POST" {
        match download_url_to_file(
            app.clone(),
            query_value(path, "url"),
            query_value(path, "library"),
            query_value(path, "name"),
        ) {
            Ok(stored) => send_response(
                stream,
                "200 OK",
                "application/json; charset=utf-8",
                serde_json::to_string(&stored)
                    .unwrap_or_default()
                    .as_bytes(),
            ),
            Err(error) => send_response(
                stream,
                "502 Bad Gateway",
                "text/plain; charset=utf-8",
                error.as_bytes(),
            ),
        }
        return true;
    }
    false
}

fn handle_lan_storage_routes(
    app: &tauri::AppHandle,
    method: &str,
    path: &str,
    headers: &str,
    initial: &[u8],
    stream: &mut TcpStream,
) -> bool {
    if path.starts_with("/api/storage-scan") {
        if let Some(error) = request_auth_error(method, path, headers) {
            send_response(
                stream,
                "401 Unauthorized",
                "text/plain; charset=utf-8",
                error.as_bytes(),
            );
            return true;
        }
        if method == "POST" {
            let Some(body) = request_body_or_bad_request(stream, initial, headers) else {
                return true;
            };
            match serde_json::from_slice::<StorageScanRequest>(&body)
                .map_err(|error| format!("Invalid storage scan request: {error}"))
                .and_then(|request| {
                    scan_storage_inner(
                        app.clone(),
                        request.referenced_paths,
                        request.delete_paths.unwrap_or_default(),
                    )
                }) {
                Ok(scan) => send_response(
                    stream,
                    "200 OK",
                    "application/json; charset=utf-8",
                    serde_json::to_string(&scan).unwrap_or_default().as_bytes(),
                ),
                Err(error) => send_response(
                    stream,
                    "500 Internal Server Error",
                    "text/plain; charset=utf-8",
                    error.as_bytes(),
                ),
            }
            return true;
        }
    }

    if path.starts_with("/api/reset-storage") {
        if let Some(error) = request_auth_error(method, path, headers) {
            send_response(
                stream,
                "401 Unauthorized",
                "text/plain; charset=utf-8",
                error.as_bytes(),
            );
            return true;
        }
        if method == "POST" {
            match reset_managed_storage(app.clone()) {
                Ok(result) => send_response(
                    stream,
                    "200 OK",
                    "application/json; charset=utf-8",
                    serde_json::to_string(&result)
                        .unwrap_or_default()
                        .as_bytes(),
                ),
                Err(error) => send_response(
                    stream,
                    "500 Internal Server Error",
                    "text/plain; charset=utf-8",
                    error.as_bytes(),
                ),
            }
            return true;
        }
    }

    false
}

fn serve_lan_static_request(app: &tauri::AppHandle, path: &str, stream: &mut TcpStream) {
    let browser_enabled = lan_mutex()
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|server| server.browser_enabled))
        .unwrap_or(false);
    if !browser_enabled {
        send_response(
            stream,
            "403 Forbidden",
            "text/plain; charset=utf-8",
            b"BuildBook browser access is disabled on this host.",
        );
        return;
    }

    let Some(dist) = dist_dir(app) else {
        send_response(
            stream,
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
        Ok(bytes) => send_response_with_headers(
            stream,
            "200 OK",
            content_type(file_path.to_string_lossy().as_ref()),
            &bytes,
            &[if file_path.extension().is_some_and(|extension| extension != "html") {
                "Cache-Control: public, max-age=31536000, immutable".to_string()
            } else {
                "Cache-Control: no-cache".to_string()
            }],
        ),
        Err(_) => send_response(
            stream,
            "404 Not Found",
            "text/plain; charset=utf-8",
            b"Not found",
        ),
    }
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

    if handle_lan_info_routes(&app, path, headers, &mut stream) {
        return;
    }

    if handle_lan_sync_pair_route(&app, method, path, headers, &buffer, &mut stream) {
        return;
    }

    if handle_lan_sync_checkout_route(&app, method, path, headers, &buffer, &mut stream) {
        return;
    }

    if handle_lan_sync_revision_route(&app, method, path, headers, &mut stream) {
        return;
    }

    if handle_lan_sync_state_route(&app, method, path, headers, &buffer, &mut stream) {
        return;
    }

    if handle_web_session_routes(method, path, headers, &buffer, &mut stream) {
        return;
    }

    if handle_lan_state_route(&app, method, path, headers, &buffer, &mut stream) {
        return;
    }

    if handle_lan_file_route(&app, method, path, headers, &buffer, &mut stream) {
        return;
    }

    if handle_lan_download_url_route(&app, method, path, headers, &mut stream) {
        return;
    }

    if handle_lan_storage_routes(&app, method, path, headers, &buffer, &mut stream) {
        return;
    }

    serve_lan_static_request(&app, path, &mut stream);
}

#[tauri::command]
fn start_lan_server(
    app: tauri::AppHandle,
    port: u16,
    token: String,
    require_token: bool,
    web_auth: Option<WebAuthConfig>,
    browser_enabled: bool,
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
            && server.browser_enabled == browser_enabled
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
    let discovery_app = app.clone();
    let url = format!("http://{}:{}/", local_lan_ip(), port);
    let discovery_url = url.clone();
    let (connection_sender, connection_receiver) = std::sync::mpsc::sync_channel::<TcpStream>(32);
    let connection_receiver = Arc::new(Mutex::new(connection_receiver));
    for _ in 0..8 {
        let receiver = connection_receiver.clone();
        let worker_stop = stop.clone();
        let worker_app = app.clone();
        std::thread::spawn(move || {
            while !worker_stop.load(Ordering::Relaxed) {
                let received = receiver
                    .lock()
                    .ok()
                    .and_then(|receiver| receiver.recv_timeout(std::time::Duration::from_millis(250)).ok());
                let Some(stream) = received else {
                    continue;
                };
                let _ = stream.set_nonblocking(false);
                let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(10)));
                serve_lan_request(worker_app.clone(), stream);
            }
        });
    }
    let thread = std::thread::spawn(move || {
        while !stop_thread.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => {
                    match connection_sender.try_send(stream) {
                        Ok(()) => {}
                        Err(std::sync::mpsc::TrySendError::Full(mut stream)) => send_response(
                            &mut stream,
                            "503 Service Unavailable",
                            "text/plain; charset=utf-8",
                            b"BuildBook is busy. Try again shortly.",
                        ),
                        Err(std::sync::mpsc::TrySendError::Disconnected(_)) => break,
                    }
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
        browser_enabled,
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

#[cfg(test)]
mod lan_server_tests {
    use super::*;

    #[test]
    fn web_login_locks_after_five_failures_and_clears() {
        let source = "test-login-source";
        clear_web_login_failures(source);
        for _ in 0..4 {
            record_web_login_failure(source);
            assert!(!web_login_locked(source));
        }
        record_web_login_failure(source);
        assert!(web_login_locked(source));
        clear_web_login_failures(source);
        assert!(!web_login_locked(source));
    }

    #[test]
    fn public_web_url_validation_blocks_private_addresses() {
        assert!(validate_public_web_url("http://127.0.0.1/file.png").is_err());
        assert!(validate_public_web_url("http://[::1]/file.png").is_err());
        assert!(validate_public_web_url("file:///tmp/file.png").is_err());
    }
}
