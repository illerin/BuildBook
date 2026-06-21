import { convertFileSrc, invoke } from '@tauri-apps/api/core';

const LAN_TOKEN_KEY = 'buildbook-lan-token';
const APP_REQUEST_HEADER = '1';
const SYNC_CONFIG_KEY = 'buildbook-sync-config';

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

function apiHeaders(extra = {}) {
  const token = lanToken();
  return {
    ...extra,
    'X-BuildBook-Request': APP_REQUEST_HEADER,
    ...(token ? { 'X-BuildBook-Token': token } : {}),
  };
}

function cachedSyncConfig() {
  try {
    return JSON.parse(localStorage.getItem(SYNC_CONFIG_KEY) || '{}');
  } catch {
    return {};
  }
}

export function isHostSyncClient() {
  return isTauri() && cachedSyncConfig().mode === 'client';
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
  if (cachedSyncConfig().mode === 'client') {
    return invoke('sync_save_host_file', { name: file.name, library, bytes });
  }
  return invoke('save_uploaded_file', { name: file.name, library, bytes });
}

export async function saveBytesFile(name, library, bytes) {
  const data = Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  if (isLanWebClient()) {
    const response = await fetch(`/api/files?library=${encodeURIComponent(library)}&name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: apiHeaders(),
      body: bytes,
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }

  if (!isTauri()) {
    return { name, path: URL.createObjectURL(new Blob([bytes])), size: data.length };
  }

  if (cachedSyncConfig().mode === 'client') {
    return invoke('sync_save_host_file', { name, library, bytes: data });
  }
  return invoke('save_uploaded_file', { name, library, bytes: data });
}

export async function overwriteBytesFile(path, bytes, name = 'updated-file') {
  const data = Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  if (isLanWebClient()) {
    const response = await fetch(fileApiUrl(path), { method: 'PUT', headers: apiHeaders(), body: bytes });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }

  if (!isTauri()) {
    return { name, path: URL.createObjectURL(new Blob([bytes])), size: data.length };
  }

  if (cachedSyncConfig().mode === 'client') {
    return invoke('sync_overwrite_host_file', { path, bytes: data });
  }
  return invoke('overwrite_file_bytes', { path, bytes: data });
}

export async function prepareEditableFile(path, name, library) {
  if (!isTauri()) {
    return { name, path, size: 0 };
  }

  if (cachedSyncConfig().mode === 'client') {
    const stored = await invoke('sync_prepare_host_edit_file', { path, name, library });
    return { ...stored, clientLocal: true };
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
  if (isLanWebClient()) {
    const response = await fetch(`/api/download-url?url=${encodeURIComponent(url)}&library=${encodeURIComponent(library)}&name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: apiHeaders(),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }

  if (!isTauri()) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not fetch image: ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return saveBytesFile(name, library, bytes);
  }

  if (cachedSyncConfig().mode === 'client') {
    return invoke('sync_download_url_to_host', { url, library, name });
  }
  return invoke('download_url_to_file', { url, library, name });
}

export async function readStoredFile(path, clientLocal = false) {
  if (!path) return new Uint8Array();

  if (/^https?:\/\//i.test(path)) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`Could not fetch remote file: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  if (isLanWebClient()) {
    const response = await fetch(fileApiUrl(path), { headers: apiHeaders() });
    if (!response.ok) throw new Error(await response.text());
    return new Uint8Array(await response.arrayBuffer());
  }

  if (!isTauri()) {
    const response = await fetch(path);
    return new Uint8Array(await response.arrayBuffer());
  }

  if (cachedSyncConfig().mode === 'client' && !clientLocal) {
    return new Uint8Array(await invoke('sync_read_host_file', { path }));
  }

  return new Uint8Array(await invoke('read_file_bytes', { path }));
}

export async function scanStorage(referencedPaths) {
  if (isLanWebClient()) {
    const response = await fetch('/api/storage-scan', {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ referencedPaths, deletePaths: [] }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }
  if (!isTauri()) return { fileCount: 0, totalBytes: 0, orphanCount: 0, orphanBytes: 0 };
  return invoke('scan_storage', { referencedPaths });
}

export async function cleanupOrphanedFiles(referencedPaths, deletePaths) {
  if (isLanWebClient()) {
    const response = await fetch('/api/storage-scan', {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ referencedPaths, deletePaths }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }
  if (!isTauri()) return { fileCount: 0, totalBytes: 0, orphanCount: 0, orphanBytes: 0, deletedCount: 0, deletedBytes: 0 };
  return invoke('cleanup_orphaned_files', { referencedPaths, deletePaths });
}

export async function deleteManagedFiles(paths) {
  if (!isTauri() || !Array.isArray(paths) || !paths.length) return { deletedPaths: [], failedPaths: [] };
  if (cachedSyncConfig().mode === 'client') {
    return invoke('sync_delete_host_files', { paths });
  }
  return invoke('delete_managed_files', { paths });
}

export async function resetManagedStorage() {
  if (isLanWebClient()) {
    const response = await fetch('/api/reset-storage', { method: 'POST', headers: apiHeaders() });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }
  if (!isTauri()) return { retainedFiles: [] };
  return invoke('reset_managed_storage');
}

export async function readShellThumbnail(path, size = 512) {
  if (!path || !isTauri()) return new Uint8Array();
  return new Uint8Array(await invoke('shell_thumbnail_bytes', { path, size }));
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

export async function openStoredFile(path, clientLocal = false) {
  if (!path) return;

  if (isLanWebClient()) {
    window.open(fileApiUrl(path), '_blank', 'noopener,noreferrer');
    return;
  }

  if (!isTauri()) {
    window.alert(`Desktop open is only available in the Tauri app.\n\n${path}`);
    return;
  }

  if (cachedSyncConfig().mode === 'client' && !clientLocal) {
    const name = path.split(/[\\/]/).pop() || 'host-file';
    await invoke('sync_open_host_file', { path, name });
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
  if (!opened) {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
}

export function assetUrl(path) {
  if (!path) return '';
  if (isLanWebClient()) return fileApiUrl(path);
  const syncConfig = cachedSyncConfig();
  if (isTauri() && syncConfig.mode === 'client' && syncConfig.hostUrl) {
    const base = syncConfig.hostUrl.replace(/\/+$/, '');
    return `${base}/api/files?path=${encodeURIComponent(path)}&access=${encodeURIComponent(syncConfig.hostToken || '')}&deviceToken=${encodeURIComponent(syncConfig.clientAuthToken || '')}&device=${encodeURIComponent(syncConfig.deviceId || '')}`;
  }
  return isTauri() ? convertFileSrc(path) : path;
}

export async function startLanServer(port, token, requireToken = true, webAuth = {}) {
  if (!isTauri()) return { running: false, url: '' };
  return invoke('start_lan_server', { port: Number(port) || 8787, token, requireToken, webAuth });
}

export async function stopLanServer() {
  if (!isTauri()) return { running: false, url: '' };
  return invoke('stop_lan_server');
}

export async function lanServerStatus() {
  if (!isTauri()) return { running: false, url: '' };
  return invoke('lan_server_status');
}

export async function readSyncConfig() {
  if (!isTauri()) {
    return { mode: 'local', deviceId: 'browser', deviceName: 'Browser', hostUrl: '', hostToken: '' };
  }
  const config = await invoke('read_sync_config');
  localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config));
  return config;
}

export async function writeSyncConfig(config) {
  if (!isTauri()) return config;
  const saved = await invoke('write_sync_config', { config });
  localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(saved));
  return saved;
}

export async function discoverBuildBookHosts(port = 8787) {
  if (!isTauri()) return [];
  return invoke('discover_buildbook_hosts', { port: Number(port) || 8787 });
}

export async function probeBuildBookHost(url, token = '') {
  if (!isTauri()) throw new Error('Host pairing is only available in the desktop app.');
  return invoke('probe_buildbook_host', { url, token });
}

export async function pairBuildBookHost(url, pairingCode = '') {
  if (!isTauri()) throw new Error('Host pairing is only available in the desktop app.');
  return invoke('pair_buildbook_host', { url, pairingCode });
}

export async function generateSyncPairingCode() {
  if (!isTauri()) throw new Error('Pairing codes are only available in the desktop app.');
  const config = await invoke('generate_sync_pairing_code');
  localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config));
  return config;
}

export async function revokePairedDevice(deviceId) {
  if (!isTauri()) throw new Error('Paired devices are only managed in the desktop app.');
  const config = await invoke('revoke_paired_device', { deviceId });
  localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config));
  return config;
}

export async function clearSyncCheckout(path) {
  if (!isTauri()) throw new Error('File checkouts are only managed in the desktop app.');
  return invoke('clear_sync_checkout', { path });
}

export async function readSyncStatusDashboard() {
  if (!isTauri()) {
    return {
      mode: 'local',
      deviceId: 'browser',
      deviceName: 'Browser',
      hostUrl: '',
      hostRevision: '',
      pendingSync: false,
      lastConnectedAt: 0,
      lastSyncError: '',
      pairingCodeExpiresAt: 0,
      pairingLockedUntil: 0,
      pairedDevices: [],
      activeCheckouts: [],
      cacheFileCount: 0,
      cacheBytes: 0,
    };
  }
  return invoke('sync_status_dashboard');
}

export async function readSyncConflictSummary() {
  if (!isTauri()) return { hasConflict: false, items: [] };
  return invoke('sync_conflict_summary');
}

export async function resolveSyncConflict(choice) {
  if (!isTauri()) throw new Error('Sync conflict resolution is only available in the desktop app.');
  return invoke('resolve_sync_conflict', { choice });
}

export async function resolveSyncConflictSelections(selections) {
  if (!isTauri()) throw new Error('Sync conflict resolution is only available in the desktop app.');
  return invoke('resolve_sync_conflict_selections', { selections });
}

export async function fileCheckout(path, action = 'acquire') {
  if (!isTauri() || !path) {
    return { acquired: true, offline: false, lease: null, message: '' };
  }
  return invoke('sync_file_checkout', { path, action });
}

export async function setCloseToTray(enabled) {
  if (!isTauri()) return;
  await invoke('set_close_to_tray', { enabled: Boolean(enabled) });
}

export async function listStateBackups() {
  if (!isTauri()) return [];
  return invoke('list_state_backups');
}

export async function restoreStateBackup(fileName) {
  if (!isTauri()) throw new Error('State restore is only available in the desktop app.');
  return invoke('restore_state_backup', { fileName });
}

export function extensionAllowed(fileName, extensions) {
  const rules = extensions
    .split(',')
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean);

  if (!rules.length) return true;

  return rules.some((extension) => fileName.toLowerCase().endsWith(extension));
}
