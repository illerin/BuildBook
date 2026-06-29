import { APP_VERSION, DEFAULT_THEME } from './data.js';

export const THEME_FIELDS = [
  ['bg', 'App background'],
  ['sidebar', 'Sidebar background'],
  ['surface', 'Panel background'],
  ['field', 'Input background'],
  ['border', 'Border'],
  ['text', 'Main text'],
  ['textMuted', 'Muted text'],
  ['accent', 'Accent'],
  ['success', 'Success'],
  ['danger', 'Danger'],
  ['warning', 'Warning'],
];

export const THEME_DERIVED_FIELDS = [
  ['surfaceRaised', 'Raised controls'],
  ['borderSoft', 'Soft border'],
  ['textSoft', 'Soft text'],
  ['accentFill', 'Active accent'],
  ['successHover', 'Success hover'],
  ['dangerHover', 'Danger hover'],
  ['projectTagBg', 'Project tag background'],
  ['projectTagText', 'Project tag text'],
  ['statusActiveBg', 'Active status background'],
  ['statusActiveText', 'Active status text'],
  ['statusPausedBg', 'Paused status background'],
  ['statusPausedText', 'Paused status text'],
  ['statusWaitingBg', 'Waiting status background'],
  ['statusWaitingText', 'Waiting status text'],
  ['statusCompletedBg', 'Completed status background'],
  ['statusCompletedText', 'Completed status text'],
  ['statusArchivedBg', 'Archived status background'],
  ['statusArchivedText', 'Archived status text'],
];

export const THEME_DERIVED_GROUPS = {
  bg: [
    'accentFill',
    'projectTagBg',
    'statusActiveBg',
    'statusPausedBg',
    'statusWaitingBg',
    'statusCompletedBg',
    'statusArchivedBg',
  ],
  surface: ['surfaceRaised', 'borderSoft'],
  text: [
    'textSoft',
    'successHover',
    'dangerHover',
    'projectTagText',
    'statusActiveText',
    'statusPausedText',
    'statusWaitingText',
    'statusCompletedText',
    'statusArchivedText',
  ],
};

export const THEME_FIELD_LABELS = Object.fromEntries([...THEME_FIELDS, ...THEME_DERIVED_FIELDS]);

export const THEME_CSS_VARS = {
  bg: '--bg',
  sidebar: '--sidebar',
  surface: '--surface',
  surfaceRaised: '--surface-raised',
  field: '--field',
  border: '--border',
  borderSoft: '--border-soft',
  text: '--text',
  textMuted: '--text-muted',
  textSoft: '--text-soft',
  accent: '--accent',
  accentFill: '--accent-fill',
  success: '--success',
  successHover: '--success-hover',
  danger: '--danger',
  dangerHover: '--danger-hover',
  warning: '--warning',
  projectTagBg: '--project-tag-bg',
  projectTagText: '--project-tag-text',
  statusActiveBg: '--status-active-bg',
  statusActiveText: '--status-active-text',
  statusPausedBg: '--status-paused-bg',
  statusPausedText: '--status-paused-text',
  statusWaitingBg: '--status-waiting-bg',
  statusWaitingText: '--status-waiting-text',
  statusCompletedBg: '--status-completed-bg',
  statusCompletedText: '--status-completed-text',
  statusArchivedBg: '--status-archived-bg',
  statusArchivedText: '--status-archived-text',
};

const mixHex = (from, to, amount = 0.5) => {
  const left = String(from || '').match(/^#([0-9a-fA-F]{6})$/)?.[1];
  const right = String(to || '').match(/^#([0-9a-fA-F]{6})$/)?.[1];
  if (!left || !right) return from || to || '#000000';
  const channel = (hex, index) => parseInt(hex.slice(index, index + 2), 16);
  const mixed = [0, 2, 4].map((index) => {
    const value = Math.round(channel(left, index) * amount + channel(right, index) * (1 - amount));
    return value.toString(16).padStart(2, '0');
  });
  return `#${mixed.join('')}`;
};

export function normalizeTheme(theme) {
  const source = theme && typeof theme === 'object' ? theme : {};
  const base = { ...DEFAULT_THEME, ...source };
  const derived = {
    surfaceRaised: mixHex(base.surface, base.text, 0.88),
    borderSoft: mixHex(base.border, base.surface, 0.55),
    textSoft: mixHex(base.text, base.textMuted, 0.72),
    accentFill: mixHex(base.accent, base.bg, 0.72),
    successHover: mixHex(base.success, base.text, 0.82),
    dangerHover: mixHex(base.danger, base.text, 0.82),
    projectTagBg: mixHex(base.accent, base.bg, 0.24),
    projectTagText: mixHex(base.accent, base.text, 0.74),
    statusActiveBg: mixHex(base.success, base.bg, 0.34),
    statusActiveText: mixHex(base.success, base.text, 0.62),
    statusPausedBg: mixHex(base.textMuted, base.bg, 0.28),
    statusPausedText: mixHex(base.textMuted, base.text, 0.7),
    statusWaitingBg: mixHex(base.warning, base.bg, 0.32),
    statusWaitingText: mixHex(base.warning, base.text, 0.68),
    statusCompletedBg: mixHex(base.accent, base.bg, 0.26),
    statusCompletedText: mixHex(base.accent, base.text, 0.72),
    statusArchivedBg: mixHex(base.danger, base.bg, 0.22),
    statusArchivedText: mixHex(base.danger, base.text, 0.48),
  };
  return { ...base, ...derived };
}

export function validHexColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || ''));
}

export function cssColor(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function buildThemeExport(theme, version = APP_VERSION) {
  return {
    type: 'buildbook-theme',
    version,
    theme: normalizeTheme(theme),
  };
}

export function themeExportBytes(theme, version = APP_VERSION) {
  return new TextEncoder().encode(JSON.stringify(buildThemeExport(theme, version), null, 2));
}

export async function readThemeFile(file) {
  const payload = JSON.parse(await file.text());
  const theme = payload.theme && typeof payload.theme === 'object' ? payload.theme : payload;
  return normalizeTheme(theme);
}
