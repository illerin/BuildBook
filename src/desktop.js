import { convertFileSrc, invoke } from '@tauri-apps/api/core';

const LAN_TOKEN_KEY = 'buildbook-lan-token';

function isTauri() {
  return Boolean(window.__TAURI_INTERNALS__);
}

function isLanWebClient() {
  const isViteDev = ['localhost', '127.0.0.1'].includes(window.location.hostname) && window.location.port === '5173';
  return !isTauri() && window.location.protocol.startsWith('http') && !isViteDev;
}

function fileApiUrl(path) {
  return `/api/files?path=${encodeURIComponent(path)}&access=${encodeURIComponent(lanToken())}`;
}

function lanToken() {
  return localStorage.getItem(LAN_TOKEN_KEY) || new URLSearchParams(window.location.search).get('access') || '';
}

export async function attachLocalFile(sourcePath, library) {
  if (!isTauri()) {
    const name = sourcePath.split(/[\\/]/).pop() || 'attached-file';
    return { name, path: sourcePath, size: 0 };
  }

  return invoke('attach_local_file', { sourcePath, library });
}

export async function savePickedFile(file, library) {
  if (isLanWebClient()) {
    const buffer = await file.arrayBuffer();
    return saveBytesFile(file.name, library, new Uint8Array(buffer));
  }

  if (!isTauri()) {
    return { name: file.name, path: URL.createObjectURL(file), size: file.size };
  }

  const buffer = await file.arrayBuffer();
  const bytes = Array.from(new Uint8Array(buffer));
  return invoke('save_uploaded_file', { name: file.name, library, bytes });
}

export async function saveBytesFile(name, library, bytes) {
  const data = Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  if (isLanWebClient()) {
    const response = await fetch(`/api/files?library=${encodeURIComponent(library)}&name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'X-BuildBook-Token': lanToken() },
      body: bytes,
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }

  if (!isTauri()) {
    return { name, path: URL.createObjectURL(new Blob([bytes])), size: data.length };
  }

  return invoke('save_uploaded_file', { name, library, bytes: data });
}

export async function overwriteBytesFile(path, bytes, name = 'updated-file') {
  const data = Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  if (isLanWebClient()) {
    const response = await fetch(fileApiUrl(path), { method: 'PUT', headers: { 'X-BuildBook-Token': lanToken() }, body: bytes });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }

  if (!isTauri()) {
    return { name, path: URL.createObjectURL(new Blob([bytes])), size: data.length };
  }

  return invoke('overwrite_file_bytes', { path, bytes: data });
}

export async function prepareEditableFile(path, name, library) {
  if (!isTauri()) {
    return { name, path, size: 0 };
  }

  return invoke('prepare_edit_file', { path, name, library });
}

export async function pickLinkedFilePath() {
  if (!isTauri()) return '';
  return invoke('pick_file_path');
}

export async function pickLinkedFolderPath() {
  if (!isTauri()) return '';
  return invoke('pick_folder_path');
}

export async function listLinkedFolderFiles(path) {
  if (!isTauri() || !path) return [];
  return invoke('list_folder_files', { path });
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

  if (isLanWebClient()) {
    const response = await fetch(fileApiUrl(path), { headers: { 'X-BuildBook-Token': lanToken() } });
    if (!response.ok) throw new Error(await response.text());
    return new Uint8Array(await response.arrayBuffer());
  }

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

  if (isLanWebClient()) {
    window.open(fileApiUrl(path), '_blank', 'noopener,noreferrer');
    return;
  }

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

export async function openExternalUrl(url) {
  if (!url) return;
  if (isTauri()) {
    try {
      await invoke('plugin:opener|open_url', { url });
      return;
    } catch (error) {
      console.warn('Could not open external URL with Tauri opener.', error);
    }
  }

  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) window.location.href = url;
}

export function assetUrl(path) {
  if (!path) return '';
  if (isLanWebClient()) return fileApiUrl(path);
  return isTauri() ? convertFileSrc(path) : path;
}

export async function startLanServer(port, token, requireToken = true) {
  if (!isTauri()) return { running: false, url: '' };
  return invoke('start_lan_server', { port: Number(port) || 8787, token, requireToken });
}

export async function stopLanServer() {
  if (!isTauri()) return { running: false, url: '' };
  return invoke('stop_lan_server');
}

export async function lanServerStatus() {
  if (!isTauri()) return { running: false, url: '' };
  return invoke('lan_server_status');
}

export function extensionAllowed(fileName, extensions) {
  const rules = extensions
    .split(',')
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean);

  if (!rules.length) return true;

  return rules.some((extension) => fileName.toLowerCase().endsWith(extension));
}
