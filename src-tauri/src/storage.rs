use std::collections::HashSet;
use tauri::Manager;

use crate::file_access::{app_private_path_blocked, normalized_existing_path};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkedFolderFile {
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
pub(crate) struct StorageScan {
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
pub(crate) struct StorageScanRequest {
    pub(crate) referenced_paths: Vec<String>,
    pub(crate) delete_paths: Option<Vec<String>>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResetStorageResult {
    retained_files: Vec<String>,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteManagedFilesResult {
    deleted_paths: Vec<String>,
    failed_paths: Vec<String>,
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
pub(crate) fn list_folder_files(
    app: tauri::AppHandle,
    path: String,
) -> Result<Vec<LinkedFolderFile>, String> {
    let root = normalized_existing_path(&path)?;
    if !root.is_dir() {
        return Err("The selected folder could not be found.".to_string());
    }
    if app
        .path()
        .app_data_dir()
        .ok()
        .and_then(|path| std::fs::canonicalize(path).ok())
        .is_some_and(|path| path == root)
    {
        return Err(
            "BuildBook private state folders cannot be listed from this action.".to_string(),
        );
    }
    if app_private_path_blocked(&app, &root) {
        return Err(
            "BuildBook private state folders cannot be listed from this action.".to_string(),
        );
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

pub(crate) fn storage_roots(app: &tauri::AppHandle) -> Result<Vec<std::path::PathBuf>, String> {
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

pub(crate) fn canonical_under_roots(
    path: &str,
    roots: &[std::path::PathBuf],
) -> Option<std::path::PathBuf> {
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

pub(crate) fn scan_storage_inner(
    app: tauri::AppHandle,
    referenced_paths: Vec<String>,
    delete_paths: Vec<String>,
) -> Result<StorageScan, String> {
    let roots = storage_roots(&app)?;
    let referenced: HashSet<String> = referenced_paths
        .into_iter()
        .filter_map(|path| std::fs::canonicalize(path.trim_matches('"')).ok())
        .map(|path| path.to_string_lossy().to_lowercase())
        .collect();
    let delete_set: HashSet<String> = delete_paths
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
pub(crate) fn scan_storage(
    app: tauri::AppHandle,
    referenced_paths: Vec<String>,
) -> Result<StorageScan, String> {
    scan_storage_inner(app, referenced_paths, Vec::new())
}

#[tauri::command]
pub(crate) fn cleanup_orphaned_files(
    app: tauri::AppHandle,
    referenced_paths: Vec<String>,
    delete_paths: Vec<String>,
) -> Result<StorageScan, String> {
    scan_storage_inner(app, referenced_paths, delete_paths)
}

#[tauri::command]
pub(crate) fn delete_managed_files(
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
pub(crate) fn reset_managed_storage(app: tauri::AppHandle) -> Result<ResetStorageResult, String> {
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
