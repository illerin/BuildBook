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
    let validated_url = validate_public_web_url(&url)?;
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

    let mut client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(60));
    if let Some(hostname) = validated_url.hostname.as_deref() {
        client = client.resolve_to_addrs(hostname, &validated_url.addresses);
    }
    let client = client
        .build()
        .map_err(|error| format!("Could not prepare the download request: {error}"))?;
    let mut response = client
        .get(&validated_url.url)
        .send()
        .map_err(|error| format!("Could not download remote file: {error}"))?;
    if response.status().is_redirection() {
        return Err("Redirecting product links are not supported for security reasons. Use the final public file URL instead.".to_string());
    }
    if !response.status().is_success() {
        return Err(format!("Could not download remote file: {}", response.status()));
    }
    const MAX_REMOTE_DOWNLOAD_BYTES: u64 = 64 * 1024 * 1024;
    if response.content_length().is_some_and(|length| length > MAX_REMOTE_DOWNLOAD_BYTES) {
        return Err("The remote file is larger than the 64 MB download limit.".to_string());
    }
    let mut output = std::fs::File::create(&target)
        .map_err(|error| format!("Could not create the downloaded file: {error}"))?;
    let download_result = (|| -> Result<(), String> {
        let mut downloaded = 0u64;
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let count = std::io::Read::read(&mut response, &mut buffer)
                .map_err(|error| format!("Could not read the remote file: {error}"))?;
            if count == 0 {
                break;
            }
            downloaded = downloaded.saturating_add(count as u64);
            if downloaded > MAX_REMOTE_DOWNLOAD_BYTES {
                return Err("The remote file is larger than the 64 MB download limit.".to_string());
            }
            std::io::Write::write_all(&mut output, &buffer[..count])
                .map_err(|error| format!("Could not save the downloaded file: {error}"))?;
        }
        std::io::Write::flush(&mut output)
            .map_err(|error| format!("Could not finish the downloaded file: {error}"))
    })();
    if let Err(error) = download_result {
        drop(output);
        let _ = std::fs::remove_file(&target);
        return Err(error);
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
fn read_file_bytes(app: tauri::AppHandle, path: String) -> Result<Vec<u8>, String> {
    let target = readable_user_file_path(&app, &path)?;
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

#[tauri::command]
fn open_file_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let target = readable_user_file_path(&app, &path)?;
    open_file_path_inner(&target)
}

#[tauri::command]
fn open_file_with_program(
    app: tauri::AppHandle,
    program_path: String,
    file_path: String,
) -> Result<(), String> {
    let program = normalized_existing_path(&program_path)?;
    let file = readable_user_file_path(&app, &file_path)?;

    if !program.is_file() {
        return Err("The configured program could not be found.".to_string());
    }

    open_file_with_program_inner(&program, &file)
}
