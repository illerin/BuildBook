import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_STATE, normalizeState } from './data';

const STORAGE_KEY = 'buildbook-state';
const LAN_TOKEN_KEY = 'buildbook-lan-token';
const APP_REQUEST_HEADER = '1';
const SYNC_CONFIG_KEY = 'buildbook-sync-config';
let lastSyncStatus = { status: 'local', pending: false, message: 'Using local BuildBook data.' };

function isTauri() {
  return Boolean(window.__TAURI_INTERNALS__);
}

function isLanWebClient() {
  const isViteDev = ['localhost', '127.0.0.1'].includes(window.location.hostname) && window.location.port === '5173';
  return !isTauri() && window.location.protocol.startsWith('http') && !isViteDev;
}

export function isRemoteBuildBookClient() {
  return isLanWebClient();
}

function publishSyncStatus(result) {
  lastSyncStatus = {
    status: result?.status || 'local',
    pending: Boolean(result?.pending),
    message: result?.message || '',
    revision: result?.revision || '',
  };
  window.dispatchEvent(new CustomEvent('buildbook-sync-status', { detail: lastSyncStatus }));
}

export function getLastSyncStatus() {
  return lastSyncStatus;
}

export function lanToken() {
  const access = new URLSearchParams(window.location.search).get('access');
  if (access) {
    localStorage.setItem(LAN_TOKEN_KEY, access);
    const clean = `${window.location.pathname}${window.location.hash || ''}`;
    window.history.replaceState({}, '', clean || '/');
    return access;
  }
  return localStorage.getItem(LAN_TOKEN_KEY) || '';
}

function apiHeaders(extra = {}) {
  const token = lanToken();
  return {
    ...extra,
    'X-BuildBook-Request': APP_REQUEST_HEADER,
    ...(token ? { 'X-BuildBook-Token': token } : {}),
  };
}

async function responseErrorMessage(response, fallback) {
  const raw = await response.text().catch(() => '');
  const text = raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (response.status === 502) return 'Host returned 502 Bad Gateway. The BuildBook host or proxy is not reachable.';
  if (response.status === 503) return 'Host returned 503 Service Unavailable. The BuildBook host may be stopped.';
  if (response.status === 401) return text || 'BuildBook access is required.';
  return text ? text.slice(0, 220) : fallback;
}

export async function loadAppState() {
  if (isTauri()) {
    const config = await invoke('read_sync_config');
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config));
    if (config.mode === 'client') {
      const result = await invoke('sync_client_load');
      publishSyncStatus(result);
      return normalizeState(JSON.parse(result.contents));
    }
    const contents = await invoke('read_app_state');
    publishSyncStatus({
      status: config.mode === 'host' ? 'host' : 'local',
      pending: false,
      message: config.mode === 'host' ? 'Hosting BuildBook data.' : 'Using local BuildBook data.',
    });
    if (!contents) return normalizeState(DEFAULT_STATE);
    return normalizeState(JSON.parse(contents));
  }

  if (isLanWebClient()) {
    const response = await fetch('/api/state', { headers: apiHeaders() });
    if (response.ok) return normalizeState(await response.json());
    throw new Error(await responseErrorMessage(response, 'Could not load BuildBook from this computer.'));
  }

  try {
    const contents = localStorage.getItem(STORAGE_KEY);
    return normalizeState(contents ? JSON.parse(contents) : DEFAULT_STATE);
  } catch (error) {
    throw new Error(`Could not load BuildBook browser state: ${error}`);
  }
}

export async function webLogin(username, password) {
  if (!isLanWebClient()) return;
  const response = await fetch('/api/login', {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new Error(await responseErrorMessage(response, 'Could not log in.'));
}

export async function webLogout() {
  if (!isLanWebClient()) return;
  await fetch('/api/logout', { method: 'POST', headers: apiHeaders() });
}

export async function fetchWebAuthStatus() {
  if (!isLanWebClient()) {
    return {
      loginEnabled: false,
      loginRequired: false,
      authenticated: true,
      username: 'local',
    };
  }

  const response = await fetch('/api/auth-status', { headers: apiHeaders() });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, 'Could not reach the BuildBook host.'));
  }
  return response.json();
}

export async function saveAppState(state) {
  const normalized = normalizeState(state);
  const pretty = isTauri() || !isLanWebClient();
  const contents = JSON.stringify(normalized, null, pretty ? 2 : 0);

  if (isTauri()) {
    const config = await invoke('read_sync_config');
    localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config));
    if (config.mode === 'client') {
      const result = await invoke('sync_client_save', { contents });
      publishSyncStatus(result);
      if (result.status === 'conflict') {
        throw new Error(result.message);
      }
      return normalized;
    }
    await invoke('write_app_state', { contents });
    publishSyncStatus({
      status: config.mode === 'host' ? 'host' : 'local',
      pending: false,
      message: config.mode === 'host' ? 'Saved on host.' : 'Saved locally.',
    });
    return normalized;
  }

  if (isLanWebClient()) {
    const response = await fetch('/api/state', {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: contents,
    });
    if (!response.ok) throw new Error(await responseErrorMessage(response, 'Could not save BuildBook to this computer.'));
    return normalized;
  }

  localStorage.setItem(STORAGE_KEY, contents);
  return normalized;
}
