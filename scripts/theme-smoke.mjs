import assert from 'node:assert/strict';
import { DEFAULT_FILE_TRACKERS, DEFAULT_THEME } from '../src/data.js';
import { THEME_FIELDS, buildThemeExport, normalizeTheme, readThemeFile, themeExportBytes } from '../src/theme.js';

const custom = { bg: '#111111', accent: '#2255aa' };
const normalized = normalizeTheme(custom);
assert.equal(normalized.bg, '#111111');
assert.equal(normalized.accent, '#2255aa');
assert.equal(normalized.text, DEFAULT_THEME.text);
assert.equal(THEME_FIELDS.length, 5);
assert.equal(normalized.sidebar, normalized.surface);
assert.notEqual(normalized.border, undefined);
assert.deepEqual([...new Set(DEFAULT_FILE_TRACKERS.map((tracker) => tracker.color))], [DEFAULT_THEME.accent]);

const legacy = normalizeTheme({ ...DEFAULT_THEME, sidebar: '#ff0000', danger: '#00ff00' });
assert.equal(legacy.sidebar, DEFAULT_THEME.surface);
assert.notEqual(legacy.danger, '#00ff00');

const payload = buildThemeExport(custom, 'test-version');
assert.equal(payload.type, 'buildbook-theme');
assert.equal(payload.version, 'test-version');
assert.equal(payload.theme.bg, '#111111');

const bytes = themeExportBytes(custom, 'test-version');
const parsed = JSON.parse(new TextDecoder().decode(bytes));
assert.deepEqual(parsed, payload);

const file = new File([JSON.stringify(payload)], 'theme.json', { type: 'application/json' });
const imported = await readThemeFile(file);
assert.equal(imported.bg, '#111111');
assert.equal(imported.text, DEFAULT_THEME.text);

console.log('Theme smoke check passed.');
