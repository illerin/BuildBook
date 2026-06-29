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
pub(crate) fn shell_thumbnail_bytes(
    app: tauri::AppHandle,
    path: String,
    size: u32,
) -> Result<Vec<u8>, String> {
    let target = crate::file_access::readable_user_file_path(&app, &path)?;

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
pub(crate) fn shell_thumbnail_bytes(
    _app: tauri::AppHandle,
    _path: String,
    _size: u32,
) -> Result<Vec<u8>, String> {
    Err("Shell thumbnails are only available on Windows.".to_string())
}
