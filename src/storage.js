import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_STATE, normalizeState } from './data';

const STORAGE_KEY = 'buildbook-state';
const LAN_TOKEN_KEY = 'buildbook-lan-token';

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

export async function loadAppState() {
  if (isTauri()) {
    const contents = await invoke('read_app_state');
    if (!contents) return normalizeState(DEFAULT_STATE);
    return normalizeState(JSON.parse(contents));
  }

  if (isLanWebClient()) {
    const response = await fetch('/api/state', { headers: { 'X-BuildBook-Token': lanToken() } });
    if (response.ok) return normalizeState(await response.json());
    const message = await response.text();
    if (response.status === 401) {
      throw new Error(message || 'BuildBook access is required.');
    }
    throw new Error(message || 'Could not load BuildBook from this computer.');
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new Error(await response.text() || 'Could not log in.');
}

export async function webLogout() {
  if (!isLanWebClient()) return;
  await fetch('/api/logout', { method: 'POST' });
}

export async function saveAppState(state) {
  const normalized = normalizeState(state);
  const pretty = isTauri() || !isLanWebClient();
  const contents = JSON.stringify(normalized, null, pretty ? 2 : 0);

  if (isTauri()) {
    await invoke('write_app_state', { contents });
    return normalized;
  }

  if (isLanWebClient()) {
    const response = await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-BuildBook-Token': lanToken() },
      body: contents,
    });
    if (!response.ok) throw new Error(await response.text());
    return normalized;
  }

  localStorage.setItem(STORAGE_KEY, contents);
  return normalized;
}
