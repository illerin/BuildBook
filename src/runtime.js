export const LAN_TOKEN_KEY = 'buildbook-lan-token';
export const APP_REQUEST_HEADER = '1';
export const SYNC_CONFIG_KEY = 'buildbook-sync-config';

export function isTauri() {
  return Boolean(window.__TAURI_INTERNALS__);
}

export function isLanWebClient() {
  const isViteDev = ['localhost', '127.0.0.1'].includes(window.location.hostname) && window.location.port === '5173';
  return !isTauri() && window.location.protocol.startsWith('http') && !isViteDev;
}

export function lanToken({ persistAccess = false, cleanUrl = false } = {}) {
  const access = new URLSearchParams(window.location.search).get('access');
  if (access && persistAccess) {
    localStorage.setItem(LAN_TOKEN_KEY, access);
    if (cleanUrl) {
      const clean = `${window.location.pathname}${window.location.hash || ''}`;
      window.history.replaceState({}, '', clean || '/');
    }
    return access;
  }
  return localStorage.getItem(LAN_TOKEN_KEY) || access || '';
}

export function apiHeaders(extra = {}) {
  const token = lanToken();
  return {
    ...extra,
    'X-BuildBook-Request': APP_REQUEST_HEADER,
    ...(token ? { 'X-BuildBook-Token': token } : {}),
  };
}

export function cachedSyncConfig() {
  try {
    return JSON.parse(localStorage.getItem(SYNC_CONFIG_KEY) || '{}');
  } catch {
    return {};
  }
}

export function cacheSyncConfig(config) {
  localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config));
  return config;
}
