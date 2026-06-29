pub(crate) fn normalized_existing_path(path: &str) -> Result<std::path::PathBuf, String> {
    std::fs::canonicalize(path.trim_matches('"'))
        .map_err(|_| "The selected path could not be found.".to_string())
}

pub(crate) fn safe_file_name(name: &str) -> String {
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

pub(crate) fn path_matches_or_is_under(path: &std::path::Path, root: &std::path::Path) -> bool {
    let path = path.to_string_lossy().replace('/', "\\").to_lowercase();
    let root = root.to_string_lossy().replace('/', "\\").to_lowercase();
    path == root || path.starts_with(&format!("{root}\\"))
}

pub(crate) fn app_private_path_blocked(app: &tauri::AppHandle, target: &std::path::Path) -> bool {
    let sensitive_files = [
        crate::state_file_path(app),
        crate::sync_config_path(app),
        crate::sync_base_path(app),
        crate::sync_conflict_path(app),
    ];
    if sensitive_files
        .into_iter()
        .flatten()
        .filter_map(|path| std::fs::canonicalize(path).ok())
        .any(|path| path == target)
    {
        return true;
    }

    crate::state_file_path(app)
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.join("state-backups")))
        .and_then(|path| std::fs::canonicalize(path).ok())
        .is_some_and(|path| path_matches_or_is_under(target, &path))
}

pub(crate) fn readable_user_file_path(
    app: &tauri::AppHandle,
    path: &str,
) -> Result<std::path::PathBuf, String> {
    let target = normalized_existing_path(path)?;
    if !target.is_file() {
        return Err("The saved file could not be found.".to_string());
    }
    if app_private_path_blocked(app, &target) {
        return Err("BuildBook private state files cannot be opened from this action.".to_string());
    }
    Ok(target)
}

pub(crate) fn open_file_path_inner(target: &std::path::Path) -> Result<(), String> {
    if !target.exists() {
        return Err("The saved file could not be found.".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        windows_shell_execute(target, None)?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(target)
            .spawn()
            .map_err(|error| format!("Could not open file: {error}"))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|error| format!("Could not open file: {error}"))?;
    }

    Ok(())
}

pub(crate) fn open_file_with_program_inner(
    program: &std::path::Path,
    file: &std::path::Path,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        windows_shell_execute(program, Some(file))
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
