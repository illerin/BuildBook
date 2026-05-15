import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_STATE, normalizeState } from './data';

const STORAGE_KEY = 'buildbook-state';

function isTauri() {
  return Boolean(window.__TAURI_INTERNALS__);
}

export async function loadAppState() {
  try {
    if (isTauri()) {
      const contents = await invoke('read_app_state');
      return normalizeState(contents ? JSON.parse(contents) : DEFAULT_STATE);
    }

    const contents = localStorage.getItem(STORAGE_KEY);
    return normalizeState(contents ? JSON.parse(contents) : DEFAULT_STATE);
  } catch (error) {
    console.error('Failed to load BuildBook state', error);
    return normalizeState(DEFAULT_STATE);
  }
}

export async function saveAppState(state) {
  const normalized = normalizeState(state);
  const contents = JSON.stringify(normalized, null, 2);

  if (isTauri()) {
    await invoke('write_app_state', { contents });
    return normalized;
  }

  localStorage.setItem(STORAGE_KEY, contents);
  return normalized;
}
