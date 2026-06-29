use std::io::Write;
use std::sync::{Mutex, OnceLock};
use tauri::Manager;

pub(crate) fn state_file_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
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
pub(crate) struct StateBackupInfo {
    file_name: String,
    kind: String,
    modified_ms: u128,
    size: u64,
}

#[tauri::command]
pub(crate) fn list_state_backups(app: tauri::AppHandle) -> Result<Vec<StateBackupInfo>, String> {
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
pub(crate) fn restore_state_backup(app: tauri::AppHandle, file_name: String) -> Result<(), String> {
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
pub(crate) fn read_app_state(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = state_file_path(&app)?;

    if !path.exists() {
        return Ok(None);
    }

    std::fs::read_to_string(path)
        .map(Some)
        .map_err(|error| format!("Could not read app state: {error}"))
}

pub(crate) fn validate_state_contents(contents: &str) -> Result<(), String> {
    let value = serde_json::from_str::<serde_json::Value>(contents)
        .map_err(|error| format!("App state is not valid JSON: {error}"))?;
    if !value.is_object() {
        return Err("App state must be a JSON object.".to_string());
    }
    Ok(())
}

static STATE_WRITE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

pub(crate) fn state_write_lock() -> &'static Mutex<()> {
    STATE_WRITE_LOCK.get_or_init(|| Mutex::new(()))
}

pub(crate) fn write_app_state_inner(app: &tauri::AppHandle, contents: &str) -> Result<(), String> {
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
pub(crate) fn write_app_state(app: tauri::AppHandle, contents: String) -> Result<(), String> {
    let _guard = state_write_lock()
        .lock()
        .map_err(|_| "Could not lock BuildBook state.".to_string())?;
    write_app_state_inner(&app, &contents)
}
