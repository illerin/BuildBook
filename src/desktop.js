import { convertFileSrc, invoke } from '@tauri-apps/api/core';

function isTauri() {
  return Boolean(window.__TAURI_INTERNALS__);
}

export async function attachLocalFile(sourcePath, library) {
  if (!isTauri()) {
    const name = sourcePath.split(/[\\/]/).pop() || 'attached-file';
    return { name, path: sourcePath, size: 0 };
  }

  return invoke('attach_local_file', { sourcePath, library });
}

export async function savePickedFile(file, library) {
  if (!isTauri()) {
    return { name: file.name, path: URL.createObjectURL(file), size: file.size };
  }

  const buffer = await file.arrayBuffer();
  const bytes = Array.from(new Uint8Array(buffer));
  return invoke('save_uploaded_file', { name: file.name, library, bytes });
}

export async function saveBytesFile(name, library, bytes) {
  const data = Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  if (!isTauri()) {
    return { name, path: URL.createObjectURL(new Blob([bytes])), size: data.length };
  }

  return invoke('save_uploaded_file', { name, library, bytes: data });
}

export async function prepareEditableFile(path, name, library) {
  if (!isTauri()) {
    return { name, path, size: 0 };
  }

  return invoke('prepare_edit_file', { path, name, library });
}

export async function downloadUrlFile(url, library, name) {
  if (!isTauri()) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not fetch image: ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return saveBytesFile(name, library, bytes);
  }

  return invoke('download_url_to_file', { url, library, name });
}

export async function readStoredFile(path) {
  if (!path) return new Uint8Array();

  if (!isTauri()) {
    const response = await fetch(path);
    return new Uint8Array(await response.arrayBuffer());
  }

  return new Uint8Array(await invoke('read_file_bytes', { path }));
}

export function downloadBytes(name, bytes, type = 'application/octet-stream') {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function linkedLocalFile(sourcePath) {
  const trimmedPath = sourcePath.trim().replace(/^"|"$/g, '');
  const name = trimmedPath.split(/[\\/]/).pop() || 'linked-file';
  return { name, path: trimmedPath, size: 0 };
}

export function acceptFromExtensions(extensions) {
  return extensions
    .split(',')
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean)
    .join(',');
}

export async function openStoredFile(path) {
  if (!path) return;

  if (!isTauri()) {
    window.alert(`Desktop open is only available in the Tauri app.\n\n${path}`);
    return;
  }

  await invoke('open_file_path', { path });
}

export async function openWithProgram(programPath, filePath) {
  if (!programPath || !filePath) return;

  if (!isTauri()) {
    window.alert(`Program launch is only available in the Tauri app.\n\n${programPath}\n${filePath}`);
    return;
  }

  await invoke('open_file_with_program', { programPath, filePath });
}

export function openExternalUrl(url) {
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function assetUrl(path) {
  if (!path) return '';
  return isTauri() ? convertFileSrc(path) : path;
}

export function extensionAllowed(fileName, extensions) {
  const rules = extensions
    .split(',')
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean);

  if (!rules.length) return true;

  return rules.some((extension) => fileName.toLowerCase().endsWith(extension));
}
