import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  APP_VERSION,
  DEFAULT_THEME,
  STATUSES,
  categoryLabel,
  fileTrackerLabel,
  makeId,
  normalizeState,
} from './data';
import {
  acceptFromExtensions,
  assetUrl,
  cleanupOrphanedFiles,
  downloadBytes,
  downloadUrlFile,
  extensionAllowed,
  linkedLocalFile,
  lanServerStatus,
  listLinkedFolderFiles,
  openExternalUrl,
  openStoredFile,
  openWithProgram,
  overwriteBytesFile,
  pickLinkedFolderPath,
  pickLinkedFilePath,
  prepareEditableFile,
  readShellThumbnail,
  readStoredFile,
  scanStorage,
  saveBytesFile,
  savePickedFile,
  startLanServer,
  stopLanServer,
} from './desktop';
import { loadAppState, saveAppState } from './storage';
import { createZip, readZip, zipText } from './zip';

const TABS = [
  ['projects', 'Projects'],
  ['completed-projects', 'Completed Projects', 'child'],
  ['parts', 'Parts Library'],
  ['search', 'Search'],
  ['imports', 'Imports'],
  ['settings', 'Settings'],
];

const DEFAULT_PROJECT_EXPORT_OPTIONS = {
  overviewNotes: true,
  overviewChecklist: true,
  instructions: true,
  photos: true,
  linkedParts: true,
  latestFiles: true,
  allFileVersions: false,
  partDocuments: true,
};

const FULL_PROJECT_EXPORT_OPTIONS = {
  ...DEFAULT_PROJECT_EXPORT_OPTIONS,
  allFileVersions: true,
};

const GITHUB_RELEASES_URL = 'https://github.com/illerin/BuildBook/releases';
const GITHUB_LATEST_RELEASE_API = 'https://api.github.com/repos/illerin/BuildBook/releases/latest';

function versionNumbers(version = '') {
  return String(version).replace(/^v/i, '').split(/[.-]/).slice(0, 3).map((part) => Number(part) || 0);
}

function isNewerVersion(candidate, current) {
  const next = versionNumbers(candidate);
  const installed = versionNumbers(current);
  return next.some((number, index) => number > (installed[index] || 0)
    && next.slice(0, index).every((previous, previousIndex) => previous === (installed[previousIndex] || 0)));
}

const THEME_FIELDS = [
  ['bg', 'App background'],
  ['sidebar', 'Sidebar background'],
  ['surface', 'Panel background'],
  ['surfaceRaised', 'Raised controls'],
  ['field', 'Input background'],
  ['border', 'Border'],
  ['borderSoft', 'Soft border'],
  ['text', 'Main text'],
  ['textMuted', 'Muted text'],
  ['textSoft', 'Soft text'],
  ['accent', 'Primary blue'],
  ['accentFill', 'Active blue'],
  ['success', 'Success green'],
  ['successHover', 'Success hover'],
  ['danger', 'Danger red'],
  ['dangerHover', 'Danger hover'],
  ['warning', 'Warning yellow'],
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

const THEME_CSS_VARS = {
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

function normalizeTheme(theme) {
  return { ...DEFAULT_THEME, ...(theme && typeof theme === 'object' ? theme : {}) };
}

function validHexColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || ''));
}

function trackerColor(trackers, trackerId) {
  return trackers.find((tracker) => tracker.id === trackerId)?.color || '#58a6ff';
}

function cssColor(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function safeName(value) {
  return String(value || 'item')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90) || 'item';
}

function categoryPath(categories, categoryId) {
  return categoryLabel(categories, categoryId).split('/').map((part) => part.trim()).filter(Boolean);
}

function flattenCategoryOptions(categories) {
  const children = new Map();
  categories.forEach((category) => {
    const key = category.parentId || '';
    children.set(key, [...(children.get(key) || []), category]);
  });

  const sort = (items) => [...items].sort((a, b) => {
    const order = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
    return order || a.name.localeCompare(b.name);
  });

  const walk = (parentId = '', depth = 0, path = []) => sort(children.get(parentId) || []).flatMap((category) => {
    const nextPath = [...path, category.name];
    return [
      { ...category, depth, label: `${'  '.repeat(depth)}${category.name}`, fullLabel: nextPath.join(' / ') },
      ...walk(category.id, depth + 1, nextPath),
    ];
  });

  return walk();
}

function findCategoryByPath(categories, path) {
  const normalized = path.map((part) => part.toLowerCase());
  return categories.find((category) => categoryPath(categories, category.id).map((part) => part.toLowerCase()).join('|') === normalized.join('|'));
}

function suggestCategoryId(name, categories) {
  const text = String(name || '').toLowerCase();
  const rules = [
    ['cat-boards', ['arduino', 'esp32', 'esp8266', 'raspberry', 'module', 'board', 'mcu', 'development']],
    ['cat-sensors', ['sensor', 'temperature', 'humidity', 'imu', 'accelerometer', 'gyro', 'pressure', 'distance']],
    ['cat-power', ['battery', 'charger', 'buck', 'boost', 'regulator', 'power', 'voltage', 'current', 'dc-dc']],
    ['cat-connectors', ['connector', 'terminal', 'header', 'socket', 'plug', 'jack', 'usb', 'wire']],
    ['cat-displays', ['display', 'oled', 'lcd', 'screen', 'tft', 'led matrix']],
    ['cat-capacitors', ['capacitor', 'capacitance']],
    ['cat-resistors', ['resistor', 'ohm']],
    ['cat-switches', ['relay', 'switch']],
    ['cat-motors', ['motor', 'servo', 'stepper', 'bearing', 'gear']],
    ['cat-tools', ['tool', 'prototype', 'breadboard', 'crimper', 'solder']],
    ['cat-mechanical', ['screw', 'bolt', 'nut', 'standoff', 'enclosure', 'case', 'bracket', 'hardware']],
  ];
  const hit = rules.find(([, terms]) => terms.some((term) => text.includes(term)));
  return categories.some((category) => category.id === hit?.[0]) ? hit[0] : 'cat-unassigned';
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted && char === '"' && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ',') {
      row.push(cell);
      cell = '';
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function pickColumn(headers, names) {
  const normalized = headers.map((header) => header.toLowerCase().replace(/[^a-z0-9]/g, ''));
  return names.map((name) => normalized.indexOf(name)).find((index) => index >= 0) ?? -1;
}

function createImportItemsFromRows(rows, parts, categories) {
  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.trim());
  const nameIndex = pickColumn(headers, ['name', 'title', 'description', 'productdescription', 'manufacturerpartnumber', 'partnumber']);
  const urlIndex = pickColumn(headers, ['url', 'producturl', 'productpageurl', 'productpage', 'link', 'productlink', 'itemurl']);
  const imageIndex = pickColumn(headers, ['image', 'imageurl', 'productimage', 'productimageurl', 'mainimage', 'mainimageurl', 'picture', 'thumbnail', 'thumbnailurl', 'imagelink', 'photourl']);
  const skuIndex = pickColumn(headers, ['sku', 'digikeypartnumber', 'supplierpartnumber']);
  const rowsToUse = nameIndex >= 0 ? rows.slice(1) : rows;

  return rowsToUse.map((row) => {
    const fallbackName = row.find((value) => value?.trim()) || 'Imported Part';
    const name = (nameIndex >= 0 ? row[nameIndex] : fallbackName)?.trim() || 'Imported Part';
    const productUrl = (urlIndex >= 0 ? row[urlIndex] : '')?.trim() || '';
    const exactMatch = productUrl
      ? parts.find((part) => part.productUrl && part.productUrl === productUrl)
      : parts.find((part) => part.name.toLowerCase() === name.toLowerCase());
    const nameMatch = !exactMatch ? parts.find((part) => part.name.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(part.name.toLowerCase())) : null;

    return {
      id: makeId('import-item'),
      name,
      productUrl,
      imageUrl: (imageIndex >= 0 ? row[imageIndex] : '')?.trim() || '',
      sku: (skuIndex >= 0 ? row[skuIndex] : '')?.trim() || '',
      categoryId: suggestCategoryId(name, categories),
      status: 'draft',
      action: exactMatch || nameMatch ? 'merge' : 'create',
      matchId: (exactMatch || nameMatch)?.id || '',
      matchQuality: exactMatch ? 'exact' : nameMatch ? 'recommended' : 'none',
      raw: row,
    };
  });
}

function decodePdfString(value) {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

async function extractBasicPdfText(file) {
  const buffer = await file.arrayBuffer();
  const raw = new TextDecoder('latin1').decode(new Uint8Array(buffer));
  const matches = [...raw.matchAll(/\((?:\\.|[^\\)])*\)/g)]
    .map((match) => decodePdfString(match[0].slice(1, -1)).trim())
    .filter((value) => value && /[a-z0-9]/i.test(value));
  return matches.join('\n').replace(/\n{3,}/g, '\n\n');
}

function createSupplierRowsFromText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const rows = [['sku', 'description']];
  const seen = new Set();

  lines.forEach((line, index) => {
    const skuMatch = line.match(/\b[A-Z0-9][A-Z0-9-]{2,}-ND\b/i);
    if (!skuMatch) return;
    const sku = skuMatch[0].toUpperCase();
    if (seen.has(sku)) return;
    seen.add(sku);
    const context = [line, lines[index + 1], lines[index + 2]]
      .filter(Boolean)
      .join(' ')
      .replace(sku, '')
      .replace(/\b\d+\s+EA\b/i, '')
      .trim();
    rows.push([sku, context || sku]);
  });

  return rows.length > 1 ? rows : [];
}

function fileNameFromUrl(url, fallback = 'part-image') {
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.split('/').filter(Boolean).pop();
    return safeName(name || fallback);
  } catch {
    return safeName(fallback);
  }
}

async function saveImageFromUrl(url, library) {
  const originalName = fileNameFromUrl(url);
  const hasExtension = /\.[a-z0-9]{2,5}$/i.test(originalName);
  return downloadUrlFile(url, library, hasExtension ? originalName : `${originalName}.jpg`);
}

function partInfoText(part, categories) {
  return [
    `Name: ${part.name}`,
    `Category: ${categoryLabel(categories, part.categoryId)}`,
    `Storage location: ${part.storageLocation || ''}`,
    `Product URL: ${part.productUrl || ''}`,
    '',
    'Spec Summary',
    part.specSummary || '',
    '',
    'Notes',
    part.notes || '',
    '',
    'Documents',
    ...(part.documents || []).map((doc) => `- ${doc.name}`),
  ].join('\n');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildProjectReadme(project, parts, categories, fileTrackers) {
  const latestFiles = project.files.filter((file) => file.latest);
  return [
    `# ${project.name}`,
    '',
    `Status: ${project.status}`,
    `Active steps: ${(project.activeSteps || []).join(', ') || 'None'}`,
    '',
    '## Notes',
    project.notes || 'No notes.',
    '',
    '## Checklist',
    ...(project.checklist || []).map((item) => `- [${item.completedAt ? 'x' : ' '}] ${item.text}${item.completedAt ? ` (${new Date(item.completedAt).toLocaleDateString()})` : ''}`),
    '',
    '## Next Steps',
    ...((project.nextSteps || []).length ? project.nextSteps.map((step) => `- ${step}`) : ['No next steps.']),
    '',
    '## Latest Files',
    ...(latestFiles.length ? latestFiles.map((file) => `- ${fileTrackerLabel(fileTrackers, file.trackerId)}: ${file.name}`) : ['No latest files.']),
    '',
    '## Parts',
    ...(parts.length ? parts.map((part) => `- ${part.name} | ${categoryLabel(categories, part.categoryId)} | ${part.storageLocation || 'No location'}`) : ['No linked parts.']),
  ].join('\n');
}

function buildBomCsv(parts, categories) {
  const rows = [
    ['Name', 'Category', 'Storage Location', 'Product URL', 'Spec Summary'],
    ...parts.map((part) => [
      part.name,
      categoryLabel(categories, part.categoryId),
      part.storageLocation || '',
      part.productUrl || '',
      part.specSummary || '',
    ]),
  ];

  return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
}

function buildGuideHtml(project, parts, categories, fileTrackers) {
  const latestFiles = project.files.filter((file) => file.latest);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(project.name)} Build Guide</title>
  <style>
    body { margin: 0; background: #f4f3ef; color: #24302f; font-family: Segoe UI, Arial, sans-serif; line-height: 1.5; }
    main { max-width: 980px; margin: 0 auto; padding: 28px; }
    h1 { margin-bottom: 4px; }
    section { border: 1px solid #d8d5ca; border-radius: 8px; background: white; padding: 16px; margin: 14px 0; }
    .meta, .muted { color: #66706d; }
    .tag { display: inline-block; border: 1px solid #bcd9d2; border-radius: 4px; background: #edf6f3; color: #1d6f63; padding: 2px 7px; margin: 3px; font-size: 12px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #ece8dd; padding: 8px; text-align: left; vertical-align: top; }
    img { max-width: 100%; border-radius: 6px; border: 1px solid #d8d5ca; }
    pre { white-space: pre-wrap; background: #fbfaf7; border: 1px solid #ece8dd; border-radius: 6px; padding: 12px; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(project.name)}</h1>
    <div class="meta">Status: ${escapeHtml(project.status)} | Exported by BuildBook v${escapeHtml(APP_VERSION)}</div>
    <section>
      <h2>Active Steps</h2>
      ${(project.activeSteps || []).map((step) => `<span class="tag">${escapeHtml(step)}</span>`).join('') || '<p class="muted">None</p>'}
    </section>
    <section>
      <h2>Notes</h2>
      <pre>${escapeHtml(project.notes || 'No notes.')}</pre>
    </section>
    <section>
      <h2>Checklist</h2>
      <ul>${(project.checklist || []).map((item) => `<li>${item.completedAt ? '&#9745;' : '&#9744;'} ${escapeHtml(item.text)}${item.completedAt ? ` <span class="muted">${escapeHtml(new Date(item.completedAt).toLocaleDateString())}</span>` : ''}</li>`).join('')}</ul>
    </section>
    <section>
      <h2>Next Steps</h2>
      <ul>${(project.nextSteps || []).map((step) => `<li>${escapeHtml(step)}</li>`).join('') || '<li class="muted">No next steps.</li>'}</ul>
    </section>
    <section>
      <h2>Latest Files</h2>
      <table><tbody>${latestFiles.map((file) => `<tr><th>${escapeHtml(fileTrackerLabel(fileTrackers, file.trackerId))}</th><td>${escapeHtml(file.name)}</td><td>${escapeHtml(file.notes || '')}</td></tr>`).join('') || '<tr><td class="muted">No latest files.</td></tr>'}</tbody></table>
    </section>
    <section>
      <h2>Parts</h2>
      <table>
        <thead><tr><th>Name</th><th>Category</th><th>Storage</th><th>Spec Summary</th></tr></thead>
        <tbody>${parts.map((part) => `<tr><td>${escapeHtml(part.name)}</td><td>${escapeHtml(categoryLabel(categories, part.categoryId))}</td><td>${escapeHtml(part.storageLocation || '')}</td><td>${escapeHtml(part.specSummary || '')}</td></tr>`).join('')}</tbody>
      </table>
    </section>
  </main>
</body>
  </html>`;
}

function buildInstructionsHtml(project, parts, photoArchiveById = new Map()) {
  const instructions = project.instructions || { intro: '', steps: [] };
  const partRows = project.partIds.map((partId) => {
    const part = parts.find((item) => item.id === partId);
    if (!part) return '';
    return `<li>${escapeHtml(part.name)} <span class="muted">Qty ${Number(project.partQuantities?.[partId]) || 1}</span></li>`;
  }).join('');
  const stepRows = (instructions.steps || []).map((step, index) => {
    const photoPath = step.photoId ? photoArchiveById.get(step.photoId) : '';
    return `<section>
      <h2>Step ${index + 1}: ${escapeHtml(step.title || '')}</h2>
      ${photoPath ? `<img src="${escapeHtml(photoPath)}" alt="${escapeHtml(step.title || `Step ${index + 1}`)}">` : ''}
      <div>${step.body || ''}</div>
    </section>`;
  }).join('');
  return `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(project.name)} Instructions</title>
    <style>
      body { margin: 0; background: #f4f3ef; color: #24302f; font-family: Segoe UI, Arial, sans-serif; line-height: 1.55; }
      main { max-width: 920px; margin: 0 auto; padding: 32px 22px; }
      section { border: 1px solid #d8d5ca; border-radius: 8px; background: white; padding: 18px; margin: 16px 0; }
      img { display: block; max-width: 100%; max-height: 720px; object-fit: contain; border: 1px solid #d8d5ca; border-radius: 8px; margin: 12px 0; }
      .muted { color: #66706d; }
      @media print { body { background: white; } section { break-inside: avoid; } }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(project.name)}</h1>
      <section><h2>Intro</h2><div>${instructions.intro || ''}</div></section>
      <section><h2>Parts List</h2><ul>${partRows || '<li>No linked parts.</li>'}</ul></section>
      ${stepRows || '<section><p class="muted">No instruction steps yet.</p></section>'}
    </main>
  </body>
  </html>`;
}

async function storedImageDataUri(path, name = '') {
  if (!path) return '';
  const bytes = await readStoredFile(path);
  let binary = '';
  new Uint8Array(bytes).forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return `data:${imageMimeType(name || path)};base64,${btoa(binary)}`;
}

async function buildPrintableInstructionsHtml(project, parts) {
  const photoArchiveById = new Map();
  for (const folder of project.photoFolders || []) {
    for (const photo of folder.photos || []) {
      const path = photo.markupPath || photo.path;
      if (path) photoArchiveById.set(photo.id, await storedImageDataUri(path, photo.name));
    }
  }
  return buildInstructionsHtml(project, parts, photoArchiveById);
}

async function addFileEntry(entries, path, packagePath) {
  if (!path || entries.some((entry) => entry.name === packagePath)) return '';
  try {
    entries.push({ name: packagePath, data: await readStoredFile(path) });
    return packagePath;
  } catch (error) {
    console.warn(`Could not package ${path}`, error);
    return '';
  }
}

async function saveZipAsset(entries, packagePath, name, library) {
  if (!packagePath || !entries.has(packagePath)) return '';
  const stored = await saveBytesFile(name || packagePath.split('/').pop(), library, entries.get(packagePath));
  return stored.path;
}

function webUploadPath(folder, name) {
  return name ? `uploads/${folder}/${name}` : '';
}

function webId(prefix, id) {
  return `${prefix}-web-${id}`;
}

function webDate(value) {
  return value || new Date().toISOString();
}

function webTrackerId(key = '') {
  return key ? `tracker-web-${key}` : 'tracker-web-other';
}

function webTrackerKey(trackerId = '') {
  if (trackerId.startsWith('tracker-web-')) return trackerId.replace(/^tracker-web-/, '') || 'other';
  const map = {
    'tracker-datasheets': 'datasheet',
    'tracker-firmware': 'firmware',
    'tracker-drawings': 'drawing',
    'tracker-models': 'enclosure',
    'tracker-bom': 'bom',
  };
  return map[trackerId] || String(trackerId || 'other').replace(/^tracker-/, '') || 'other';
}

function guessWebFileType(name = '') {
  const extension = fileExtension(name);
  if (extension === '.pdf') return 'pdf';
  if (IMAGE_EXTENSIONS.includes(extension)) return 'image';
  return 'file';
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function textSelectionTarget(target) {
  return target?.closest?.('input, textarea, [contenteditable="true"]') || null;
}

function targetHasSelection(target) {
  if (!target) return false;
  if ('selectionStart' in target && 'selectionEnd' in target) return target.selectionStart !== target.selectionEnd;
  const selection = window.getSelection?.();
  return Boolean(selection && !selection.isCollapsed && selection.toString());
}

function webUploadName(prefix, id, name, fallbackExtension = '') {
  const extension = fileExtension(name) || fallbackExtension;
  const baseName = String(name || id || prefix).split(/[\\/]/).pop() || String(id || prefix);
  const base = safeName(baseName).replace(/\.[^.]+$/, '').slice(0, 70);
  return `${safeName(prefix)}-${safeName(id)}-${base}${extension}`;
}

async function addWebUploadEntry(entries, path, folder, fileName) {
  const packagePath = `uploads/${folder}/${fileName}`;
  return addFileEntry(entries, path, packagePath);
}

async function rewriteNotesForWeb(entries, html, projectId, tableRows = []) {
  let nextHtml = String(html || '');
  const matches = [...nextHtml.matchAll(/<img\b[^>]*data-project-image-path="([^"]+)"[^>]*>/g)];
  for (const [index, match] of matches.entries()) {
    const tag = match[0];
    const path = match[1];
    const fileName = webUploadName('note', `${projectId}-${index + 1}`, path, fileExtension(path) || '.image');
    const added = await addWebUploadEntry(entries, path, 'images', fileName);
    if (!added) continue;
    tableRows.push({ image_path: fileName, archive_path: `note-images/${fileName}` });
    const exportPath = await addFileEntry(entries, path, `note-images/${fileName}`);
    const src = `/files/images/${fileName}`;
    nextHtml = nextHtml.replace(tag, tag.replace(/src="[^"]*"/, `src="${escapeHtml(src)}"`));
    if (!exportPath) tableRows[tableRows.length - 1].archive_path = '';
  }
  return nextHtml;
}

function parseWebMetadataValue(metadata, key, fallback) {
  const item = (metadata || []).find((entry) => entry.key === key);
  if (!item?.value) return fallback;
  try {
    return JSON.parse(item.value);
  } catch {
    return fallback;
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseWebMetadataArray(metadata, key) {
  return asArray(parseWebMetadataValue(metadata, key, []));
}

async function restoreWebNoteImages(entries, html, projectId) {
  let nextHtml = String(html || '');
  const matches = [...nextHtml.matchAll(/<img\b[^>]*src="\/files\/images\/([^"]+)"[^>]*>/g)];
  for (const match of matches) {
    const tag = match[0];
    const fileName = decodeURIComponent(match[1].split(/[?#]/)[0]);
    const path = await saveZipAsset(entries, webUploadPath('images', fileName), fileName, `project-note-images/${projectId}`);
    if (!path) continue;
    const restoredTag = tag
      .replace(/src="[^"]*"/, `src="${escapeHtml(assetUrl(path))}"`)
      .replace(/<img\b/, `<img data-project-image-path="${escapeHtml(path)}"`);
    nextHtml = nextHtml.replace(tag, restoredTag);
  }
  return nextHtml;
}

async function packageInlineNoteImages(entries, html, projectId, packageFolder = 'note-images') {
  let nextHtml = String(html || '');
  const matches = [...nextHtml.matchAll(/data-project-image-path="([^"]+)"/g)];
  for (const [index, match] of matches.entries()) {
    const path = match[1];
    const packagePath = await addFileEntry(entries, path, `projects/${safeName(projectId)}/${packageFolder}/inline-${index}${fileExtension(path) || '.image'}`);
    if (packagePath) {
      nextHtml = nextHtml.replace(match[0], `${match[0]} data-project-image-package-path="${escapeHtml(packagePath)}"`);
    }
  }
  return nextHtml;
}

async function restoreInlineNoteImages(entries, html, projectId, library = `project-note-images/${projectId}`) {
  let nextHtml = String(html || '');
  const matches = [...nextHtml.matchAll(/<img\b[^>]*data-project-image-package-path="([^"]+)"[^>]*>/g)];
  for (const match of matches) {
    const tag = match[0];
    const packagePath = match[1];
    const restoredPath = await saveZipAsset(entries, packagePath, packagePath.split('/').pop(), library);
    if (!restoredPath) continue;
    let restoredTag = tag.replace(/src="[^"]*"/, `src="${escapeHtml(assetUrl(restoredPath))}"`);
    restoredTag = /data-project-image-path="/.test(restoredTag)
      ? restoredTag.replace(/data-project-image-path="[^"]*"/, `data-project-image-path="${escapeHtml(restoredPath)}"`)
      : restoredTag.replace(/<img\b/, `<img data-project-image-path="${escapeHtml(restoredPath)}"`);
    restoredTag = restoredTag.replace(/\sdata-project-image-package-path="[^"]*"/, '');
    nextHtml = nextHtml.replace(tag, restoredTag);
  }
  return nextHtml;
}

async function buildFullBackupEntries(state) {
  const entries = [];
  const backupState = JSON.parse(JSON.stringify(state));

  for (const project of backupState.projects || []) {
    project.imagePackagePath = await addFileEntry(entries, project.image, `projects/${safeName(project.id)}/image/${safeName(project.name)}${fileExtension(project.image) || '.image'}`);
    if (project.imagePackagePath) project.image = '';
    project.notes = await packageInlineNoteImages(entries, project.notes, project.id);
    project.instructions = project.instructions ? {
      ...project.instructions,
      intro: await packageInlineNoteImages(entries, project.instructions.intro, project.id, 'instructions/intro-images'),
      steps: await Promise.all((project.instructions.steps || []).map(async (step) => ({
        ...step,
        body: await packageInlineNoteImages(entries, step.body, project.id, `instructions/steps/${safeName(step.id)}`),
      }))),
    } : project.instructions;

    project.noteImages = await Promise.all((project.noteImages || []).map(async (image) => {
      const packagePath = await addFileEntry(entries, image.path, `projects/${safeName(project.id)}/note-images/${safeName(image.name || image.id)}${fileExtension(image.path) || ''}`);
      return packagePath ? { ...image, path: '', packagePath } : image;
    }));

    project.photoFolders = await Promise.all((project.photoFolders || []).map(async (folder) => ({
      ...folder,
      photos: await Promise.all((folder.photos || []).map(async (photo) => {
        const packagePath = await addFileEntry(entries, photo.path, `projects/${safeName(project.id)}/photos/${safeName(folder.id)}/${safeName(photo.id)}-${safeName(photo.name)}`);
        const markupPackagePath = await addFileEntry(entries, photo.markupPath, `projects/${safeName(project.id)}/photos/${safeName(folder.id)}/markup-${safeName(photo.id)}-${safeName(photo.name)}`);
        const thumbnailPackagePath = await addFileEntry(entries, photo.thumbnailPath, `projects/${safeName(project.id)}/photos/${safeName(folder.id)}/thumb-${safeName(photo.id)}.jpg`);
        const markupThumbnailPackagePath = await addFileEntry(entries, photo.markupThumbnailPath, `projects/${safeName(project.id)}/photos/${safeName(folder.id)}/markup-thumb-${safeName(photo.id)}.jpg`);
        return {
          ...photo,
          path: packagePath ? '' : photo.path,
          markupPath: markupPackagePath ? '' : photo.markupPath,
          thumbnailPath: thumbnailPackagePath ? '' : photo.thumbnailPath,
          markupThumbnailPath: markupThumbnailPackagePath ? '' : photo.markupThumbnailPath,
          packagePath,
          markupPackagePath,
          thumbnailPackagePath,
          markupThumbnailPackagePath,
        };
      })),
    })));

    project.files = await Promise.all((project.files || []).map(async (file) => {
      if (file.type === 'folder') {
        const folderFiles = await Promise.all((file.folderFiles || []).map(async (child) => {
          const packagePath = await addFileEntry(entries, child.path, `projects/${safeName(project.id)}/files/${safeName(file.trackerId)}/${safeName(file.id)}/${safeName(child.relativePath || child.name)}`);
          return packagePath ? { ...child, path: '', packagePath } : child;
        }));
        return { ...file, folderFiles, path: '', sourcePath: '', storageMode: 'copy' };
      }
      const packagePath = await addFileEntry(entries, file.path, `projects/${safeName(project.id)}/files/${safeName(file.trackerId)}/${safeName(file.id)}-${safeName(file.name)}`);
      return packagePath ? { ...file, path: '', sourcePath: '', storageMode: 'copy', packagePath } : file;
    }));
  }

  for (const part of backupState.parts || []) {
    part.imagePackagePath = await addFileEntry(entries, part.image, `parts/${safeName(part.id)}/image/${safeName(part.name)}${fileExtension(part.image) || '.image'}`);
    if (part.imagePackagePath) part.image = '';
    part.imageThumbnailPackagePath = await addFileEntry(entries, part.imageThumbnail, `parts/${safeName(part.id)}/image/thumb-${safeName(part.name)}.jpg`);
    if (part.imageThumbnailPackagePath) part.imageThumbnail = '';
    part.documents = await Promise.all((part.documents || []).map(async (doc) => {
      const packagePath = await addFileEntry(entries, doc.path, `parts/${safeName(part.id)}/documents/${safeName(doc.id)}-${safeName(doc.name)}`);
      return packagePath ? { ...doc, path: '', sourcePath: '', storageMode: 'copy', packagePath } : doc;
    }));
  }

  for (const batch of backupState.importBatches || []) {
    batch.items = await Promise.all((batch.items || []).map(async (item) => {
      const packagePath = await addFileEntry(entries, item.imagePath, `imports/${safeName(batch.id)}/images/${safeName(item.id)}${fileExtension(item.imagePath) || '.image'}`);
      return packagePath ? { ...item, imagePath: '', imagePackagePath: packagePath } : item;
    }));
  }

  const manifest = {
    kind: 'buildbook-full-backup',
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    state: backupState,
  };
  entries.unshift({ name: 'buildbook-backup.json', data: JSON.stringify(manifest, null, 2) });
  return entries;
}

async function buildFullBackupPackage(state) {
  return createZip(await buildFullBackupEntries(state));
}

async function readFullBackupPackage(file) {
  const entries = await readZip(file);
  if (!entries.has('buildbook-backup.json') && entries.has('backup.json')) return readWebBackupPackage(entries);
  const manifest = JSON.parse(zipText(entries, 'buildbook-backup.json'));
  if (manifest.kind !== 'buildbook-full-backup') throw new Error('This is not a BuildBook full backup.');
  const restoredState = manifest.state;

  for (const project of restoredState.projects || []) {
    project.image = await saveZipAsset(entries, project.imagePackagePath, `${project.name}-image`, `project-images/${project.id}`) || project.image || '';
    delete project.imagePackagePath;
    project.notes = await restoreInlineNoteImages(entries, project.notes, project.id);
    project.instructions = project.instructions ? {
      ...project.instructions,
      intro: await restoreInlineNoteImages(entries, project.instructions.intro, project.id, `project-instructions/${project.id}/intro`),
      steps: await Promise.all((project.instructions.steps || []).map(async (step) => ({
        ...step,
        body: await restoreInlineNoteImages(entries, step.body, project.id, `project-instructions/${project.id}/steps`),
      }))),
    } : project.instructions;

    project.noteImages = await Promise.all((project.noteImages || []).map(async (image) => {
      const path = await saveZipAsset(entries, image.packagePath, image.name, `project-note-images/${project.id}`);
      const restored = path ? { ...image, path } : image;
      delete restored.packagePath;
      return restored;
    }));

    project.photoFolders = await Promise.all((project.photoFolders || []).map(async (folder) => ({
      ...folder,
      photos: await Promise.all((folder.photos || []).map(async (photo) => {
        const path = await saveZipAsset(entries, photo.packagePath, photo.name, `project-photos/${project.id}/${folder.id}`);
        const markupPath = await saveZipAsset(entries, photo.markupPackagePath, `markup-${photo.name}`, `project-photos/${project.id}/markup`);
        const thumbnailPath = await saveZipAsset(entries, photo.thumbnailPackagePath, `thumb-${photo.name}.jpg`, `project-photos/${project.id}/thumbs`);
        const markupThumbnailPath = await saveZipAsset(entries, photo.markupThumbnailPackagePath, `markup-thumb-${photo.name}.jpg`, `project-photos/${project.id}/thumbs`);
        const restored = {
          ...photo,
          path: path || photo.path || '',
          markupPath: markupPath || photo.markupPath || '',
          thumbnailPath: thumbnailPath || photo.thumbnailPath || '',
          markupThumbnailPath: markupThumbnailPath || photo.markupThumbnailPath || '',
        };
        delete restored.packagePath;
        delete restored.markupPackagePath;
        delete restored.thumbnailPackagePath;
        delete restored.markupThumbnailPackagePath;
        return restored;
      })),
    })));

    project.files = await Promise.all((project.files || []).map(async (file) => {
      if (file.type === 'folder') {
        const folderFiles = await Promise.all((file.folderFiles || []).map(async (child) => {
          const path = await saveZipAsset(entries, child.packagePath, child.name, `project-files/${project.id}/${file.trackerId}/${file.name}`);
          const restoredChild = path ? { ...child, path } : child;
          delete restoredChild.packagePath;
          return restoredChild;
        }));
        return { ...file, folderFiles, path: '', sourcePath: '', storageMode: 'copy' };
      }
      const path = await saveZipAsset(entries, file.packagePath, file.name, `project-files/${project.id}/${file.trackerId}`);
      const restored = path ? { ...file, path, sourcePath: '', storageMode: 'copy' } : file;
      delete restored.packagePath;
      return restored;
    }));
  }

  for (const part of restoredState.parts || []) {
    part.image = await saveZipAsset(entries, part.imagePackagePath, `${part.name}-image`, `part-images/${part.id}`) || part.image || '';
    delete part.imagePackagePath;
    part.imageThumbnail = await saveZipAsset(entries, part.imageThumbnailPackagePath, `thumb-${part.name}.jpg`, `part-images/${part.id}/thumbs`) || part.imageThumbnail || '';
    delete part.imageThumbnailPackagePath;
    part.documents = await Promise.all((part.documents || []).map(async (doc) => {
      const path = await saveZipAsset(entries, doc.packagePath, doc.name, `part-documents/${part.id}`);
      const restored = path ? { ...doc, path, sourcePath: '', storageMode: 'copy' } : doc;
      delete restored.packagePath;
      return restored;
    }));
  }

  for (const batch of restoredState.importBatches || []) {
    batch.items = await Promise.all((batch.items || []).map(async (item) => {
      const imagePath = await saveZipAsset(entries, item.imagePackagePath, `${item.name || item.id}-image`, `import-images/${batch.id}`);
      const restored = imagePath ? { ...item, imagePath } : item;
      delete restored.imagePackagePath;
      return restored;
    }));
  }

  return normalizeState(restoredState);
}

async function readWebBackupPackage(entries) {
  const backup = JSON.parse(zipText(entries, 'backup.json'));
  if (backup.type !== 'buildbook-web-backup') throw new Error('This is not a supported BuildBook backup.');

  const webTrackers = parseWebMetadataArray(backup.app_metadata, 'file_trackers');
  const fileTrackers = (webTrackers.length ? webTrackers : [
    { key: 'datasheet', label: 'Datasheets', extensions: '.pdf' },
    { key: 'firmware', label: 'Firmware', extensions: '.ino,.cpp,.h' },
    { key: 'drawing', label: 'Drawings', extensions: '.dwg,.dxf' },
    { key: 'enclosure', label: 'Enclosure', extensions: '.stl,.step,.3mf' },
    { key: 'bom', label: 'PCB BOM', extensions: '.xlsx,.xls,.csv,.tsv' },
    { key: 'other', label: 'Other', extensions: '' },
  ]).map((tracker) => ({
    id: webTrackerId(tracker.key),
    name: tracker.label || tracker.key || 'Files',
    extensions: tracker.extensions || '',
    programPath: '',
  }));
  const trackerIds = new Set(fileTrackers.map((tracker) => tracker.id));

  const categories = [
    { id: 'cat-unassigned', name: 'Unassigned', parentId: null, sortOrder: 0 },
    ...asArray(backup.category)
      .slice()
      .sort((a, b) => (a.order_index || 0) - (b.order_index || 0) || String(a.name).localeCompare(String(b.name)))
      .map((category, index) => ({
        id: webId('cat', category.id),
        name: category.name || 'Category',
        parentId: category.parent_id ? webId('cat', category.parent_id) : null,
        sortOrder: index + 1,
      })),
  ];
  const categoryIds = new Set(categories.map((category) => category.id));

  const documentsByPart = new Map();
  for (const doc of asArray(backup.part_document)) {
    const partId = webId('part', doc.part_id);
    const path = await saveZipAsset(entries, webUploadPath('documents', doc.file_path), doc.original_filename || doc.file_path, `part-documents/${partId}`);
    const nextDoc = {
      id: webId('doc', doc.id),
      name: doc.original_filename || doc.file_path || 'Document',
      path,
      type: doc.file_type || 'document',
      storageMode: 'copy',
      sourcePath: '',
      createdAt: webDate(doc.uploaded_at),
    };
    documentsByPart.set(partId, [...(documentsByPart.get(partId) || []), nextDoc]);
  }

  const parts = await Promise.all(asArray(backup.part).map(async (part) => {
    const id = webId('part', part.id);
    const categoryId = part.category_id ? webId('cat', part.category_id) : 'cat-unassigned';
    const image = await saveZipAsset(entries, webUploadPath('images', part.image_path), `${part.name || id}-image`, `part-images/${id}`);
    return {
      id,
      name: part.name || 'Imported Part',
      categoryId: categoryIds.has(categoryId) ? categoryId : 'cat-unassigned',
      image,
      productUrl: part.product_url || '',
      storageLocation: part.storage_location || '',
      specSummary: part.spec_summary || '',
      notes: part.notes || '',
      documents: documentsByPart.get(id) || [],
      createdAt: webDate(part.created_at),
      updatedAt: webDate(part.updated_at),
    };
  }));

  const checklistByProject = new Map();
  for (const item of asArray(backup.project_checklist_item)) {
    const projectId = webId('project', item.project_id);
    checklistByProject.set(projectId, [...(checklistByProject.get(projectId) || []), {
      id: webId('check', item.id),
      text: item.text || '',
      completedAt: item.is_completed ? webDate(item.completed_at) : '',
    }]);
  }

  const stepNameById = new Map(asArray(backup.step_definition).map((step) => [step.id, step.name]));
  const activeStepsByProject = new Map();
  for (const step of asArray(backup.project_step)) {
    const projectId = webId('project', step.project_id);
    const name = stepNameById.get(step.step_definition_id);
    if (name) activeStepsByProject.set(projectId, [...(activeStepsByProject.get(projectId) || []), name]);
  }

  const filesByProject = new Map();
  for (const file of asArray(backup.project_file)) {
    const projectId = webId('project', file.project_id);
    const trackerId = trackerIds.has(webTrackerId(file.tracker_key)) ? webTrackerId(file.tracker_key) : webTrackerId('other');
    const path = await saveZipAsset(entries, webUploadPath('projects', file.file_path), file.original_filename || file.file_path, `project-files/${projectId}/${trackerId}`);
    filesByProject.set(projectId, [...(filesByProject.get(projectId) || []), {
      id: webId('file', file.id),
      trackerId,
      name: file.original_filename || file.file_path || 'File',
      path,
      sourcePath: '',
      storageMode: 'copy',
      size: 0,
      contentHash: '',
      latest: Boolean(file.is_latest),
      notes: file.version_note || '',
      createdAt: webDate(file.uploaded_at),
    }]);
  }

  const linksByProject = new Map();
  for (const link of asArray(backup.project_part)) {
    const projectId = webId('project', link.project_id);
    const partId = webId('part', link.part_id);
    linksByProject.set(projectId, [...(linksByProject.get(projectId) || []), { partId, quantity: Number(link.quantity) || 1 }]);
  }

  const projects = await Promise.all(asArray(backup.project).map(async (project) => {
    const id = webId('project', project.id);
    const image = await saveZipAsset(entries, webUploadPath('images', project.image_path), `${project.name || id}-image`, `project-images/${id}`);
    const links = linksByProject.get(id) || [];
    return {
      id,
      name: project.name || 'Imported Project',
      status: project.status || 'active',
      image,
      activeSteps: activeStepsByProject.get(id) || [],
      notes: await restoreWebNoteImages(entries, project.notes, id),
      checklist: checklistByProject.get(id) || [],
      nextSteps: [],
      partIds: links.map((link) => link.partId).filter((partId) => parts.some((part) => part.id === partId)),
      partQuantities: Object.fromEntries(links.map((link) => [link.partId, link.quantity])),
      files: filesByProject.get(id) || [],
      noteImages: [],
      createdAt: webDate(project.created_at),
      updatedAt: webDate(project.updated_at),
    };
  }));

  const itemsByBatch = new Map();
  for (const item of asArray(backup.import_item)) {
    const batchId = webId('batch', item.import_batch_id);
    itemsByBatch.set(batchId, [...(itemsByBatch.get(batchId) || []), {
      id: webId('import', item.id),
      name: item.raw_name || 'Import item',
      sku: '',
      productUrl: item.product_url || '',
      imageUrl: item.product_image_url || '',
      imagePath: '',
      categoryId: 'cat-unassigned',
      action: item.status === 'draft' ? 'create' : 'merge',
      status: item.status === 'draft' ? 'draft' : 'imported',
      matchId: item.resolved_part_id ? webId('part', item.resolved_part_id) : '',
      matchQuality: item.suggested_part_id || item.resolved_part_id ? 'recommended' : 'none',
      notes: [item.attributes, item.store, item.ordered_at ? `Ordered: ${item.ordered_at}` : ''].filter(Boolean).join('\n'),
      raw: item,
    }]);
  }

  const importBatches = asArray(backup.import_batch).map((batch) => {
    const id = webId('batch', batch.id);
    return {
      id,
      name: batch.original_filename || `Import ${batch.id}`,
      fileName: batch.original_filename || '',
      source: batch.source || 'web backup',
      createdAt: webDate(batch.imported_at),
      items: itemsByBatch.get(id) || [],
    };
  });

  return normalizeState({
    version: APP_VERSION,
    lanServer: { enabled: false, port: 8787, token: '', requireToken: true },
    categories,
    template: {
      steps: asArray(backup.step_definition).slice().sort((a, b) => (a.order_index || 0) - (b.order_index || 0)).map((step) => step.name).filter(Boolean),
      checklist: parseWebMetadataArray(backup.app_metadata, 'template_checklist'),
      fileTrackers,
    },
    projects,
    parts,
    importBatches,
  });
}

function webFileTrackersFromProjectManifest(manifest) {
  const byKey = new Map([
    ['datasheet', { id: webTrackerId('datasheet'), name: 'Datasheets', extensions: '.pdf', programPath: '' }],
    ['firmware', { id: webTrackerId('firmware'), name: 'Firmware', extensions: '.ino,.cpp,.h', programPath: '' }],
    ['drawing', { id: webTrackerId('drawing'), name: 'Drawings', extensions: '.dwg,.dxf', programPath: '' }],
    ['enclosure', { id: webTrackerId('enclosure'), name: 'Enclosure', extensions: '.stl,.step,.3mf', programPath: '' }],
    ['bom', { id: webTrackerId('bom'), name: 'PCB BOM', extensions: '.xlsx,.xls,.csv,.tsv', programPath: '' }],
    ['other', { id: webTrackerId('other'), name: 'Other', extensions: '', programPath: '' }],
  ]);
  for (const file of manifest.files || []) {
    const key = file.tracker_key || 'other';
    if (!byKey.has(key)) {
      byKey.set(key, {
        id: webTrackerId(key),
        name: file.file_category?.split('-')[0]?.trim() || key,
        extensions: '',
        programPath: '',
      });
    }
  }
  return [...byKey.values()];
}

async function readWebProjectPackage(entries) {
  const webManifest = JSON.parse(zipText(entries, 'project-manifest.json'));
  if (webManifest.type !== 'buildbook-web-project-export') throw new Error('This is not a BuildBook_Web project export.');
  const now = new Date().toISOString();
  const fileTrackers = webFileTrackersFromProjectManifest(webManifest);
  const noteImages = (webManifest.note_images || []).map((image, index) => ({
    id: webId('note-img', index + 1),
    name: image.image_path || `note-image-${index + 1}`,
    path: '',
    packagePath: image.archive_path || '',
  }));
  let notes = String(webManifest.project?.notes || '');
  for (const image of webManifest.note_images || []) {
    if (!image.archive_path || !image.image_path) continue;
    const source = `/files/images/${image.image_path}`;
    notes = notes.split(source).join(source);
    notes = notes.replace(
      new RegExp(`(<img\\b(?=[^>]*${image.image_path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})[^>]*)>`, 'g'),
      `$1 data-project-image-package-path="${escapeHtml(image.archive_path)}">`,
    );
  }

  const files = (webManifest.files || []).map((file, index) => ({
    id: webId('file', file.id || index + 1),
    trackerId: webTrackerId(file.tracker_key || 'other'),
    name: file.original_filename || file.archive_path?.split('/').pop() || 'File',
    path: '',
    sourcePath: '',
    storageMode: 'copy',
    size: 0,
    contentHash: '',
    latest: file.is_latest !== false,
    notes: file.version_note || '',
    createdAt: webDate(file.uploaded_at),
    packagePath: file.archive_path || '',
  }));

  const parts = (webManifest.parts || []).map((part, index) => ({
    id: webId('part', index + 1),
    name: part.name || 'Imported Part',
    categoryId: 'cat-unassigned',
    categoryPath: Array.isArray(part.category_path) ? part.category_path : String(part.category_label || '').split('/').map((item) => item.trim()).filter(Boolean),
    image: '',
    imagePackagePath: part.image_archive_path || '',
    productUrl: part.product_url || '',
    storageLocation: part.storage_location || '',
    specSummary: part.spec_summary || '',
    notes: part.notes || '',
    quantity: Number(part.quantity) || 1,
    documents: (part.documents || []).map((doc, docIndex) => ({
      id: webId('doc', `${index + 1}-${doc.id || docIndex + 1}`),
      name: doc.original_filename || doc.archive_path?.split('/').pop() || 'Document',
      path: '',
      type: doc.file_type || guessWebFileType(doc.original_filename),
      storageMode: 'copy',
      sourcePath: '',
      createdAt: webDate(doc.uploaded_at),
      packagePath: doc.archive_path || '',
    })),
    createdAt: now,
    updatedAt: now,
  }));

  return {
    manifest: {
      kind: 'buildbook-project-package',
      version: webManifest.version || APP_VERSION,
      exportedAt: webManifest.exported_at || now,
      categories: [],
      fileTrackers,
      project: {
        id: webId('project', 1),
        name: webManifest.project?.name || 'Imported Project',
        status: webManifest.project?.status || 'active',
        image: '',
        imagePackagePath: webManifest.project?.image_archive_path || '',
        activeSteps: (webManifest.steps || []).sort((a, b) => (a.order_index || 0) - (b.order_index || 0)).map((step) => step.name).filter(Boolean),
        notes,
        noteImages,
        checklist: (webManifest.checklist || []).sort((a, b) => (a.order_index || 0) - (b.order_index || 0)).map((item, index) => ({
          id: webId('check', index + 1),
          text: item.text || '',
          completedAt: item.is_completed ? webDate(item.completed_at) : '',
        })),
        nextSteps: [],
        partIds: parts.map((part) => part.id),
        partQuantities: Object.fromEntries(parts.map((part) => [part.id, part.quantity])),
        files,
        createdAt: now,
        updatedAt: now,
      },
      parts,
    },
    entries,
  };
}

async function buildWebProjectPackage(state, project, exportOptions = {}) {
  const options = { ...DEFAULT_PROJECT_EXPORT_OPTIONS, ...exportOptions };
  const entries = [];
  const now = new Date().toISOString();
  const linkedParts = options.linkedParts ? project.partIds.map((id) => state.parts.find((part) => part.id === id)).filter(Boolean) : [];
  const noteImages = [];
  const notes = options.overviewNotes ? await rewriteNotesForWeb(entries, project.notes, project.id, noteImages) : '';
  const projectImageName = options.overviewNotes && project.image ? webUploadName('project', project.id, `${project.name}${fileExtension(project.image) || '.image'}`) : '';
  const projectImageArchive = projectImageName ? `project-image/${projectImageName}` : '';
  if (project.image && projectImageName) await addFileEntry(entries, project.image, projectImageArchive);
  const photoArchiveById = new Map();
  const photoLibrary = [];
  const includePhotoAssets = options.photos || options.instructions;
  if (includePhotoAssets) {
    for (const folder of project.photoFolders || []) {
      const exportedPhotos = [];
      for (const photo of folder.photos || []) {
        const archivePath = `project-photos/${safeName(folder.name)}/${safeName(photo.name)}`;
        await addFileEntry(entries, photo.path, archivePath);
        const markupArchivePath = photo.markupPath ? `project-photos/${safeName(folder.name)}/markup-${safeName(photo.name)}` : '';
        if (photo.markupPath) await addFileEntry(entries, photo.markupPath, markupArchivePath);
        photoArchiveById.set(photo.id, markupArchivePath || archivePath);
        if (options.photos) exportedPhotos.push({ ...photo, path: '', markupPath: '', thumbnailPath: '', markupThumbnailPath: '', archive_path: archivePath, markup_archive_path: markupArchivePath });
      }
      if (options.photos) photoLibrary.push({ id: folder.id, name: folder.name, photos: exportedPhotos });
    }
  }

  const files = [];
  let fileIndex = 1;
  const projectFilesToExport = options.allFileVersions
    ? project.files
    : options.latestFiles
      ? project.files.filter((item) => item.latest)
      : [];
  for (const file of projectFilesToExport) {
    const addManifestFile = async (sourcePath, originalName, notesText, createdAt, trackerId) => {
      if (!sourcePath) return;
      const archivePath = `${file.latest ? 'latest-files' : 'older-files'}/${fileIndex}-${safeName(originalName)}`;
      await addFileEntry(entries, sourcePath, archivePath);
      const tracker = state.template.fileTrackers.find((item) => item.id === trackerId);
      files.push({
        id: fileIndex,
        original_filename: originalName,
        file_type: guessWebFileType(originalName),
        tracker_key: webTrackerKey(trackerId),
        file_category: `${tracker?.name || 'Imported'}-${tracker?.extensions || ''}`,
        version_note: notesText || null,
        is_latest: Boolean(file.latest),
        uploaded_at: createdAt || now,
        archive_path: archivePath,
      });
      fileIndex += 1;
    };
    if (file.type === 'folder') {
      for (const child of file.folderFiles || []) {
        await addManifestFile(child.path, child.relativePath || child.name, file.notes, child.createdAt || file.createdAt, file.trackerId);
      }
    } else {
      await addManifestFile(file.path, file.name, file.notes, file.createdAt, file.trackerId);
    }
  }

  const parts = [];
  for (const [partIndex, part] of linkedParts.entries()) {
    const partImageName = part.image ? webUploadName('part', part.id, `${part.name}${fileExtension(part.image) || '.image'}`) : '';
    const partImageArchive = partImageName ? `part-images/${partImageName}` : '';
    if (part.image && partImageArchive) await addFileEntry(entries, part.image, partImageArchive);
    const documents = [];
    if (options.partDocuments) {
      for (const [docIndex, doc] of (part.documents || []).entries()) {
        const archivePath = `part-documents/${partIndex + 1}/${docIndex + 1}-${safeName(doc.name)}`;
        await addFileEntry(entries, doc.path, archivePath);
        documents.push({
          id: docIndex + 1,
          file_type: doc.type || guessWebFileType(doc.name),
          file_path: '',
          text_content: null,
          original_filename: doc.name,
          is_primary: docIndex === 0,
          uploaded_at: doc.createdAt || now,
          archive_path: archivePath,
        });
      }
    }
    parts.push({
      name: part.name,
      quantity: Number(project.partQuantities?.[part.id]) || 1,
      category_path: categoryPath(state.categories, part.categoryId),
      category_label: categoryLabel(state.categories, part.categoryId),
      product_url: part.productUrl || null,
      storage_location: part.storageLocation || null,
      notes: part.notes || null,
      spec_summary: part.specSummary || null,
      image_archive_path: partImageArchive,
      documents,
    });
  }

  const manifest = {
    type: 'buildbook-web-project-export',
    version: APP_VERSION,
    exported_at: now,
    project: {
      name: project.name,
      status: project.status,
      notes,
      image_path: projectImageName,
      image_archive_path: projectImageArchive,
    },
    note_images: noteImages.map((image) => ({ image_path: image.image_path, archive_path: image.archive_path })),
    steps: (project.activeSteps || []).map((name, index) => ({ name, order_index: (index + 1) * 10 })),
    checklist: options.overviewChecklist ? (project.checklist || []).map((item, index) => ({
      text: item.text,
      is_completed: Boolean(item.completedAt),
      completed_at: item.completedAt || null,
      order_index: index,
    })) : [],
    files,
    parts,
    photo_library: photoLibrary,
    instructions: options.instructions ? project.instructions || { intro: '', steps: [] } : { intro: '', steps: [] },
    desktop_export_options: options,
  };

  const summaryProject = {
    ...project,
    notes: options.overviewNotes ? project.notes : '',
    checklist: options.overviewChecklist ? project.checklist : [],
  };
  entries.unshift({ name: 'project-summary.html', data: buildGuideHtml(summaryProject, linkedParts, state.categories, state.template.fileTrackers) });
  if (options.instructions) entries.push({ name: 'instructions.html', data: buildInstructionsHtml(project, linkedParts, photoArchiveById) });
  if (options.overviewNotes) entries.push({ name: 'notes.txt', data: stripHtml(notes) });
  entries.push({ name: 'project-manifest.json', data: JSON.stringify(manifest, null, 2) });
  entries.push({ name: 'project-data.json', data: JSON.stringify(manifest, null, 2) });
  return createZip(entries);
}

async function buildWebFullBackupPackage(state) {
  const entries = [];
  const now = new Date().toISOString();
  let nextId = 1;
  const alloc = () => nextId++;
  const categoryIds = new Map();
  const partIds = new Map();
  const projectIds = new Map();
  const stepIds = new Map();
  const backup = {
    type: 'buildbook-web-backup',
    version: 3,
    app_version: APP_VERSION,
    exported_at: now,
    includes_uploads: true,
    app_metadata: [
      { key: 'file_trackers', value: JSON.stringify(state.template.fileTrackers.map((tracker) => ({ key: webTrackerKey(tracker.id), label: tracker.name, extensions: tracker.extensions || '' }))) },
      { key: 'template_checklist', value: JSON.stringify(state.template.checklist || []) },
    ],
    category: [],
    part: [],
    part_document: [],
    project: [],
    project_part: [],
    project_file: [],
    project_checklist_item: [],
    step_definition: [],
    project_step: [],
    import_batch: [],
    import_item: [],
  };

  for (const category of state.categories.filter((item) => item.id !== 'cat-unassigned')) categoryIds.set(category.id, alloc());
  for (const category of state.categories.filter((item) => item.id !== 'cat-unassigned')) {
    backup.category.push({
      id: categoryIds.get(category.id),
      name: category.name,
      description: null,
      parent_id: category.parentId ? categoryIds.get(category.parentId) || null : null,
      image_path: null,
      order_index: category.sortOrder || 0,
      created_at: now,
      updated_at: now,
    });
  }

  for (const [index, step] of (state.template.steps || []).entries()) {
    const id = alloc();
    stepIds.set(step, id);
    backup.step_definition.push({ id, name: step, order_index: (index + 1) * 10 });
  }

  for (const part of state.parts) partIds.set(part.id, alloc());
  for (const part of state.parts) {
    const id = partIds.get(part.id);
    const imageName = part.image ? webUploadName('part', id, `${part.name}${fileExtension(part.image) || '.image'}`) : null;
    if (part.image && imageName) await addWebUploadEntry(entries, part.image, 'images', imageName);
    backup.part.push({
      id,
      category_id: part.categoryId === 'cat-unassigned' ? null : categoryIds.get(part.categoryId) || null,
      name: part.name,
      product_url: part.productUrl || null,
      storage_location: part.storageLocation || null,
      notes: part.notes || null,
      spec_summary: part.specSummary || null,
      image_path: imageName,
      created_at: part.createdAt || now,
      updated_at: part.updatedAt || now,
    });
    for (const [docIndex, doc] of (part.documents || []).entries()) {
      const docId = alloc();
      const docName = webUploadName('doc', docId, doc.name);
      if (doc.path && docName) await addWebUploadEntry(entries, doc.path, 'documents', docName);
      backup.part_document.push({
        id: docId,
        part_id: id,
        file_type: doc.type || guessWebFileType(doc.name),
        file_path: doc.path ? docName : null,
        text_content: null,
        original_filename: doc.name,
        is_primary: docIndex === 0,
        uploaded_at: doc.createdAt || now,
      });
    }
  }

  for (const project of state.projects) projectIds.set(project.id, alloc());
  for (const project of state.projects) {
    const id = projectIds.get(project.id);
    const imageName = project.image ? webUploadName('project', id, `${project.name}${fileExtension(project.image) || '.image'}`) : null;
    if (project.image && imageName) await addWebUploadEntry(entries, project.image, 'images', imageName);
    const notes = await rewriteNotesForWeb(entries, project.notes, id, []);
    backup.project.push({
      id,
      name: project.name,
      status: project.status || 'active',
      notes,
      image_path: imageName,
      created_at: project.createdAt || now,
      updated_at: project.updatedAt || now,
    });
    for (const [index, item] of (project.checklist || []).entries()) {
      backup.project_checklist_item.push({
        id: alloc(),
        project_id: id,
        text: item.text,
        is_completed: Boolean(item.completedAt),
        completed_at: item.completedAt || null,
        order_index: index,
      });
    }
    for (const stepName of project.activeSteps || []) {
      if (stepIds.has(stepName)) backup.project_step.push({ project_id: id, step_definition_id: stepIds.get(stepName), created_at: project.createdAt || now });
    }
    for (const partId of project.partIds || []) {
      if (!partIds.has(partId)) continue;
      backup.project_part.push({ id: alloc(), project_id: id, part_id: partIds.get(partId), added_at: project.createdAt || now, quantity: Number(project.partQuantities?.[partId]) || 1 });
    }
    for (const file of project.files || []) {
      const addProjectFile = async (sourcePath, originalName, item) => {
        if (!sourcePath) return;
        const fileId = alloc();
        const uploadName = webUploadName('project-file', fileId, originalName);
        if (sourcePath && uploadName) await addWebUploadEntry(entries, sourcePath, 'projects', uploadName);
        const tracker = state.template.fileTrackers.find((current) => current.id === item.trackerId);
        backup.project_file.push({
          id: fileId,
          project_id: id,
          file_path: uploadName,
          original_filename: originalName,
          file_type: guessWebFileType(originalName),
          tracker_key: webTrackerKey(item.trackerId),
          file_category: `${tracker?.name || 'Imported'}-${tracker?.extensions || ''}`,
          version_note: item.notes || null,
          is_latest: Boolean(item.latest),
          uploaded_at: item.createdAt || now,
        });
      };
      if (file.type === 'folder') {
        for (const child of file.folderFiles || []) await addProjectFile(child.path, child.relativePath || child.name, file);
      } else {
        await addProjectFile(file.path, file.name, file);
      }
    }
  }

  for (const batch of state.importBatches || []) {
    const batchId = alloc();
    backup.import_batch.push({ id: batchId, source: batch.source || 'desktop', original_filename: batch.fileName || batch.name || 'Import', imported_at: batch.createdAt || now });
    for (const item of batch.items || []) {
      backup.import_item.push({
        id: alloc(),
        import_batch_id: batchId,
        status: item.status || 'draft',
        raw_name: item.name || '',
        product_url: item.productUrl || null,
        product_image_url: item.imageUrl || null,
        attributes: item.notes || null,
        store: null,
        ordered_at: null,
        suggested_part_id: item.matchId && partIds.has(item.matchId) ? partIds.get(item.matchId) : null,
        resolved_part_id: item.status === 'imported' && item.matchId && partIds.has(item.matchId) ? partIds.get(item.matchId) : null,
        created_at: item.createdAt || batch.createdAt || now,
        updated_at: item.updatedAt || batch.createdAt || now,
      });
    }
  }

  entries.unshift({ name: 'backup.json', data: JSON.stringify(backup, null, 2) });
  const packagedNames = new Set(entries.map((entry) => entry.name));
  const desktopEntries = await buildFullBackupEntries(state);
  desktopEntries.forEach((entry) => {
    if (!packagedNames.has(entry.name)) entries.push(entry);
  });
  return createZip(entries);
}

async function buildProjectPackage(state, project) {
  const entries = [];
  const linkedParts = project.partIds.map((id) => state.parts.find((part) => part.id === id)).filter(Boolean);
  const exportedProject = {
    ...project,
    imagePackagePath: '',
    files: [],
    noteImages: [],
  };

  exportedProject.imagePackagePath = await addFileEntry(entries, project.image, `project/image/${safeName(project.name)}${fileExtension(project.image) || '.image'}`);

  for (const image of project.noteImages || []) {
    const packagePath = await addFileEntry(entries, image.path, `project/note-images/${safeName(image.name)}`);
    exportedProject.noteImages.push({ ...image, path: '', packagePath });
  }

  for (const file of project.files.filter((item) => item.latest)) {
    if (file.type === 'folder') {
      const folderFiles = [];
      for (const child of file.folderFiles || []) {
        const packagePath = await addFileEntry(entries, child.path, `project/latest-files/${safeName(fileTrackerLabel(state.template.fileTrackers, file.trackerId))}/${safeName(file.name)}/${safeName(child.relativePath || child.name)}`);
        folderFiles.push({ ...child, path: '', sourcePath: '', packagePath });
      }
      exportedProject.files.push({ ...file, path: '', sourcePath: '', folderFiles });
      continue;
    }
    const packagePath = await addFileEntry(entries, file.path, `project/latest-files/${safeName(fileTrackerLabel(state.template.fileTrackers, file.trackerId))}/${safeName(file.name)}`);
    exportedProject.files.push({ ...file, path: '', sourcePath: '', packagePath });
  }

  const exportedParts = [];
  for (const part of linkedParts) {
    const exportedPart = {
      ...part,
      quantity: Number(project.partQuantities?.[part.id]) || 1,
      image: '',
      imagePackagePath: '',
      imageThumbnail: '',
      imageThumbnailPackagePath: '',
      categoryPath: categoryPath(state.categories, part.categoryId),
      documents: [],
    };
    exportedPart.imagePackagePath = await addFileEntry(entries, part.image, `parts/${safeName(part.name)}/image${fileExtension(part.image) || '.image'}`);
    exportedPart.imageThumbnailPackagePath = await addFileEntry(entries, part.imageThumbnail, `parts/${safeName(part.name)}/thumb.jpg`);
    entries.push({ name: `parts/${safeName(part.name)}/part-info.txt`, data: partInfoText(part, state.categories) });
    for (const doc of part.documents || []) {
      const packagePath = await addFileEntry(entries, doc.path, `parts/${safeName(part.name)}/documents/${safeName(doc.name)}`);
      exportedPart.documents.push({ ...doc, path: '', sourcePath: '', packagePath });
    }
    exportedParts.push(exportedPart);
  }

  const manifest = {
    kind: 'buildbook-project-package',
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    categories: state.categories,
    fileTrackers: state.template.fileTrackers,
    project: exportedProject,
    parts: exportedParts,
  };

  entries.unshift({ name: 'buildbook-package.json', data: JSON.stringify(manifest, null, 2) });
  entries.push({ name: 'project-notes.txt', data: project.notes || '' });
  entries.push({ name: 'README.md', data: buildProjectReadme(project, linkedParts, state.categories, state.template.fileTrackers) });
  entries.push({ name: 'build-guide.html', data: buildGuideHtml(project, linkedParts, state.categories, state.template.fileTrackers) });
  entries.push({ name: 'parts-bom.csv', data: buildBomCsv(linkedParts, state.categories) });
  return createZip(entries);
}

async function readProjectPackage(file) {
  const entries = await readZip(file);
  if (!entries.has('buildbook-package.json') && entries.has('project-manifest.json')) return readWebProjectPackage(entries);
  const manifest = JSON.parse(zipText(entries, 'buildbook-package.json'));
  if (manifest.kind !== 'buildbook-project-package') throw new Error('This is not a BuildBook project package.');
  return { manifest, entries };
}

function ProjectImportReview({ state, packageData, onCancel, onImport }) {
  const { manifest, entries } = packageData;
  const categoryOptions = flattenCategoryOptions(state.categories);
  const [projectName, setProjectName] = useState(
    state.projects.some((project) => project.name === manifest.project.name)
      ? `${manifest.project.name} (Imported)`
      : manifest.project.name,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [categoryDecisions, setCategoryDecisions] = useState(() => Object.fromEntries(manifest.parts.map((part) => {
    const exact = findCategoryByPath(state.categories, part.categoryPath || []);
    return [part.id, exact?.id || suggestCategoryId(part.name, state.categories)];
  })));
  const [partActions, setPartActions] = useState(() => Object.fromEntries(manifest.parts.map((part) => {
    const match = findMatchingPart(state.parts, part);
    return [part.id, { action: match ? 'reuse' : 'create', partId: match?.id || '' }];
  })));

  const sortedParts = [...manifest.parts].sort((a, b) => {
    const quality = (part) => {
      const exact = findCategoryByPath(state.categories, part.categoryPath || []);
      if (!categoryDecisions[part.id] || categoryDecisions[part.id] === 'cat-unassigned') return 0;
      return exact ? 2 : 1;
    };
    return quality(a) - quality(b) || a.name.localeCompare(b.name);
  });

  const savePackagedAsset = async (packagePath, name, library) => {
    if (!packagePath || !entries.has(packagePath)) return '';
    const stored = await saveBytesFile(name || packagePath.split('/').pop(), library, entries.get(packagePath));
    return stored.path;
  };

  const completeImport = async () => {
    setBusy(true);
    setError('');
    try {
      const projectId = makeId('project');
      const importedPartIds = [];
      const importedPartQuantities = {};
      const createdParts = [];
      const updatedParts = [...state.parts];
      const importedTrackers = (manifest.fileTrackers || []).filter((tracker) => !state.template.fileTrackers.some((current) => current.id === tracker.id));
      const projectImage = await savePackagedAsset(manifest.project.imagePackagePath, `${projectName}-image`, `project-images/${projectId}`);
      const importedNoteImages = [];

      for (const image of manifest.project.noteImages || []) {
        const path = await savePackagedAsset(image.packagePath, image.name, `project-note-images/${projectId}`);
        importedNoteImages.push({ ...image, id: makeId('note-img'), path, packagePath: '' });
      }

      const importedFiles = [];
      for (const file of manifest.project.files || []) {
        if (file.type === 'folder') {
          const folderFiles = [];
          for (const child of file.folderFiles || []) {
            const path = await savePackagedAsset(child.packagePath, child.name, `project-files/${projectId}/${file.trackerId}/${file.name}`);
            folderFiles.push({ ...child, path, packagePath: '' });
          }
          importedFiles.push({ ...file, id: makeId('file'), folderFiles, path: '', sourcePath: '', packagePath: '', latest: true, createdAt: new Date().toISOString() });
          continue;
        }
        const path = await savePackagedAsset(file.packagePath, file.name, `project-files/${projectId}/${file.trackerId}`);
        importedFiles.push({ ...file, id: makeId('file'), path, sourcePath: '', packagePath: '', latest: true, createdAt: new Date().toISOString() });
      }

      for (const part of manifest.parts || []) {
        const decision = partActions[part.id] || { action: 'create', partId: '' };
        const existing = decision.action === 'reuse' ? updatedParts.find((item) => item.id === decision.partId) : null;

        if (existing) {
          importedPartIds.push(existing.id);
          importedPartQuantities[existing.id] = Number(part.quantity) || Number(manifest.project.partQuantities?.[part.id]) || 1;
          continue;
        }

        const newPartId = makeId('part');
        const image = await savePackagedAsset(part.imagePackagePath, `${part.name}-image`, `part-images/${newPartId}`);
        const imageThumbnail = await savePackagedAsset(part.imageThumbnailPackagePath, `thumb-${part.name}.jpg`, `part-images/${newPartId}/thumbs`);
        const documents = [];
        for (const doc of part.documents || []) {
          const path = await savePackagedAsset(doc.packagePath, doc.name, `part-documents/${newPartId}`);
          documents.push({ ...doc, id: makeId('doc'), path, sourcePath: '', packagePath: '', storageMode: 'copy' });
        }
        const createdPart = {
          ...part,
          id: newPartId,
          categoryId: categoryDecisions[part.id] || 'cat-unassigned',
          image,
          imageThumbnail,
          documents,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        delete createdPart.categoryPath;
        delete createdPart.imagePackagePath;
        delete createdPart.imageThumbnailPackagePath;
        createdParts.push(createdPart);
        importedPartIds.push(newPartId);
        importedPartQuantities[newPartId] = Number(part.quantity) || Number(manifest.project.partQuantities?.[part.id]) || 1;
      }

      const importedProject = {
        ...manifest.project,
        id: projectId,
        name: projectName.trim() || manifest.project.name,
        image: projectImage,
        imagePackagePath: '',
        partIds: importedPartIds,
        partQuantities: importedPartQuantities,
        files: importedFiles,
        noteImages: importedNoteImages,
        notes: await restoreInlineNoteImages(entries, manifest.project.notes, projectId),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      onImport({
        ...state,
        template: {
          ...state.template,
          fileTrackers: [...state.template.fileTrackers, ...importedTrackers],
        },
        parts: [...createdParts, ...updatedParts],
        projects: [importedProject, ...state.projects],
      }, projectId);
    } catch (importError) {
      setError(String(importError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onCancel()}>
      <div className="modal import-review-modal">
        <div className="section-title">
          <h2>Import Project Package</h2>
          <button className="ghost" onClick={onCancel}>Close</button>
        </div>
        <label>Project Name<input value={projectName} onChange={(event) => setProjectName(event.target.value)} /></label>
        <div className="import-review-list">
          {sortedParts.map((part) => {
            const exact = findCategoryByPath(state.categories, part.categoryPath || []);
            const decision = partActions[part.id] || { action: 'create', partId: '' };
            return (
              <section key={part.id} className={`import-part-row match-${exact ? 'exact' : categoryDecisions[part.id] === 'cat-unassigned' ? 'none' : 'recommended'}`}>
                <label>
                  Exported Category: {(part.categoryPath || ['Unassigned']).join(' / ')}
                  <select value={categoryDecisions[part.id] || 'cat-unassigned'} onChange={(event) => setCategoryDecisions((current) => ({ ...current, [part.id]: event.target.value }))}>
                    {categoryOptions.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
                  </select>
                </label>
                <div className="import-part-summary">
                  <strong>{part.name}</strong>
                  <span>{exact ? 'Exact category match' : categoryDecisions[part.id] === 'cat-unassigned' ? 'No category suggestion' : 'Suggested category selected'}</span>
                </div>
                <div className="import-action-grid">
                  <select value={decision.action} onChange={(event) => setPartActions((current) => ({ ...current, [part.id]: { ...decision, action: event.target.value } }))}>
                    <option value="create">Create new part</option>
                    <option value="reuse">Reuse existing part</option>
                  </select>
                  {decision.action === 'reuse' && (
                    <select value={decision.partId} onChange={(event) => setPartActions((current) => ({ ...current, [part.id]: { ...decision, partId: event.target.value } }))}>
                      <option value="">Choose part...</option>
                      {state.parts.map((partOption) => <option key={partOption.id} value={partOption.id}>{partOption.name}</option>)}
                    </select>
                  )}
                </div>
              </section>
            );
          })}
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="modal-footer">
          <button className="secondary" onClick={onCancel}>Cancel</button>
          <button onClick={completeImport} disabled={busy}>{busy ? 'Importing...' : 'Import Project'}</button>
        </div>
      </div>
    </div>
  );
}

function findMatchingPart(parts, importedPart) {
  if (importedPart.productUrl) {
    const byUrl = parts.find((part) => part.productUrl && part.productUrl === importedPart.productUrl);
    if (byUrl) return byUrl;
  }
  return parts.find((part) => part.name.toLowerCase() === importedPart.name.toLowerCase());
}

export default function App() {
  const [tab, setTab] = useState('projects');
  const [state, setState] = useState(null);
  const [saveState, setSaveState] = useState('saved');
  const saveTimerRef = useRef(null);
  const saveSequenceRef = useRef(0);
  const selectionGuardRef = useRef({ source: null, x: 0, y: 0, block: false, timer: 0 });

  useEffect(() => {
    loadAppState().then(setState);
  }, []);

  useEffect(() => {
    if (!state) return;
    const theme = normalizeTheme(state.theme);
    Object.entries(THEME_CSS_VARS).forEach(([key, cssVar]) => {
      document.documentElement.style.setProperty(cssVar, theme[key]);
    });
  }, [state?.theme]);

  useEffect(() => () => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
  }, []);

  const updateState = (recipe) => {
    setState((current) => {
      const next = normalizeState(typeof recipe === 'function' ? recipe(current) : recipe);
      const saveSequence = saveSequenceRef.current + 1;
      saveSequenceRef.current = saveSequence;
      setSaveState('saving');
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        saveAppState(next)
          .then(() => {
            if (saveSequenceRef.current === saveSequence) setSaveState('saved');
          })
          .catch((error) => {
            console.error(error);
            if (saveSequenceRef.current === saveSequence) setSaveState('error');
          });
      }, 450);
      return next;
    });
  };

  useEffect(() => {
    if (!state) return;
    const lan = state.lanServer || {};
    if (lan.enabled && lan.requireToken !== false && !lan.token) {
      const token = crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      updateState((current) => ({ ...current, lanServer: { ...(current.lanServer || {}), token } }));
      return;
    }
    if (lan.enabled && (lan.token || lan.requireToken === false)) {
      startLanServer(lan.port || 8787, lan.token || '', lan.requireToken !== false).catch((error) => console.error(error));
      return;
    }
    stopLanServer().catch(() => {});
  }, [state?.lanServer?.enabled, state?.lanServer?.port, state?.lanServer?.token, state?.lanServer?.requireToken]);

  if (!state) return <div className="loading">Loading BuildBook...</div>;

  const handlePointerDownCapture = (event) => {
    const source = textSelectionTarget(event.target);
    selectionGuardRef.current = {
      source,
      x: event.clientX,
      y: event.clientY,
      block: false,
      timer: selectionGuardRef.current.timer,
    };
  };

  const handlePointerUpCapture = (event) => {
    const guard = selectionGuardRef.current;
    if (!guard.source) return;
    const moved = Math.hypot(event.clientX - guard.x, event.clientY - guard.y) > 5;
    if (!moved && !targetHasSelection(guard.source)) return;
    window.clearTimeout(guard.timer);
    selectionGuardRef.current = {
      ...guard,
      block: true,
      timer: window.setTimeout(() => {
        selectionGuardRef.current = { source: null, x: 0, y: 0, block: false, timer: 0 };
      }, 160),
    };
  };

  const handleClickCapture = (event) => {
    if (!selectionGuardRef.current.block) return;
    event.preventDefault();
    event.stopPropagation();
    selectionGuardRef.current = { source: null, x: 0, y: 0, block: false, timer: 0 };
  };

  return (
    <div className="app" onPointerDownCapture={handlePointerDownCapture} onPointerUpCapture={handlePointerUpCapture} onClickCapture={handleClickCapture}>
      <aside className="sidebar">
        <div className="brand">
          <strong>BuildBook</strong>
          <span>v{APP_VERSION}</span>
        </div>
        {TABS.map(([key, label, type]) => (
          <button key={key} className={`${tab === key ? 'active' : ''} ${type === 'child' ? 'sub-nav' : ''}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
        <div className={`save-state ${saveState}`}>{saveState}</div>
      </aside>
      <main className="workspace">
        {tab === 'projects' && <Projects state={state} updateState={updateState} />}
        {tab === 'completed-projects' && <Projects state={state} updateState={updateState} initialFilter="completed" lockedFilter />}
        {tab === 'parts' && <Parts state={state} updateState={updateState} />}
        {tab === 'search' && <Search state={state} setTab={setTab} />}
        {tab === 'imports' && <Imports state={state} updateState={updateState} />}
        {tab === 'settings' && <Settings state={state} updateState={updateState} />}
      </main>
    </div>
  );
}

function Projects({ state, updateState, initialFilter = 'open', lockedFilter = false }) {
  const [selectedId, setSelectedId] = useState('');
  const [pendingImport, setPendingImport] = useState(null);
  const [importError, setImportError] = useState('');
  const [filter, setFilter] = useState(initialFilter);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectError, setNewProjectError] = useState('');
  const selected = state.projects.find((project) => project.id === selectedId);
  const visibleProjects = state.projects
    .filter((project) => (
      filter === 'all' ? true
        : filter === 'open' ? !['archived', 'completed'].includes(project.status)
          : project.status === filter
    ))
    .sort((a, b) => {
      const order = { active: 0, waiting: 1, paused: 2, completed: 3, archived: 4 };
      return ((order[a.status] ?? 99) - (order[b.status] ?? 99)) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

  useEffect(() => {
    if (selected && !visibleProjects.some((project) => project.id === selected.id)) setSelectedId('');
  }, [selected, visibleProjects]);

  const openNewProjectDialog = () => {
    setNewProjectName('');
    setNewProjectError('');
    setNewProjectOpen(true);
  };

  const createProject = (event) => {
    event?.preventDefault();
    const name = newProjectName.trim();
    if (!name) {
      setNewProjectError('Project name is required.');
      return;
    }

    const project = {
      id: makeId('project'),
      name,
      status: 'active',
      image: '',
      activeSteps: [],
      notes: '',
      noteImages: [],
      checklist: state.template.checklist.map((text) => ({ id: makeId('check'), text, completedAt: '' })),
      nextSteps: [],
      partIds: [],
      partQuantities: {},
      photoFolders: [],
      instructions: { intro: '', steps: [] },
      files: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    updateState((current) => ({ ...current, projects: [project, ...current.projects] }));
    setNewProjectOpen(false);
    setNewProjectName('');
    setNewProjectError('');
    setSelectedId(project.id);
  };

  const updateProject = (projectId, patch) => {
    updateState((current) => ({
      ...current,
      projects: current.projects.map((project) =>
        project.id === projectId ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project,
      ),
    }));
  };

  const updatePart = (partId, patch) => {
    updateState((current) => ({
      ...current,
      parts: current.parts.map((part) =>
        part.id === partId ? { ...part, ...patch, updatedAt: new Date().toISOString() } : part,
      ),
    }));
  };

  const createPartForProject = (projectId, draft) => {
    const now = new Date().toISOString();
    const partId = makeId('part');
    const part = {
      id: partId,
      name: draft.name.trim(),
      categoryId: draft.categoryId || 'cat-unassigned',
      image: '',
      productUrl: draft.productUrl || '',
      storageLocation: draft.storageLocation || '',
      specSummary: draft.specSummary || '',
      notes: draft.notes || '',
      documents: [],
      createdAt: now,
      updatedAt: now,
    };
    updateState((current) => ({
      ...current,
      parts: [part, ...current.parts],
      projects: current.projects.map((project) => project.id === projectId
        ? {
            ...project,
            partIds: project.partIds.includes(partId) ? project.partIds : [...project.partIds, partId],
            partQuantities: { ...(project.partQuantities || {}), [partId]: Number(draft.quantity) || 1 },
            updatedAt: now,
          }
        : project),
    }));
    return partId;
  };

  const duplicateProject = (project) => {
    const now = new Date().toISOString();
    const copy = {
      ...project,
      id: makeId('project'),
      name: `${project.name} Copy`,
      status: 'active',
      checklist: project.checklist.map((item) => ({ ...item, id: makeId('check') })),
      files: project.files.map((file) => ({ ...file, id: makeId('file') })),
      noteImages: (project.noteImages || []).map((image) => ({ ...image, id: makeId('note-img') })),
      photoFolders: (project.photoFolders || []).map((folder) => ({
        ...folder,
        id: makeId('photo-folder'),
        photos: (folder.photos || []).map((photo) => ({ ...photo, id: makeId('photo') })),
      })),
      instructions: {
        intro: project.instructions?.intro || '',
        steps: (project.instructions?.steps || []).map((step) => ({ ...step, id: makeId('instruction-step') })),
      },
      partQuantities: { ...(project.partQuantities || {}) },
      createdAt: now,
      updatedAt: now,
    };
    updateState((current) => ({ ...current, projects: [copy, ...current.projects] }));
    setSelectedId(copy.id);
  };

  const deleteProject = (projectId) => {
    if (!window.confirm('Delete this project from BuildBook? Attached copied files will remain in the app folder for now.')) return;
    updateState((current) => ({ ...current, projects: current.projects.filter((project) => project.id !== projectId) }));
    setSelectedId('');
  };

  const importProjectPackage = async (file) => {
    if (!file) return;
    setImportError('');
    try {
      setPendingImport(await readProjectPackage(file));
    } catch (error) {
      setImportError(String(error));
    }
  };

  if (selected) {
    return (
      <ProjectWorkspace
        state={state}
        project={selected}
        parts={state.parts}
        template={state.template}
        categories={state.categories}
        onBack={() => setSelectedId('')}
        onUpdate={(patch) => updateProject(selected.id, patch)}
        onUpdatePart={updatePart}
        onCreatePart={createPartForProject}
        onDuplicate={() => duplicateProject(selected)}
        onDelete={() => deleteProject(selected.id)}
      />
    );
  }

  return (
    <div>
      <Header
        title={lockedFilter && filter === 'completed' ? 'Completed Projects' : 'Projects'}
        subtitle={lockedFilter && filter === 'completed' ? 'Finished build records kept for reference.' : 'Your build notebook: notes, parts, files, checklist, and the next thing to do.'}
      >
        <label className="file-picker header-picker">
          <input
            type="file"
            accept=".zip,.buildbook.zip"
            onChange={(event) => {
              importProjectPackage(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          Import Project
        </label>
        <button onClick={openNewProjectDialog}>New Project</button>
      </Header>
      {!lockedFilter && (
        <div className="filters">
          {['open', 'all', 'active', 'waiting', 'paused', 'archived'].map((key) => (
            <button
              key={key}
              className={filter === key ? '' : 'secondary'}
              onClick={() => setFilter(key)}
            >
              {key === 'open' ? 'Open' : key === 'all' ? 'All' : key}
            </button>
          ))}
        </div>
      )}
      {importError && <section className="panel error-text">{importError}</section>}

      {visibleProjects.length === 0 ? (
        <section className="panel empty-panel">
          No projects found.
        </section>
      ) : (
        <div className="project-grid">
          {visibleProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onOpen={() => setSelectedId(project.id)}
            />
          ))}
        </div>
      )}
      {pendingImport && (
        <ProjectImportReview
          state={state}
          packageData={pendingImport}
          onCancel={() => setPendingImport(null)}
          onImport={(nextState, importedProjectId) => {
            updateState(() => nextState);
            setPendingImport(null);
            setSelectedId(importedProjectId);
          }}
        />
      )}
      {newProjectOpen && (
        <div className="modal-overlay">
          <form className="modal compact-modal" onSubmit={createProject}>
            <div className="section-title">
              <h2>New Project</h2>
              <button type="button" className="ghost modal-x" onClick={() => setNewProjectOpen(false)}>x</button>
            </div>
            <label>
              Project name
              <input
                autoFocus
                value={newProjectName}
                onChange={(event) => {
                  setNewProjectName(event.target.value);
                  if (newProjectError) setNewProjectError('');
                }}
                placeholder="Project name"
              />
            </label>
            {newProjectError && <p className="error-text">{newProjectError}</p>}
            <div className="modal-footer">
              <button type="button" className="secondary" onClick={() => setNewProjectOpen(false)}>Cancel</button>
              <button type="submit">Create</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project, onOpen }) {
  const totalTasks = project.checklist.length;
  const doneTasks = project.checklist.filter((item) => item.completedAt).length;
  const progress = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const latestFiles = project.files.filter((file) => file.latest);

  return (
    <button className="project-card" onClick={onOpen}>
      <div className="project-card-image">
        {project.image ? <ProjectThumbnail path={project.image} alt="" /> : <div>Project</div>}
        <span className={`status-badge status-${project.status}`}>{project.status}</span>
      </div>
      <div className="project-card-body">
        <strong>{project.name}</strong>
        <div className="project-step-tags">
          {project.activeSteps.slice(0, 4).map((step) => <span key={step}>{step}</span>)}
          {project.activeSteps.length > 4 && <span>+{project.activeSteps.length - 4}</span>}
        </div>
        <div className="mini-meta">
          <span>{project.partIds.length} parts</span>
          <span>{doneTasks}/{totalTasks} tasks</span>
          <span>{latestFiles.length} latest files</span>
        </div>
        {totalTasks > 0 && <div className="progress-bar"><div style={{ width: `${progress}%` }} /></div>}
      </div>
    </button>
  );
}

function Search({ state, setTab }) {
  const [query, setQuery] = useState('');
  const trimmed = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!trimmed) return null;
    const match = (...values) => values.some((value) => String(value || '').toLowerCase().includes(trimmed));
    return {
      projects: state.projects.filter((project) => match(project.name, project.status, project.notes, ...(project.nextSteps || []))),
      parts: state.parts.filter((part) => match(part.name, categoryLabel(state.categories, part.categoryId), part.storageLocation, part.specSummary, part.notes)),
      files: state.projects.flatMap((project) => project.files.map((file) => ({ ...file, projectName: project.name, projectId: project.id })))
        .filter((file) => match(file.name, file.notes, fileTrackerLabel(state.template.fileTrackers, file.trackerId), file.projectName)),
      documents: state.parts.flatMap((part) => part.documents.map((doc) => ({ ...doc, partName: part.name, partId: part.id })))
        .filter((doc) => match(doc.name, doc.type, doc.partName)),
      imports: state.importBatches.flatMap((batch) => (batch.items || []).map((item) => ({ ...item, batchName: batch.name || batch.fileName || batch.id })))
        .filter((item) => match(item.raw?.name, item.name, item.batchName, item.status)),
    };
  }, [trimmed, state]);
  const total = results ? Object.values(results).reduce((sum, rows) => sum + rows.length, 0) : 0;

  const ResultSection = ({ title, rows, children }) => (
    <section className="panel search-section">
      <div className="section-title">
        <h3>{title}</h3>
        <span className="muted-count">{rows.length}</span>
      </div>
      {rows.length ? children : <p>No matches.</p>}
    </section>
  );

  return (
    <div>
      <Header title="Search" subtitle="Find projects, parts, datasheets, project files, and import drafts." />
      <div className="search-hero">
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by part, project, file, datasheet, storage location..."
        />
        {query && <button className="secondary" onClick={() => setQuery('')}>Clear</button>}
      </div>
      {!trimmed && <section className="panel empty-panel">Start typing to search across the app.</section>}
      {trimmed && results && <p className="muted-count">{total} result(s) for "{query.trim()}"</p>}
      {results && (
        <div className="search-grid">
          <ResultSection title="Projects" rows={results.projects}>
            <div className="search-list">
              {results.projects.map((project) => (
                <button key={project.id} onClick={() => setTab('projects')}>
                  <strong>{project.name}</strong>
                  <span>{project.status} project</span>
                </button>
              ))}
            </div>
          </ResultSection>
          <ResultSection title="Parts" rows={results.parts}>
            <div className="search-list">
              {results.parts.map((part) => (
                <button key={part.id} onClick={() => setTab('parts')}>
                  <strong>{part.name}</strong>
                  <span>{categoryLabel(state.categories, part.categoryId)}{part.storageLocation ? ` - ${part.storageLocation}` : ''}</span>
                </button>
              ))}
            </div>
          </ResultSection>
          <ResultSection title="Project Files" rows={results.files}>
            <div className="search-list">
              {results.files.map((file) => (
                <button key={file.id} onClick={() => setTab('projects')}>
                  <strong>{file.name}</strong>
                  <span>{file.projectName} - {fileTrackerLabel(state.template.fileTrackers, file.trackerId)}{file.latest ? ' - latest' : ''}</span>
                </button>
              ))}
            </div>
          </ResultSection>
          <ResultSection title="Part Documents" rows={results.documents}>
            <div className="search-list">
              {results.documents.map((doc) => (
                <button key={doc.id} onClick={() => setTab('parts')}>
                  <strong>{doc.name}</strong>
                  <span>{doc.partName} - {doc.type || 'document'}</span>
                </button>
              ))}
            </div>
          </ResultSection>
          <ResultSection title="Imports" rows={results.imports}>
            <div className="search-list">
              {results.imports.map((item, index) => (
                <button key={`${item.id || item.name || item.batchName}-${index}`} onClick={() => setTab('imports')}>
                  <strong>{item.raw?.name || item.name || 'Import item'}</strong>
                  <span>{item.batchName}{item.status ? ` - ${item.status}` : ''}</span>
                </button>
              ))}
            </div>
          </ResultSection>
        </div>
      )}
    </div>
  );
}

function normalizeRichText(value) {
  const text = String(value || '');
  if (!text.trim()) return '';
  if (/<[a-z][\s\S]*>/i.test(text)) return text;
  return text
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function NoteImageMarkupModal({ source, onCancel, onSave }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source) return;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const scale = Math.min(1, 1200 / image.naturalWidth, 800 / image.naturalHeight);
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = source;
  }, [source]);

  const canvasPoint = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvasRef.current.width / rect.width),
      y: (event.clientY - rect.top) * (canvasRef.current.height / rect.height),
    };
  };

  const draw = (event) => {
    if (!drawingRef.current) return;
    const point = canvasPoint(event);
    const previous = lastPointRef.current || point;
    const context = canvasRef.current.getContext('2d');
    context.strokeStyle = cssColor('--danger-hover', '#f85149');
    context.lineWidth = 5;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(previous.x, previous.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    lastPointRef.current = point;
  };

  return (
    <div className="modal-overlay">
      <div className="modal markup-modal">
        <div className="section-title">
          <h2>Markup Image</h2>
          <button className="ghost" onClick={onCancel}>Close</button>
        </div>
        <canvas
          ref={canvasRef}
          className="markup-canvas"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            drawingRef.current = true;
            lastPointRef.current = canvasPoint(event);
          }}
          onPointerMove={draw}
          onPointerUp={() => {
            drawingRef.current = false;
            lastPointRef.current = null;
          }}
          onPointerCancel={() => {
            drawingRef.current = false;
            lastPointRef.current = null;
          }}
        />
        <div className="modal-footer">
          <button className="secondary" onClick={onCancel}>Cancel</button>
          <button onClick={() => onSave(canvasRef.current.toDataURL('image/png'))}>Save Markup</button>
        </div>
      </div>
    </div>
  );
}

function RichTextEditor({ value, onChange, onUploadImage, placeholder = 'Write notes...' }) {
  const editorRef = useRef(null);
  const selectionRef = useRef(null);
  const fileInputRef = useRef(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [imageWidth, setImageWidth] = useState(100);
  const [markupSource, setMarkupSource] = useState('');

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const normalized = normalizeRichText(value);
    if (editor.innerHTML !== normalized) editor.innerHTML = normalized;
  }, [value]);

  const rememberSelection = () => {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    selectionRef.current = selection.getRangeAt(0).cloneRange();
  };

  const restoreSelection = () => {
    const selection = window.getSelection();
    if (!selection) return;
    const range = selectionRef.current;
    if (range) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  };

  const emitChange = () => {
    onChange(editorRef.current?.innerHTML || '');
  };

  const selectImage = (image) => {
    editorRef.current?.querySelectorAll('img.rich-image-selected').forEach((item) => item.classList.remove('rich-image-selected'));
    image.classList.add('rich-image-selected');
    setSelectedImage(image);
    setImageWidth(Math.round(Number.parseFloat(image.style.width) || 100));
  };

  const updateImageWidth = (width) => {
    if (!selectedImage) return;
    selectedImage.style.width = `${width}%`;
    selectedImage.style.maxWidth = '100%';
    selectedImage.style.height = 'auto';
    setImageWidth(width);
    emitChange();
  };

  const exec = (command, commandValue = null) => {
    editorRef.current?.focus();
    restoreSelection();
    document.execCommand(command, false, commandValue);
    rememberSelection();
    emitChange();
  };

  const insertImage = async (file) => {
    if (!file) return;
    const stored = await onUploadImage(file);
    if (!stored?.path) return;
    const previewUrl = URL.createObjectURL(file);
    editorRef.current?.focus();
    restoreSelection();
    const html = `<p><img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(stored.name || 'Project note image')}" style="width:100%;max-width:100%;height:auto;border-radius:6px;" data-project-image-path="${escapeHtml(stored.path)}"></p><p><br></p>`;
    document.execCommand('insertHTML', false, html);
    rememberSelection();
    emitChange();
  };

  return (
    <div className="rich-editor">
      <div className="rich-toolbar">
        <button type="button" className="ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => exec('bold')}>B</button>
        <button type="button" className="ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => exec('italic')}>I</button>
        <button type="button" className="ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => exec('underline')}>U</button>
        <button type="button" className="ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => exec('insertUnorderedList')}>List</button>
        <button type="button" className="ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => exec('formatBlock', '<h2>')}>H2</button>
        <button type="button" className="ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => exec('formatBlock', '<p>')}>Text</button>
        <button type="button" className="ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => fileInputRef.current?.click()}>Image</button>
        {selectedImage && (
          <div className="rich-image-tools">
            <span>Image size</span>
            <input type="range" min="20" max="100" value={imageWidth} onChange={(event) => updateImageWidth(Number(event.target.value))} />
            <button type="button" className="ghost" onMouseDown={(event) => event.preventDefault()} onClick={() => setMarkupSource(selectedImage.src)}>Markup</button>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={async (event) => {
            await insertImage(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </div>
      <div
        ref={editorRef}
        className="rich-area"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={emitChange}
        onClick={(event) => {
          if (event.target?.tagName === 'IMG') selectImage(event.target);
        }}
        onBlur={() => {
          rememberSelection();
          emitChange();
        }}
        onKeyUp={rememberSelection}
        onMouseUp={rememberSelection}
      />
      {markupSource && (
        <NoteImageMarkupModal
          source={markupSource}
          onCancel={() => setMarkupSource('')}
          onSave={(dataUrl) => {
            if (selectedImage) {
              selectedImage.src = dataUrl;
              selectedImage.removeAttribute('data-project-image-path');
              emitChange();
            }
            setMarkupSource('');
          }}
        />
      )}
    </div>
  );
}

function ProjectExportModal({ project, onCancel, onExport }) {
  const [format, setFormat] = useState('fullZip');
  const [options, setOptions] = useState(FULL_PROJECT_EXPORT_OPTIONS);
  const [exporting, setExporting] = useState(false);
  const photoCount = (project.photoFolders || []).reduce((total, folder) => total + (folder.photos?.length || 0), 0);
  const customOptions = format === 'selectedZip';

  const applyFormat = (nextFormat) => {
    setFormat(nextFormat);
    if (nextFormat === 'fullZip') setOptions(FULL_PROJECT_EXPORT_OPTIONS);
    if (nextFormat === 'instructionsPdf' || nextFormat === 'instructionsHtml') {
      setOptions({
        ...DEFAULT_PROJECT_EXPORT_OPTIONS,
        overviewNotes: false,
        overviewChecklist: false,
        instructions: true,
        photos: true,
        linkedParts: true,
        latestFiles: false,
        allFileVersions: false,
        partDocuments: false,
      });
    }
    if (nextFormat === 'selectedZip') setOptions(DEFAULT_PROJECT_EXPORT_OPTIONS);
  };

  const toggleOption = (key) => {
    setOptions((current) => ({
      ...current,
      [key]: !current[key],
      ...(key === 'allFileVersions' && !current[key] ? { latestFiles: true } : {}),
    }));
  };

  const runExport = async () => {
    setExporting(true);
    try {
      await onExport(format, options);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onCancel()}>
      <div className="modal project-export-modal">
        <div className="section-title">
          <div>
            <h2>Export Project</h2>
            <p>{project.name}</p>
          </div>
        </div>
        <label>
          Export type
          <select value={format} onChange={(event) => applyFormat(event.target.value)}>
            <option value="fullZip">Full project zip</option>
            <option value="instructionsPdf">Instructions PDF using browser print</option>
            <option value="instructionsHtml">Instructions HTML</option>
            <option value="selectedZip">Selected files/photos/parts zip</option>
          </select>
        </label>
        {customOptions && (
          <div className="export-option-grid">
            <label><input type="checkbox" checked={options.overviewNotes} onChange={() => toggleOption('overviewNotes')} /><span>Overview Notes</span></label>
            <label><input type="checkbox" checked={options.overviewChecklist} onChange={() => toggleOption('overviewChecklist')} /><span>Overview Checklist</span></label>
            <label><input type="checkbox" checked={options.instructions} onChange={() => toggleOption('instructions')} /><span>Instructions</span></label>
            <label><input type="checkbox" checked={options.photos} onChange={() => toggleOption('photos')} /><span>Photos ({photoCount})</span></label>
            <label><input type="checkbox" checked={options.linkedParts} onChange={() => toggleOption('linkedParts')} /><span>Linked Parts ({project.partIds.length})</span></label>
            <label><input type="checkbox" checked={options.partDocuments} onChange={() => toggleOption('partDocuments')} /><span>Part Documents</span></label>
            <label><input type="checkbox" checked={options.latestFiles} onChange={() => toggleOption('latestFiles')} /><span>Current/latest tracked files</span></label>
            <label><input type="checkbox" checked={options.allFileVersions} onChange={() => toggleOption('allFileVersions')} /><span>All tracked file versions</span></label>
            <label><input type="checkbox" checked readOnly /><span>Include project-manifest.json</span></label>
          </div>
        )}
        <div className="modal-actions">
          <button className="secondary" onClick={onCancel} disabled={exporting}>Cancel</button>
          <button onClick={runExport} disabled={exporting}>{exporting ? 'Exporting...' : 'Export'}</button>
        </div>
      </div>
    </div>
  );
}

function ProjectWorkspace({ state, project, parts, template, categories, onBack, onUpdate, onUpdatePart, onCreatePart, onDuplicate, onDelete }) {
  const [projectTab, setProjectTab] = useState('overview');
  const [imageBusy, setImageBusy] = useState(false);
  const [imagePreview, setImagePreview] = useState('');
  const [exportNotice, setExportNotice] = useState('');
  const [showExportModal, setShowExportModal] = useState(false);
  const linkedParts = project.partIds.map((id) => parts.find((part) => part.id === id)).filter(Boolean);
  const latestFiles = project.files.filter((file) => file.latest);

  useEffect(() => {
    if (!project.image) setImagePreview('');
  }, [project.image]);

  const updateImage = async (file) => {
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    setImagePreview(previewUrl);
    setImageBusy(true);
    try {
      const stored = await savePickedFile(file, `project-images/${project.id}`);
      onUpdate({ image: stored.path });
      window.setTimeout(() => URL.revokeObjectURL(previewUrl), 1000);
    } finally {
      setImageBusy(false);
    }
  };

  const toggleStep = (step) => {
    const activeSteps = project.activeSteps.includes(step)
      ? project.activeSteps.filter((item) => item !== step)
      : [...project.activeSteps, step];
    onUpdate({ activeSteps });
  };

  const showExportMessage = (message) => {
    setExportNotice(message);
    window.clearTimeout(window.__buildBookExportNotice);
    window.__buildBookExportNotice = window.setTimeout(() => setExportNotice(''), 2600);
  };

  const exportProject = async (format, options) => {
    const exportParts = options.linkedParts ? linkedParts : [];
    if (format === 'instructionsPdf') {
      const html = await buildPrintableInstructionsHtml(project, exportParts);
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      window.open(url, '_blank');
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      showExportMessage('Instructions opened. Use browser print to save as PDF.');
      setShowExportModal(false);
      return;
    }
    if (format === 'instructionsHtml') {
      const html = await buildPrintableInstructionsHtml(project, exportParts);
      downloadBytes(`${safeName(project.name)}-instructions.html`, new TextEncoder().encode(html), 'text/html');
      showExportMessage('Instructions HTML exported.');
      setShowExportModal(false);
      return;
    }
    const bytes = await buildWebProjectPackage(state, project, options);
    downloadBytes(`${safeName(project.name)}-export.zip`, bytes, 'application/zip');
    showExportMessage('Project exported.');
    setShowExportModal(false);
  };

  return (
    <div>
      <button className="back-link" onClick={onBack}>Back to projects</button>
      <section className="project-hero">
        <div className="project-image">
          {imagePreview ? <img src={imagePreview} alt="" /> : project.image ? <StoredImage path={project.image} alt="" /> : <div>Project</div>}
          <label className="file-picker image-picker">
            <input
              type="file"
              accept="image/*"
              onChange={(event) => {
                updateImage(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            {imageBusy ? 'Saving...' : project.image ? 'Change Image' : 'Add Image'}
          </label>
        </div>
        <div className="project-heading">
          <input className="project-name-input" value={project.name} onChange={(event) => onUpdate({ name: event.target.value })} />
          <div className="status-line">
            <span className={`status-badge status-${project.status}`}>{project.status}</span>
            <select value={project.status} onChange={(event) => onUpdate({ status: event.target.value })}>
              {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </div>
          <div className="mini-meta">
            <span>{linkedParts.length} linked parts</span>
            <span>{project.files.length} files</span>
            <span>{latestFiles.length} latest files</span>
          </div>
        </div>
        <div className="step-tags hero-steps">
          <button onClick={() => setShowExportModal(true)}>Export Project</button>
          <button className="danger-fill" onClick={onDelete}>Delete</button>
        </div>
      </section>
      {showExportModal && <ProjectExportModal project={project} onCancel={() => setShowExportModal(false)} onExport={exportProject} />}
      {exportNotice && <p className="export-notice">{exportNotice}</p>}
      <ProjectTagControls project={project} steps={template.steps} onToggle={toggleStep} className="project-header-tags" />
      <div className="tabs">
        <button className={`tab ${projectTab === 'overview' ? 'active' : ''}`} onClick={() => setProjectTab('overview')}>Overview</button>
        <button className={`tab ${projectTab === 'instructions' ? 'active' : ''}`} onClick={() => setProjectTab('instructions')}>Instructions</button>
        <button className={`tab ${projectTab === 'photos' ? 'active' : ''}`} onClick={() => setProjectTab('photos')}>Photos ({(project.photoFolders || []).reduce((total, folder) => total + (folder.photos?.length || 0), 0)})</button>
        <button className={`tab ${projectTab === 'parts' ? 'active' : ''}`} onClick={() => setProjectTab('parts')}>Parts ({linkedParts.length})</button>
        <button className={`tab ${projectTab === 'files' ? 'active' : ''}`} onClick={() => setProjectTab('files')}>Files ({project.files.length})</button>
      </div>
      {projectTab === 'overview' && <ProjectOverviewTab project={project} template={template} onUpdate={onUpdate} />}
      {projectTab === 'parts' && <ProjectPartsTab project={project} parts={parts} categories={categories} template={template} onUpdate={onUpdate} onUpdatePart={onUpdatePart} />}
      {projectTab === 'files' && <ProjectFilesTab project={project} template={template} onUpdate={onUpdate} />}
      {projectTab === 'photos' && <ProjectPhotosTab project={project} onUpdate={onUpdate} />}
      {projectTab === 'instructions' && <ProjectInstructionsTab project={project} parts={parts} categories={categories} onUpdate={onUpdate} onCreatePart={onCreatePart} />}
    </div>
  );
}

function ProjectTagControls({ project, steps, onToggle, className = '' }) {
  return (
    <section className={`project-tags-panel ${className}`}>
      <h3>Project Tags</h3>
      <div className="step-tags quick-tag-grid">
        {steps.map((step) => (
          <button key={step} className={project.activeSteps.includes(step) ? 'tag active' : 'tag'} onClick={() => onToggle(step)}>
            {step}
          </button>
        ))}
      </div>
      {!project.activeSteps.length && <p>No quick tags selected yet.</p>}
    </section>
  );
}

function ProjectOverviewTab({ project, template, onUpdate }) {
  const [newChecklist, setNewChecklist] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [recentlyCompleted, setRecentlyCompleted] = useState([]);
  const visibleChecklist = showCompleted
    ? [...project.checklist].sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''))
    : project.checklist.filter((item) => !item.completedAt || recentlyCompleted.includes(item.id));
  const latestFiles = project.files.filter((file) => file.latest);

  const addChecklistItem = () => {
    if (!newChecklist.trim()) return;
    onUpdate({ checklist: [...project.checklist, { id: makeId('check'), text: newChecklist.trim(), completedAt: '' }] });
    setNewChecklist('');
  };

  const completeChecklistItem = (itemId) => {
    setRecentlyCompleted((current) => [...current, itemId]);
    onUpdate({
      checklist: project.checklist.map((item) =>
        item.id === itemId ? { ...item, completedAt: new Date().toISOString() } : item,
      ),
    });
    window.setTimeout(() => {
      setRecentlyCompleted((current) => current.filter((id) => id !== itemId));
    }, 3000);
  };

  const addNoteImage = async (file) => {
    if (!file) return;
    return savePickedFile(file, `project-note-images/${project.id}`);
  };

  return (
    <div className="dashboard-grid">
      <article className="notes-card">
        <div className="section-title">
          <h3>Project Notes</h3>
        </div>
        <RichTextEditor value={project.notes} onChange={(notes) => onUpdate({ notes })} onUploadImage={addNoteImage} placeholder="Document wiring, pin choices, firmware notes, problems, and decisions..." />
      </article>
      <div className="overview-side">
        <article>
          <h3>Checklist</h3>
          <div className="inline-entry checklist-toolbar">
            <input
              value={newChecklist}
              onChange={(event) => setNewChecklist(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                addChecklistItem();
              }}
              placeholder="Add checklist item"
            />
            <button onClick={addChecklistItem}>Add</button>
            <button className="secondary checklist-toggle" onClick={() => setShowCompleted((value) => !value)}>
              {showCompleted ? 'Hide Completed' : 'Show Completed'}
            </button>
          </div>
          {visibleChecklist.map((item) => (
            <label key={item.id} className={`check-line ${item.completedAt ? 'done' : ''}`}>
              <input type="checkbox" checked={Boolean(item.completedAt)} disabled={Boolean(item.completedAt)} onChange={() => completeChecklistItem(item.id)} />
              <span>{item.text}</span>
              {item.completedAt && <small>{new Date(item.completedAt).toLocaleDateString()}</small>}
            </label>
          ))}
        </article>

        <article>
          <h3>Latest Files</h3>
          {latestFiles.length ? latestFiles.map((file) => (
            <div key={file.id} className="latest">
              <strong style={{ color: trackerColor(template.fileTrackers, file.trackerId) }}>{fileTrackerLabel(template.fileTrackers, file.trackerId)}</strong>
              <span>{file.name}</span>
              <div className="latest-file-actions">
                {file.path && <button className="ghost" onClick={() => openStoredFile(file.path)}>Open</button>}
                {(file.path || file.type === 'folder') && <button className="ghost" onClick={() => downloadStoredProjectFile(file)}>Download</button>}
              </div>
            </div>
          )) : <p>No latest files attached.</p>}
        </article>
      </div>
    </div>
  );
}

function dataUrlToBytes(dataUrl) {
  const [, raw = ''] = String(dataUrl || '').split(',');
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function savePhotoThumbnail(blob, name, library) {
  const bitmap = await createImageBitmap(blob);
  const size = 360;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  context.fillStyle = cssColor('--field', '#0d1117');
  context.fillRect(0, 0, size, size);
  const scale = Math.min(size / bitmap.width, size / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  context.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);
  bitmap.close?.();
  const thumbBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.72));
  if (!thumbBlob) throw new Error('Could not create photo thumbnail.');
  const bytes = new Uint8Array(await thumbBlob.arrayBuffer());
  return saveBytesFile(`thumb-${safeName(name || 'photo')}.jpg`, library, bytes);
}

async function savePhotoThumbnailFromPath(path, name, library) {
  const bytes = await readStoredFile(path);
  return savePhotoThumbnail(new Blob([bytes], { type: imageMimeType(name || path) }), name, library);
}

async function savePartImageWithThumbnail(file, partId) {
  const stored = await savePickedFile(file, `part-images/${partId}`);
  let imageThumbnail = '';
  try {
    const thumbnail = await savePhotoThumbnail(file, stored.name, `part-images/${partId}/thumbs`);
    imageThumbnail = thumbnail.path;
  } catch (error) {
    console.warn('Could not create part thumbnail', error);
  }
  return { image: stored.path, imageThumbnail };
}

function PartPreviewImage({ part, className = '' }) {
  if (!part.image && !part.imageThumbnail) return <div className={className || undefined}>{part.name.slice(0, 2).toUpperCase()}</div>;
  return <StoredImage className={className} path={part.imageThumbnail || part.image} alt="" />;
}

function collectReferencedPaths(state) {
  const paths = new Set();
  const add = (path) => {
    if (path && typeof path === 'string' && !path.startsWith('blob:')) paths.add(path);
  };
  state.projects.forEach((project) => {
    add(project.image);
    (project.noteImages || []).forEach((image) => add(image.path));
    (project.photoFolders || []).forEach((folder) => (folder.photos || []).forEach((photo) => {
      add(photo.path);
      add(photo.markupPath);
      add(photo.thumbnailPath);
      add(photo.markupThumbnailPath);
    }));
    (project.files || []).forEach((file) => {
      add(file.path);
      (file.folderFiles || []).forEach((child) => add(child.path));
    });
  });
  state.parts.forEach((part) => {
    add(part.image);
    add(part.imageThumbnail);
    (part.documents || []).forEach((doc) => add(doc.path));
  });
  state.importBatches.forEach((batch) => (batch.items || []).forEach((item) => add(item.imagePath)));
  return [...paths];
}

function runWhenIdle(callback) {
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(callback, { timeout: 1800 });
    return () => window.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(callback, 200);
  return () => window.clearTimeout(id);
}

function PhotoMarkupButton({ photo, projectId, onSave }) {
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);

  const openMarkup = async () => {
    setBusy(true);
    try {
      const bytes = await readStoredFile(photo.markupPath || photo.path);
      setSource(URL.createObjectURL(new Blob([bytes], { type: imageMimeType(photo.name) })));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="ghost" onClick={openMarkup} disabled={busy}>{busy ? 'Loading...' : 'Markup'}</button>
      {source && (
        <NoteImageMarkupModal
          source={source}
          onCancel={() => {
            URL.revokeObjectURL(source);
            setSource('');
          }}
          onSave={async (dataUrl) => {
            const stored = await saveBytesFile(`markup-${photo.name || 'photo.png'}`, `project-photos/${projectId}/markup`, dataUrlToBytes(dataUrl));
            let markupThumbnailPath = '';
            try {
              const thumbnail = await savePhotoThumbnail(new Blob([dataUrlToBytes(dataUrl)], { type: imageMimeType(photo.name) }), photo.name, `project-photos/${projectId}/thumbs`);
              markupThumbnailPath = thumbnail.path;
            } catch (error) {
              console.warn('Could not create markup thumbnail', error);
            }
            onSave({ markupPath: stored.path, markupThumbnailPath });
            URL.revokeObjectURL(source);
            setSource('');
          }}
        />
      )}
    </>
  );
}

function BusyNotice({ label }) {
  if (!label) return null;
  return (
    <div className="busy-notice" role="status" aria-live="polite">
      <span className="busy-spinner" />
      <span>{label}</span>
    </div>
  );
}

function ProjectPhotosTab({ project, onUpdate }) {
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState(project.photoFolders?.[0]?.id || '');
  const [expandedPhoto, setExpandedPhoto] = useState(null);
  const [photoBusy, setPhotoBusy] = useState('');
  const folders = project.photoFolders || [];
  const selectedFolder = folders.find((folder) => folder.id === selectedFolderId) || folders[0];
  const thumbnailJobsRef = useRef(new Set());

  useEffect(() => {
    if (!selectedFolderId && folders[0]) setSelectedFolderId(folders[0].id);
  }, [selectedFolderId, folders]);

  const setFolders = (photoFolders) => onUpdate({ photoFolders });

  const addFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    const folder = { id: makeId('photo-folder'), name, photos: [] };
    setFolders([...folders, folder]);
    setSelectedFolderId(folder.id);
    setNewFolderName('');
  };

  const uploadPhotos = async (files) => {
    if (!selectedFolder || !files?.length) return;
    setPhotoBusy(`Uploading ${files.length} photo${files.length === 1 ? '' : 's'}...`);
    try {
      const uploaded = await Promise.all([...files].map(async (file) => {
        const stored = await savePickedFile(file, `project-photos/${project.id}/${selectedFolder.id}`);
        let thumbnailPath = '';
        try {
          const thumbnail = await savePhotoThumbnail(file, stored.name, `project-photos/${project.id}/thumbs`);
          thumbnailPath = thumbnail.path;
        } catch (error) {
          console.warn('Could not create photo thumbnail', error);
        }
        return { id: makeId('photo'), name: stored.name, path: stored.path, thumbnailPath, note: '', createdAt: new Date().toISOString() };
      }));
      setFolders(folders.map((folder) => folder.id === selectedFolder.id ? { ...folder, photos: [...(folder.photos || []), ...uploaded] } : folder));
    } finally {
      setPhotoBusy('');
    }
  };

  useEffect(() => {
    if (!selectedFolder) return;
    const missing = (selectedFolder.photos || []).filter((photo) => {
      const sourcePath = photo.markupPath || photo.path;
      const previewPath = photo.markupPath ? photo.markupThumbnailPath : photo.thumbnailPath;
      return sourcePath && !previewPath && !thumbnailJobsRef.current.has(photo.id);
    });
    if (!missing.length) return undefined;
    return runWhenIdle(() => {
      missing.slice(0, 2).forEach((photo) => {
        thumbnailJobsRef.current.add(photo.id);
        savePhotoThumbnailFromPath(photo.markupPath || photo.path, photo.name, `project-photos/${project.id}/thumbs`)
          .then((thumbnail) => {
            updatePhoto(photo.id, photo.markupPath ? { markupThumbnailPath: thumbnail.path } : { thumbnailPath: thumbnail.path });
          })
          .finally(() => thumbnailJobsRef.current.delete(photo.id));
      });
    });
  }, [selectedFolder, project.id]);

  const updatePhoto = (photoId, patch) => {
    setFolders(folders.map((folder) => folder.id === selectedFolder.id ? {
      ...folder,
      photos: (folder.photos || []).map((photo) => photo.id === photoId ? { ...photo, ...patch } : photo),
    } : folder));
  };

  const removePhoto = (photoId) => {
    setFolders(folders.map((folder) => folder.id === selectedFolder.id ? {
      ...folder,
      photos: (folder.photos || []).filter((photo) => photo.id !== photoId),
    } : folder));
  };

  const downloadPhoto = async (photo) => {
    setPhotoBusy(`Preparing ${photo.name || 'photo'}...`);
    try {
      const path = photo.markupPath || photo.path;
      const bytes = await readStoredFile(path);
      downloadBytes(photo.name || 'photo', bytes, imageMimeType(photo.name));
    } finally {
      setPhotoBusy('');
    }
  };

  return (
    <div className="photo-library-layout">
      <section className="panel photo-folder-panel">
        <h3>Photo Folders</h3>
        <div className="inline-entry">
          <input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} placeholder="Folder name" />
          <button onClick={addFolder}>Add</button>
        </div>
        {folders.map((folder) => (
          <button key={folder.id} className={selectedFolder?.id === folder.id ? '' : 'secondary'} onClick={() => setSelectedFolderId(folder.id)}>
            {folder.name} ({folder.photos?.length || 0})
          </button>
        ))}
      </section>
      <section className="panel">
        <div className="section-title">
          <h3>{selectedFolder?.name || 'Photos'}</h3>
          {selectedFolder && (
            <label className="file-picker compact-picker">
              <input disabled={!!photoBusy} type="file" accept="image/*" multiple onChange={(event) => { uploadPhotos(event.target.files); event.target.value = ''; }} />
              {photoBusy ? 'Working...' : 'Upload Photos'}
            </label>
          )}
        </div>
        <BusyNotice label={photoBusy} />
        {!selectedFolder ? <p>Create a folder to start adding project photos.</p> : (
          <div className="photo-grid">
            {(selectedFolder.photos || []).map((photo) => (
              <article key={photo.id} className="photo-card">
                <button className="photo-card-image" onClick={() => setExpandedPhoto({ name: photo.name, path: photo.markupPath || photo.path, previewType: 'image' })}>
                  {photo.markupThumbnailPath || photo.thumbnailPath
                    ? <StoredImage path={photo.markupThumbnailPath || photo.thumbnailPath} alt={photo.name} />
                    : <span>Preview loading</span>}
                </button>
                <strong>{photo.name}</strong>
                <textarea value={photo.note || ''} onChange={(event) => updatePhoto(photo.id, { note: event.target.value })} placeholder="Photo note" />
                <div className="row-actions">
                  <button className="ghost" onClick={() => downloadPhoto(photo)}>Download</button>
                  <PhotoMarkupButton photo={photo} projectId={project.id} onSave={(patch) => updatePhoto(photo.id, patch)} />
                  <button className="ghost danger-button" onClick={() => removePhoto(photo.id)}>Delete</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      {expandedPhoto && <ExpandedPartFileModal file={expandedPhoto} onClose={() => setExpandedPhoto(null)} />}
    </div>
  );
}

function ProjectInstructionsTab({ project, parts, categories, onUpdate, onCreatePart }) {
  const [newPart, setNewPart] = useState({ name: '', quantity: 1, categoryId: 'cat-unassigned' });
  const [linkPart, setLinkPart] = useState({ partId: '', quantity: 1 });
  const photos = (project.photoFolders || []).flatMap((folder) => (folder.photos || []).map((photo) => ({ ...photo, folderName: folder.name })));
  const linkedParts = project.partIds.map((id) => parts.find((part) => part.id === id)).filter(Boolean);
  const availableParts = parts.filter((part) => !project.partIds.includes(part.id));
  const instructions = project.instructions || { intro: '', steps: [] };

  const updateInstructions = (patch) => onUpdate({ instructions: { ...instructions, ...patch } });
  const updateStep = (stepId, patch) => updateInstructions({
    steps: instructions.steps.map((step) => step.id === stepId ? { ...step, ...patch } : step),
  });

  const addStep = () => {
    updateInstructions({
      steps: [
        ...instructions.steps,
        { id: makeId('instruction-step'), title: `Step ${instructions.steps.length + 1}`, body: '', photoId: '' },
      ],
    });
  };

  const createInstructionPart = () => {
    if (!newPart.name.trim()) return;
    onCreatePart(project.id, newPart);
    setNewPart({ name: '', quantity: 1, categoryId: 'cat-unassigned' });
  };

  const linkInstructionPart = () => {
    if (!linkPart.partId) return;
    onUpdate({
      partIds: [...project.partIds, linkPart.partId],
      partQuantities: { ...(project.partQuantities || {}), [linkPart.partId]: Number(linkPart.quantity) || 1 },
    });
    setLinkPart({ partId: '', quantity: 1 });
  };

  return (
    <div className="instructions-layout">
      <section className="panel instruction-intro-panel">
        <h3>Intro</h3>
        <RichTextEditor value={instructions.intro || ''} onChange={(intro) => updateInstructions({ intro })} onUploadImage={(file) => savePickedFile(file, `project-instructions/${project.id}/intro`)} placeholder="Introduce the build, tools, safety notes, and final result..." />
      </section>
      <section className="panel instruction-parts-panel">
        <h3>Parts List</h3>
        <div className="instruction-parts-list">
          {linkedParts.map((part) => (
            <div key={part.id} className="instruction-part-row">
              <span>{part.name}</span>
              <strong>Qty {Number(project.partQuantities?.[part.id]) || 1}</strong>
            </div>
          ))}
        </div>
        <div className="instruction-link-part">
          <select value={linkPart.partId} onChange={(event) => setLinkPart((current) => ({ ...current, partId: event.target.value }))}>
            <option value="">Link part from library</option>
            {availableParts.map((part) => <option key={part.id} value={part.id}>{part.name}</option>)}
          </select>
          <input type="number" min="1" value={linkPart.quantity} onChange={(event) => setLinkPart((current) => ({ ...current, quantity: Number(event.target.value) || 1 }))} />
          <button onClick={linkInstructionPart} disabled={!linkPart.partId}>Link Part</button>
        </div>
        <div className="instruction-new-part">
          <input value={newPart.name} onChange={(event) => setNewPart((current) => ({ ...current, name: event.target.value }))} placeholder="Create and link part" />
          <input type="number" min="1" value={newPart.quantity} onChange={(event) => setNewPart((current) => ({ ...current, quantity: Number(event.target.value) || 1 }))} />
          <select value={newPart.categoryId} onChange={(event) => setNewPart((current) => ({ ...current, categoryId: event.target.value }))}>
            {flattenCategoryOptions(categories).map((category) => <option key={category.id} value={category.id}>{category.fullLabel}</option>)}
          </select>
          <button onClick={createInstructionPart}>Add Part</button>
        </div>
      </section>
      <section className="panel wide">
        <div className="section-title">
          <h3>Steps</h3>
          <button onClick={addStep}>{instructions.steps.length ? 'Add Another Step' : 'Add Step 1'}</button>
        </div>
        <div className="instruction-steps">
          {instructions.steps.map((step, index) => {
            const photo = photos.find((item) => item.id === step.photoId);
            return (
              <article key={step.id} className="instruction-step-card">
                <div className="instruction-step-number">Step {index + 1}</div>
                <input value={step.title || ''} onChange={(event) => updateStep(step.id, { title: event.target.value })} placeholder="Step header" />
                <select value={step.photoId || ''} onChange={(event) => updateStep(step.id, { photoId: event.target.value })}>
                  <option value="">No linked photo</option>
                  {photos.map((item) => <option key={item.id} value={item.id}>{item.folderName} / {item.name}</option>)}
                </select>
                {photo && <div className="instruction-step-photo"><StoredImage path={photo.markupPath || photo.path} alt={photo.name} /></div>}
                <RichTextEditor value={step.body || ''} onChange={(body) => updateStep(step.id, { body })} onUploadImage={(file) => savePickedFile(file, `project-instructions/${project.id}/steps`)} placeholder="Write this step like an Instructables build step..." />
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
const TEXT_EXTENSIONS = ['.txt', '.md', '.json', '.ino', '.cpp', '.c', '.h', '.hpp', '.py', '.js', '.ts', '.tsx', '.jsx', '.html', '.css'];
const SHELL_THUMBNAIL_EXTENSIONS = ['.sldprt', '.sldasm', '.slddrw', '.dwg', '.step', '.stp'];
const MODEL_TRIANGLE_LIMIT = 50000;
const EXTERNAL_VIEWER_MESSAGES = {
  '.dwg': 'DWG preview is not available inline. Open this file in a CAD app.',
  '.step': 'STEP preview is not available inline yet. Open this file in your 3D/CAD app.',
  '.stp': 'STEP preview is not available inline yet. Open this file in your 3D/CAD app.',
  '.xls': 'Excel preview is not available inline yet. Open this spreadsheet in Excel or export it as CSV for preview.',
};

function fileExtension(fileName = '') {
  const baseName = String(fileName || '').split(/[\\/]/).pop() || '';
  const dot = baseName.lastIndexOf('.');
  return dot > 0 ? baseName.slice(dot).toLowerCase() : '';
}

function withLatestVersionNote(notes = '', date = new Date()) {
  const cleaned = String(notes || '').replace(/\n?Saved new version .+$/i, '').trimEnd();
  const marker = `Saved new version ${date.toLocaleString()}`;
  return cleaned ? `${cleaned}\n${marker}` : marker;
}

function integrityLabel(status) {
  if (status === 'changed') return 'Outdated';
  if (status === 'missing') return 'Missing';
  if (status === 'ok') return 'OK';
  return '';
}

async function fileHash(path) {
  const bytes = await readStoredFile(path);
  if (crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }

  let hash = 2166136261;
  bytes.forEach((byte) => {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  });
  return `${bytes.length}-${hash >>> 0}`;
}

async function downloadStoredProjectFile(file) {
  if (!file?.path && file?.type !== 'folder') return;
  if (file.type === 'folder') {
    const entries = await Promise.all((file.folderFiles || []).map(async (child) => ({
      name: child.relativePath || child.name,
      data: await readStoredFile(child.path),
    })));
    downloadBytes(`${safeName(file.name)}.zip`, createZip(entries), 'application/zip');
    return;
  }
  const bytes = await readStoredFile(file.path);
  downloadBytes(file.name, bytes, 'application/octet-stream');
}

function imageMimeType(path = '') {
  const extension = fileExtension(path);
  if (extension === '.png') return 'image/png';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.svg') return 'image/svg+xml';
  if (extension === '.bmp') return 'image/bmp';
  return 'image/jpeg';
}

const PROJECT_THUMBNAIL_PREFIX = 'buildbook-project-thumb:';

async function createImageThumbnailDataUrl(path, width = 480, height = 270) {
  const bytes = await readStoredFile(path);
  const blob = new Blob([bytes], { type: imageMimeType(path) });
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = cssColor('--surface-raised', '#21262d');
  context.fillRect(0, 0, width, height);
  const scale = Math.max(width / bitmap.width, height / bitmap.height);
  const drawWidth = bitmap.width * scale;
  const drawHeight = bitmap.height * scale;
  context.drawImage(bitmap, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', 0.74);
}

function ProjectThumbnail({ path, alt = '' }) {
  const cacheKey = path ? `${PROJECT_THUMBNAIL_PREFIX}${path}` : '';
  const [src, setSrc] = useState(() => {
    if (!cacheKey) return '';
    try {
      return localStorage.getItem(cacheKey) || '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    if (!path) {
      setSrc('');
      return undefined;
    }

    let active = true;
    const cached = (() => {
      try {
        return localStorage.getItem(cacheKey) || '';
      } catch {
        return '';
      }
    })();
    if (cached) {
      setSrc(cached);
      return undefined;
    }

    createImageThumbnailDataUrl(path)
      .then((dataUrl) => {
        if (!active) return;
        try {
          localStorage.setItem(cacheKey, dataUrl);
        } catch {
          // Ignore storage quota; the generated thumbnail still works this session.
        }
        setSrc(dataUrl);
      })
      .catch(() => {
        if (active) setSrc(assetUrl(path));
      });

    return () => {
      active = false;
    };
  }, [path, cacheKey]);

  if (!src) return null;
  return <img src={src} alt={alt} draggable={false} />;
}

function StoredImage({ path, alt = '', className = '', style }) {
  const [src, setSrc] = useState(path && /^(blob:|data:|https?:)/i.test(path) ? path : '');

  useEffect(() => {
    if (!path) {
      setSrc('');
      return undefined;
    }

    if (/^(blob:|data:|https?:)/i.test(path)) {
      setSrc(path);
      return undefined;
    }

    let active = true;
    let objectUrl = '';

    readStoredFile(path)
      .then((bytes) => {
        if (!active || !bytes?.length) return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: imageMimeType(path) }));
        setSrc(objectUrl);
      })
      .catch(() => {
        if (active) setSrc(assetUrl(path));
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  if (!src) return null;
  return <img src={src} alt={alt} className={className} style={style} draggable={false} />;
}

function ShellThumbnailPreview({ file }) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setSrc('');
    setError('');

    readShellThumbnail(file.path, 768)
      .then((bytes) => {
        if (!active || !bytes?.length) {
          if (active) setError('Windows did not return a thumbnail for this file.');
          return;
        }
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/bmp' }));
        setSrc(objectUrl);
      })
      .catch((thumbnailError) => {
        if (active) setError(String(thumbnailError || 'Windows did not return a thumbnail for this file.'));
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.path]);

  if (src) {
    return (
      <div className="shell-thumbnail-preview">
        <img src={src} alt="" draggable={false} />
        <span>Windows thumbnail preview</span>
      </div>
    );
  }

  return (
    <div className="file-preview-empty">
      <strong>{file.name}</strong>
      <p>{error || 'Loading Windows thumbnail...'}</p>
      <button className="ghost" onClick={() => openStoredFile(file.path)}>Open File</button>
    </div>
  );
}

const PREVIEW_CACHE_LIMIT = 32;
const previewCache = new Map();

function previewCacheKey(file, type) {
  return `${type}:${file?.path || ''}:${file?.contentHash || ''}:${file?.size || ''}:${file?.createdAt || ''}`;
}

function getPreviewCache(key) {
  if (!previewCache.has(key)) return null;
  const value = previewCache.get(key);
  previewCache.delete(key);
  previewCache.set(key, value);
  return value;
}

function setPreviewCache(key, value) {
  previewCache.set(key, value);
  while (previewCache.size > PREVIEW_CACHE_LIMIT) {
    previewCache.delete(previewCache.keys().next().value);
  }
}

function PdfPreview({ path, title, className = 'file-preview-frame' }) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!path) {
      setSrc('');
      setError('');
      return undefined;
    }

    if (/^(blob:|data:|https?:)/i.test(path)) {
      setSrc(path);
      setError('');
      return undefined;
    }

    let active = true;
    let objectUrl = '';
    setSrc('');
    setError('');

    readStoredFile(path)
      .then((bytes) => {
        if (!active || !bytes?.length) return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        setSrc(objectUrl);
      })
      .catch(() => {
        if (active) setError('Could not preview this PDF.');
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  if (error) {
    return (
      <div className="file-preview-empty">
        <p>{error}</p>
        <button className="ghost" onClick={() => openStoredFile(path)}>Open PDF</button>
      </div>
    );
  }

  if (!src) return <div className="file-preview-empty">Loading PDF...</div>;
  const separator = src.includes('#') ? '&' : '#';
  return <iframe className={className} title={title} src={`${src}${separator}pagemode=bookmarks&navpanes=1`} />;
}

function TextFilePreview({ file }) {
  const [content, setContent] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const cacheKey = previewCacheKey(file, 'text');
    const cached = getPreviewCache(cacheKey);
    if (cached) {
      setContent(cached.content || '');
      setError(cached.error || '');
      return undefined;
    }

    let active = true;
    setContent('');
    setError('');

    readStoredFile(file.path)
      .then((bytes) => new TextDecoder().decode(bytes))
      .then((text) => {
        const nextContent = text.slice(0, 20000);
        setPreviewCache(cacheKey, { content: nextContent, error: '' });
        if (active) setContent(nextContent);
      })
      .catch(() => {
        const nextError = 'Preview is not available for this file yet.';
        setPreviewCache(cacheKey, { content: '', error: nextError });
        if (active) setError(nextError);
      });

    return () => {
      active = false;
    };
  }, [file]);

  if (error) {
    return (
      <div className="file-preview-empty">
        <p>{error}</p>
        <button className="ghost" onClick={() => openStoredFile(file.path)}>Open File</button>
      </div>
    );
  }

  return <pre className="file-preview-text">{content || 'Loading preview...'}</pre>;
}

function CsvPreview({ file }) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    const cacheKey = previewCacheKey(file, 'csv');
    const cached = getPreviewCache(cacheKey);
    if (cached) {
      setRows(cached.rows || []);
      return undefined;
    }

    let active = true;
    readStoredFile(file.path)
      .then((bytes) => new TextDecoder().decode(bytes))
      .then((text) => {
        const nextRows = parseCsv(text).slice(0, 40).map((row) => row.slice(0, 12));
        setPreviewCache(cacheKey, { rows: nextRows });
        if (active) setRows(nextRows);
      })
      .catch(() => {
        setPreviewCache(cacheKey, { rows: [] });
        if (active) setRows([]);
      });
    return () => {
      active = false;
    };
  }, [file]);

  if (!rows.length) return <div className="file-preview-empty">Spreadsheet preview is available for CSV files. Open Excel files in their app.</div>;

  return (
    <div className="spreadsheet-preview">
      <table>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${rowIndex}-${row.join('-')}`}>
              {row.map((cell, cellIndex) => <td key={`${cellIndex}-${cell}`}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function inflateZipEntry(data, method) {
  if (method === 0) return data;
  if (method !== 8) throw new Error('Unsupported XLSX compression.');
  if (!('DecompressionStream' in window)) throw new Error('This system cannot decompress XLSX files inline.');

  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let index = bytes.length - 22; index >= 0; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error('Invalid XLSX file.');

  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = new Map();
  const decoder = new TextDecoder();

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    entries.set(name, { method, data: compressed });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

async function zipEntryText(entries, name) {
  const entry = entries.get(name);
  if (!entry) return '';
  return new TextDecoder().decode(await inflateZipEntry(entry.data, entry.method));
}

function xmlDoc(text) {
  return new DOMParser().parseFromString(text, 'application/xml');
}

function cellColumnIndex(reference = '') {
  const letters = reference.match(/[A-Z]+/i)?.[0]?.toUpperCase() || 'A';
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function parseSharedStrings(text) {
  if (!text) return [];
  return [...xmlDoc(text).getElementsByTagName('si')].map((item) =>
    [...item.getElementsByTagName('t')].map((node) => node.textContent || '').join(''),
  );
}

function firstWorksheetPath(workbookText, relsText) {
  const workbook = xmlDoc(workbookText);
  const firstSheet = workbook.getElementsByTagName('sheet')[0];
  const relationshipId = firstSheet?.getAttribute('r:id');
  const rel = [...xmlDoc(relsText).getElementsByTagName('Relationship')]
    .find((item) => item.getAttribute('Id') === relationshipId);
  const target = rel?.getAttribute('Target') || 'worksheets/sheet1.xml';
  return `xl/${target.replace(/^\/?xl\//, '')}`;
}

function parseXlsxRows(sheetText, sharedStrings) {
  const sheet = xmlDoc(sheetText);
  return [...sheet.getElementsByTagName('row')].slice(0, 40).map((row) => {
    const values = [];
    [...row.getElementsByTagName('c')].slice(0, 80).forEach((cell) => {
      const column = cellColumnIndex(cell.getAttribute('r') || '');
      if (column > 11) return;
      const type = cell.getAttribute('t');
      const raw = cell.getElementsByTagName('v')[0]?.textContent || '';
      const inline = cell.getElementsByTagName('t')[0]?.textContent || '';
      values[column] = type === 's' ? sharedStrings[Number(raw)] || '' : type === 'inlineStr' ? inline : raw;
    });
    return Array.from({ length: Math.min(12, Math.max(1, values.length)) }, (_, index) => values[index] || '');
  }).filter((row) => row.some((cell) => String(cell).trim()));
}

function XlsxPreview({ file }) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const cacheKey = previewCacheKey(file, 'xlsx');
    const cached = getPreviewCache(cacheKey);
    if (cached) {
      setRows(cached.rows || []);
      setError(cached.error || '');
      return undefined;
    }

    let active = true;
    setRows([]);
    setError('');

    const cancelIdle = runWhenIdle(() => {
      readStoredFile(file.path)
        .then(async (bytes) => {
          const entries = await readZipEntries(bytes);
          const sharedStrings = parseSharedStrings(await zipEntryText(entries, 'xl/sharedStrings.xml'));
          const sheetPath = firstWorksheetPath(
            await zipEntryText(entries, 'xl/workbook.xml'),
            await zipEntryText(entries, 'xl/_rels/workbook.xml.rels'),
          );
          return parseXlsxRows(await zipEntryText(entries, sheetPath), sharedStrings);
        })
        .then((nextRows) => {
          setPreviewCache(cacheKey, { rows: nextRows, error: '' });
          if (active) setRows(nextRows);
        })
        .catch((nextError) => {
          const errorText = String(nextError);
          setPreviewCache(cacheKey, { rows: [], error: errorText });
          if (active) setError(errorText);
        });
    });

    return () => {
      active = false;
      cancelIdle();
    };
  }, [file]);

  if (error) return <div className="file-preview-empty">{error}</div>;
  if (!rows.length) return <div className="file-preview-empty">Loading Excel preview...</div>;

  return (
    <div className="spreadsheet-preview">
      <table>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${rowIndex}-${row.join('-')}`}>
              {row.map((cell, cellIndex) => <td key={`${cellIndex}-${cell}`}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FolderPreview({ file }) {
  const files = file.folderFiles || [];
  return (
    <div className="folder-preview">
      <div className="section-title">
        <h3>{file.name}</h3>
        <span>{files.length} files</span>
      </div>
      {files.length ? files.map((child) => (
        <div key={child.id || child.relativePath || child.name} className="folder-preview-row">
          <span>{child.relativePath || child.name}</span>
          <button className="ghost" onClick={() => openStoredFile(child.path)}>Open</button>
        </div>
      )) : <p>No files found in this folder.</p>}
    </div>
  );
}

function StlPreview({ file }) {
  const canvasRef = useRef(null);
  const trianglesRef = useRef([]);
  const viewRef = useRef({ rotationX: -0.55, rotationY: 0.65, zoom: 1 });
  const dragRef = useRef(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  const redraw = () => {
    drawStl(canvasRef.current, trianglesRef.current, viewRef.current);
  };

  useEffect(() => {
    const cacheKey = previewCacheKey(file, 'stl');
    const cached = getPreviewCache(cacheKey);
    if (cached?.triangles?.length) {
      trianglesRef.current = cached.triangles;
      viewRef.current = { rotationX: -0.55, rotationY: 0.65, zoom: 1 };
      setError('');
      setReady(true);
      requestAnimationFrame(redraw);
      return undefined;
    }

    let active = true;
    setError('');
    setReady(false);

    const cancelIdle = runWhenIdle(() => {
      readStoredFile(file.path)
        .then((bytes) => {
          if (!active) return;
          const triangles = limitTriangles(parseStl(bytes), MODEL_TRIANGLE_LIMIT);
          if (!triangles.length) {
            setError('No previewable STL geometry was found.');
            return;
          }
          setPreviewCache(cacheKey, { triangles });
          trianglesRef.current = triangles;
          viewRef.current = { rotationX: -0.55, rotationY: 0.65, zoom: 1 };
          setReady(true);
          requestAnimationFrame(redraw);
        })
        .catch(() => {
          if (active) setError('Could not preview this STL.');
        });
    });

    return () => {
      active = false;
      cancelIdle();
      trianglesRef.current = [];
    };
  }, [file]);

  useEffect(() => {
    if (ready) redraw();
  }, [ready]);

  const rotate = (event) => {
    if (!dragRef.current) return;
    const dx = event.clientX - dragRef.current.x;
    const dy = event.clientY - dragRef.current.y;
    dragRef.current = { x: event.clientX, y: event.clientY };
    viewRef.current = {
      ...viewRef.current,
      rotationX: viewRef.current.rotationX + dy * 0.01,
      rotationY: viewRef.current.rotationY + dx * 0.01,
    };
    redraw();
  };

  const zoom = (event) => {
    event.preventDefault();
    const nextZoom = viewRef.current.zoom * Math.exp(-event.deltaY * 0.001);
    viewRef.current = {
      ...viewRef.current,
      zoom: Math.max(0.25, Math.min(6, nextZoom)),
    };
    redraw();
  };

  if (error) {
    return (
      <div className="file-preview-empty">
        <p>{error}</p>
        <button className="ghost" onClick={() => openStoredFile(file.path)}>Open File</button>
      </div>
    );
  }

  return (
    <div className="model-preview">
      <canvas
        ref={canvasRef}
        width="720"
        height="520"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerMove={rotate}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
        onWheel={zoom}
      />
      <span>{ready ? 'Drag to rotate. Scroll to zoom.' : 'Loading STL preview...'}</span>
    </div>
  );
}

function ObjPreview({ file }) {
  const canvasRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const cacheKey = previewCacheKey(file, 'obj');
    const cached = getPreviewCache(cacheKey);
    if (cached?.triangles?.length) {
      setError('');
      requestAnimationFrame(() => drawStl(canvasRef.current, cached.triangles));
      return undefined;
    }

    let active = true;
    setError('');

    const cancelIdle = runWhenIdle(() => {
      readStoredFile(file.path)
        .then((bytes) => new TextDecoder().decode(bytes))
        .then((text) => {
          if (!active) return;
          const triangles = limitTriangles(parseObj(text), MODEL_TRIANGLE_LIMIT);
          if (!triangles.length) {
            setError('No previewable OBJ geometry was found.');
            return;
          }
          setPreviewCache(cacheKey, { triangles });
          drawStl(canvasRef.current, triangles);
        })
        .catch(() => {
          if (active) setError('Could not preview this OBJ.');
        });
    });

    return () => {
      active = false;
      cancelIdle();
    };
  }, [file]);

  if (error) {
    return (
      <div className="file-preview-empty">
        <p>{error}</p>
        <button className="ghost" onClick={() => openStoredFile(file.path)}>Open File</button>
      </div>
    );
  }

  return (
    <div className="model-preview">
      <canvas ref={canvasRef} width="720" height="520" />
      <span>Shaded OBJ preview</span>
    </div>
  );
}

function DxfPreview({ file }) {
  const canvasRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const cacheKey = previewCacheKey(file, 'dxf');
    const cached = getPreviewCache(cacheKey);
    if (cached?.shapes?.length) {
      setError('');
      requestAnimationFrame(() => drawDxf(canvasRef.current, cached.shapes));
      return undefined;
    }

    let active = true;
    setError('');

    const cancelIdle = runWhenIdle(() => {
      readStoredFile(file.path)
        .then((bytes) => new TextDecoder().decode(bytes))
        .then((text) => {
          if (!active) return;
          const shapes = parseDxf(text);
          if (!shapes.length) {
            setError('No previewable DXF geometry was found.');
            return;
          }
          setPreviewCache(cacheKey, { shapes });
          drawDxf(canvasRef.current, shapes);
        })
        .catch(() => {
          if (active) setError('Could not preview this DXF.');
        });
    });

    return () => {
      active = false;
      cancelIdle();
    };
  }, [file]);

  if (error) {
    return (
      <div className="file-preview-empty">
        <p>{error}</p>
        <button className="ghost" onClick={() => openStoredFile(file.path)}>Open File</button>
      </div>
    );
  }

  return (
    <div className="cad-preview">
      <canvas ref={canvasRef} width="720" height="520" />
      <span>DXF preview</span>
    </div>
  );
}

function parseStl(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const view = new DataView(buffer);
  const headerText = new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 512))).trimStart();

  if (headerText.startsWith('solid')) {
    const text = new TextDecoder().decode(bytes);
    const vertices = [...text.matchAll(/vertex\s+([-0-9.eE+]+)\s+([-0-9.eE+]+)\s+([-0-9.eE+]+)/g)]
      .map((match) => [Number(match[1]), Number(match[2]), Number(match[3])]);
    const triangles = [];
    for (let i = 0; i + 2 < vertices.length; i += 3) triangles.push([vertices[i], vertices[i + 1], vertices[i + 2]]);
    if (triangles.length) return triangles;
  }

  if (buffer.byteLength < 84) return [];
  const count = Math.min(view.getUint32(80, true), Math.floor((buffer.byteLength - 84) / 50));
  const triangles = [];
  let offset = 84;
  for (let i = 0; i < count && offset + 50 <= buffer.byteLength; i += 1) {
    offset += 12;
    const triangle = [
      [view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true)],
      [view.getFloat32(offset + 12, true), view.getFloat32(offset + 16, true), view.getFloat32(offset + 20, true)],
      [view.getFloat32(offset + 24, true), view.getFloat32(offset + 28, true), view.getFloat32(offset + 32, true)],
    ];
    if (isValidTriangle(triangle)) triangles.push(triangle);
    offset += 38;
  }
  return triangles;
}

function isValidTriangle(triangle) {
  return triangle.length === 3 && triangle.every((point) => point.length === 3 && point.every(Number.isFinite));
}

function limitTriangles(triangles, limit) {
  if (triangles.length <= limit) return triangles;
  const stride = Math.ceil(triangles.length / limit);
  return triangles.filter((_, index) => index % stride === 0).slice(0, limit);
}

function parseObj(text) {
  const vertices = [];
  const triangles = [];

  text.split(/\r?\n/).forEach((line) => {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'v' && parts.length >= 4) {
      vertices.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
    }
    if (parts[0] === 'f' && parts.length >= 4) {
      const indexes = parts.slice(1).map((part) => Number(part.split('/')[0]) - 1).filter((index) => vertices[index]);
      for (let i = 1; i + 1 < indexes.length; i += 1) {
        const triangle = [vertices[indexes[0]], vertices[indexes[i]], vertices[indexes[i + 1]]];
        if (isValidTriangle(triangle)) triangles.push(triangle);
      }
    }
  });

  return triangles;
}

function drawStl(canvas, triangles, view = { rotationX: -0.55, rotationY: 0.65, zoom: 1 }) {
  if (!canvas) return;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = cssColor('--field', '#0d1117');
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (!triangles.length) return;

  const validTriangles = triangles.filter(isValidTriangle);
  const points = validTriangles.flat();
  if (!points.length) return;
  const min = [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis])));
  const max = [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis])));
  const center = [0, 1, 2].map((axis) => (min[axis] + max[axis]) / 2);
  const size = Math.max(...[0, 1, 2].map((axis) => max[axis] - min[axis])) || 1;
  const scale = Math.min(canvas.width, canvas.height) * 0.72 * (view.zoom || 1) / size;
  const sinX = Math.sin(view.rotationX ?? -0.55);
  const cosX = Math.cos(view.rotationX ?? -0.55);
  const sinY = Math.sin(view.rotationY ?? 0.65);
  const cosY = Math.cos(view.rotationY ?? 0.65);

  const projected = validTriangles.map((triangle) => {
    const pts = triangle.map(([x, y, z]) => {
      const px = x - center[0];
      const py = y - center[1];
      const pz = z - center[2];
      const y1 = py * cosX - pz * sinX;
      const z1 = py * sinX + pz * cosX;
      const x2 = px * cosY + z1 * sinY;
      const z2 = -px * sinY + z1 * cosY;
      return [
        canvas.width / 2 + x2 * scale,
        canvas.height / 2 - y1 * scale,
        z2,
      ];
    });
    const depth = pts.reduce((total, point) => total + point[2], 0) / 3;
    return { pts, depth };
  }).sort((a, b) => b.depth - a.depth);

  projected.forEach(({ pts }) => {
    context.beginPath();
    context.moveTo(pts[0][0], pts[0][1]);
    context.lineTo(pts[1][0], pts[1][1]);
    context.lineTo(pts[2][0], pts[2][1]);
    context.closePath();
    context.fillStyle = cssColor('--accent', '#58a6ff');
    context.fill();
    context.strokeStyle = cssColor('--text-soft', '#c9d1d9');
    context.stroke();
  });
}

function parseDxf(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([lines[i], lines[i + 1]]);
  const shapes = [];

  for (let i = 0; i < pairs.length; i += 1) {
    if (pairs[i][0] !== '0') continue;
    const type = pairs[i][1];
    const values = {};
    let j = i + 1;
    while (j < pairs.length && pairs[j][0] !== '0') {
      values[pairs[j][0]] = pairs[j][1];
      j += 1;
    }

    if (type === 'LINE') {
      shapes.push({
        type: 'line',
        points: [
          [Number(values['10'] || 0), Number(values['20'] || 0)],
          [Number(values['11'] || 0), Number(values['21'] || 0)],
        ],
      });
    }
    if (type === 'CIRCLE') {
      shapes.push({ type: 'circle', center: [Number(values['10'] || 0), Number(values['20'] || 0)], radius: Number(values['40'] || 0) });
    }
    if (type === 'ARC') {
      shapes.push({
        type: 'arc',
        center: [Number(values['10'] || 0), Number(values['20'] || 0)],
        radius: Number(values['40'] || 0),
        start: Number(values['50'] || 0),
        end: Number(values['51'] || 0),
      });
    }

    i = j - 1;
  }

  return shapes;
}

function drawDxf(canvas, shapes) {
  if (!canvas) return;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = cssColor('--field', '#0d1117');
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (!shapes.length) return;

  const points = shapes.flatMap((shape) => {
    if (shape.type === 'line') return shape.points;
    if (shape.type === 'circle' || shape.type === 'arc') {
      return [
        [shape.center[0] - shape.radius, shape.center[1] - shape.radius],
        [shape.center[0] + shape.radius, shape.center[1] + shape.radius],
      ];
    }
    return [];
  });
  const minX = Math.min(...points.map((point) => point[0]));
  const maxX = Math.max(...points.map((point) => point[0]));
  const minY = Math.min(...points.map((point) => point[1]));
  const maxY = Math.max(...points.map((point) => point[1]));
  const width = maxX - minX || 1;
  const height = maxY - minY || 1;
  const scale = Math.min((canvas.width - 56) / width, (canvas.height - 56) / height);
  const map = ([x, y]) => [28 + (x - minX) * scale, canvas.height - 28 - (y - minY) * scale];

  context.strokeStyle = cssColor('--accent', '#58a6ff');
  context.lineWidth = 2;
  shapes.forEach((shape) => {
    context.beginPath();
    if (shape.type === 'line') {
      const start = map(shape.points[0]);
      const end = map(shape.points[1]);
      context.moveTo(start[0], start[1]);
      context.lineTo(end[0], end[1]);
    }
    if (shape.type === 'circle') {
      const center = map(shape.center);
      context.arc(center[0], center[1], shape.radius * scale, 0, Math.PI * 2);
    }
    if (shape.type === 'arc') {
      const center = map(shape.center);
      context.arc(center[0], center[1], shape.radius * scale, -shape.end * Math.PI / 180, -shape.start * Math.PI / 180);
    }
    context.stroke();
  });
}

function FilePreview({ file }) {
  if (!file) return <div className="file-preview-empty">Choose a latest file to preview.</div>;
  if (file.type === 'folder') return <FolderPreview file={file} />;
  if (!file.path) return <div className="file-preview-empty">This sample file does not have a local path yet.</div>;

  const extension = fileExtension(file.name);
  if (extension === '.pdf') {
    return <PdfPreview path={file.path} title={file.name} />;
  }

  if (IMAGE_EXTENSIONS.includes(extension)) {
    return <StoredImage className="file-preview-image" path={file.path} alt="" />;
  }

  if (TEXT_EXTENSIONS.includes(extension)) {
    return <TextFilePreview file={file} />;
  }

  if (extension === '.csv') {
    return <CsvPreview file={file} />;
  }

  if (extension === '.xlsx') {
    return <XlsxPreview file={file} />;
  }

  if (extension === '.stl') {
    return <StlPreview file={file} />;
  }

  if (extension === '.obj') {
    return <ObjPreview file={file} />;
  }

  if (extension === '.dxf') {
    return <DxfPreview file={file} />;
  }

  if (SHELL_THUMBNAIL_EXTENSIONS.includes(extension)) {
    return <ShellThumbnailPreview file={file} />;
  }

  if (EXTERNAL_VIEWER_MESSAGES[extension]) {
    return (
      <div className="file-preview-empty">
        <strong>{file.name}</strong>
        <p>{EXTERNAL_VIEWER_MESSAGES[extension]}</p>
        <button className="ghost" onClick={() => openStoredFile(file.path)}>Open File</button>
      </div>
    );
  }

  return (
    <div className="file-preview-empty">
      <strong>{file.name}</strong>
      <p>Inline preview is not wired for this file type yet.</p>
      <button className="ghost" onClick={() => openStoredFile(file.path)}>Open File</button>
    </div>
  );
}

function isPreviewableFile(file) {
  const extension = fileExtension(file?.name || '');
  return Boolean(file?.path) && (
    extension === '.pdf'
    || IMAGE_EXTENSIONS.includes(extension)
    || TEXT_EXTENSIONS.includes(extension)
    || ['.csv', '.xlsx', '.stl', '.obj', '.dxf'].includes(extension)
    || SHELL_THUMBNAIL_EXTENSIONS.includes(extension)
    || Boolean(EXTERNAL_VIEWER_MESSAGES[extension])
  );
}

function ExpandedPartFileModal({ file, onClose }) {
  if (!file?.path) return null;
  const extension = fileExtension(file.name);
  const isImage = file.previewType === 'image' || IMAGE_EXTENSIONS.includes(extension);

  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`modal expanded-preview-modal ${isImage ? 'image-preview-modal' : ''}`}>
        <div className="section-title">
          <h2>{file.name}</h2>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
        {extension === '.pdf' ? (
          <PdfPreview path={file.path} title={file.name} className="pdf-preview expanded" />
        ) : isImage ? (
          <StoredImage className="expanded-preview-image" path={file.path} alt="" />
        ) : (
          <FilePreview file={file} />
        )}
      </div>
    </div>
  );
}

function ExpandablePdfPreview({ pdf, onExpand, className = 'pdf-preview compact', label = 'Click to expand' }) {
  if (!pdf?.path) return null;
  return (
    <div className="pdf-preview-click-target" onClick={onExpand}>
      <PdfPreview path={pdf.path} title={pdf.name} className={className} />
      <div className="pdf-preview-overlay">{label}</div>
    </div>
  );
}

function PartInfoModal({ part, categories, onClose, onUnlink, onUpdatePart }) {
  const [expandedPreview, setExpandedPreview] = useState(null);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [documentError, setDocumentError] = useState('');
  const previewDocument = part.documents.find((doc) => doc.isPrimary && isPreviewableFile(doc))
    || part.documents.find(isPreviewableFile);

  const attachDocument = async (pickedFile) => {
    if (!pickedFile) return;
    setDocumentBusy(true);
    setDocumentError('');
    try {
      const stored = await savePickedFile(pickedFile, `part-documents/${part.id}`);
      const contentHash = stored.path ? await fileHash(stored.path).catch(() => '') : '';
      onUpdatePart(part.id, {
        documents: [
                  ...part.documents,
                  {
                    id: makeId('doc'),
                    name: stored.name,
                    path: stored.path,
                    sourcePath: '',
                    storageMode: 'copy',
                    size: stored.size,
                    contentHash,
                    type: stored.name.toLowerCase().endsWith('.pdf') ? 'datasheet' : 'document',
                    isPrimary: !part.documents.length,
                    createdAt: new Date().toISOString(),
                  },
        ],
      });
    } catch (error) {
      setDocumentError(String(error));
    } finally {
      setDocumentBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal detail-modal project-part-detail-modal">
        <div className="project-part-header">
          <div className="project-part-summary">
            <button
              className="image-expand-button"
              disabled={!part.image}
              onClick={() => part.image && setExpandedPreview({ name: `${part.name} image`, path: part.image, previewType: 'image' })}
            >
              <div className="part-image detail-image">{part.image ? <StoredImage path={part.image} alt="" /> : part.name.slice(0, 2).toUpperCase()}</div>
            </button>
            <div>
              <span>{categoryLabel(categories, part.categoryId)}</span>
              <h2>{part.name}</h2>
              <p>{part.storageLocation || 'No location set'}</p>
            </div>
          </div>
          <div className="row-actions">
            <button className="danger-fill" onClick={() => onUnlink(part.id)}>Unlink</button>
            <button className="ghost" onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="project-part-content">
          <section className="project-part-panel spec-panel">
            <h3>Spec Summary</h3>
            <p>{part.specSummary || 'No spec summary yet.'}</p>
            <h3>Product URL</h3>
            {part.productUrl ? (
              <p>
                {part.productUrl}
                <button className="ghost inline-button" onClick={() => openExternalUrl(part.productUrl)}>Open</button>
              </p>
            ) : <p>No product URL set.</p>}
          </section>
          <section className="project-part-panel docs-panel">
            <div className="section-title">
              <h3>Part Documents</h3>
              <label className="file-picker inline-doc-picker">
                <input
                  type="file"
                  onChange={(event) => {
                    attachDocument(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
                {documentBusy ? 'Saving...' : 'Attach'}
              </label>
            </div>
            {documentError && <p className="error-text">{documentError}</p>}
            <div className="part-doc-list">
              {part.documents.length ? part.documents.map((doc) => (
                <div key={doc.id} className="part-doc-row">
                  <span>{doc.name}</span>
                  <small>{doc.type || 'Document'}</small>
                  <div className="row-actions">
                    {isPreviewableFile(doc) && (
                      <button className="ghost" onClick={() => setExpandedPreview(doc)}>Preview</button>
                    )}
                    {doc.path && <button className="ghost" onClick={() => openStoredFile(doc.path)}>Open</button>}
                  </div>
                </div>
              )) : <p>No documents attached.</p>}
            </div>
          </section>
          <section className="project-part-panel pdf-panel">
            <div className="section-title">
              <h3>File Preview</h3>
              {previewDocument?.path && <button className="ghost" onClick={() => openStoredFile(previewDocument.path)}>Open</button>}
            </div>
            {previewDocument ? (
              <button className="inline-preview-button" onClick={() => setExpandedPreview(previewDocument)}>
                <FilePreview file={previewDocument} />
              </button>
            ) : <p>No previewable file attached yet.</p>}
          </section>
          <section className="project-part-panel notes-panel">
            <h3>Notes</h3>
            <p>{part.notes || 'No notes yet.'}</p>
          </section>
        </div>
      </div>
      {expandedPreview && <ExpandedPartFileModal file={expandedPreview} onClose={() => setExpandedPreview(null)} />}
    </div>
  );
}

function LinkPartModal({ parts, linkedIds, categories, onLink, onClose }) {
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const categoryOptions = flattenCategoryOptions(categories);
  const categoryFilterIds = categoryFilter ? new Set([categoryFilter, ...descendantCategoryIds(categories, categoryFilter)]) : null;
  const visibleParts = parts.filter((part) => {
    if (categoryFilterIds && !categoryFilterIds.has(part.categoryId)) return false;
    if (!query.trim()) return true;
    const text = query.trim().toLowerCase();
    return [part.name, categoryLabel(categories, part.categoryId), part.storageLocation, part.specSummary, part.notes]
      .some((value) => String(value || '').toLowerCase().includes(text));
  });

  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal link-part-modal">
        <div className="section-title">
          <h2>Link Part</h2>
        </div>
        <label>
          Search parts
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Board, MCU, regulator..." />
        </label>
        <label>
          Category
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="">All categories</option>
            {categoryOptions.filter((category) => category.id !== 'cat-unassigned').map((category) => (
              <option key={category.id} value={category.id}>{category.label}</option>
            ))}
          </select>
        </label>
        <div className="link-part-list">
          {visibleParts.map((part) => {
            const linked = linkedIds.includes(part.id);
            return (
              <div key={part.id} className="link-part-row">
                <div className="link-part-thumb">
                  {part.image ? <PartPreviewImage part={part} /> : <div className="image-placeholder">Part</div>}
                </div>
                <div className="link-part-copy">
                  <strong>{part.name}</strong>
                  <span>{categoryLabel(categories, part.categoryId)} - {part.storageLocation || 'No location'}</span>
                </div>
                {linked ? <span className="link-part-status">Linked</span> : <button className="ghost" onClick={() => onLink(part.id)}>Link</button>}
              </div>
            );
          })}
          {!visibleParts.length && <p>No parts found.</p>}
        </div>
        <div className="modal-footer">
          <button className="secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function ProjectPartsTab({ project, parts, categories, onUpdate, onUpdatePart }) {
  const [selectedPart, setSelectedPart] = useState(null);
  const [linkingPart, setLinkingPart] = useState(false);
  const thumbnailJobsRef = useRef(new Set());
  const linkedParts = project.partIds.map((id) => parts.find((part) => part.id === id)).filter(Boolean);

  useEffect(() => {
    if (!selectedPart) return;
    const refreshed = parts.find((part) => part.id === selectedPart.id);
    if (refreshed && refreshed !== selectedPart) setSelectedPart(refreshed);
  }, [parts, selectedPart]);

  useEffect(() => {
    const missing = linkedParts.filter((part) => part.image && !part.imageThumbnail && !thumbnailJobsRef.current.has(part.id));
    if (!missing.length) return undefined;
    return runWhenIdle(() => {
      missing.slice(0, 2).forEach((part) => {
        thumbnailJobsRef.current.add(part.id);
        savePhotoThumbnailFromPath(part.image, part.name, `part-images/${part.id}/thumbs`)
          .then((thumbnail) => onUpdatePart(part.id, { imageThumbnail: thumbnail.path }))
          .catch((error) => console.warn('Could not create part thumbnail', error))
          .finally(() => thumbnailJobsRef.current.delete(part.id));
      });
    });
  }, [linkedParts, onUpdatePart]);

  const linkPart = (partId) => {
    if (!partId || project.partIds.includes(partId)) return;
    onUpdate({
      partIds: [...project.partIds, partId],
      partQuantities: { ...(project.partQuantities || {}), [partId]: project.partQuantities?.[partId] || 1 },
    });
    setLinkingPart(false);
  };

  const unlinkPart = (partId) => {
    const nextQuantities = { ...(project.partQuantities || {}) };
    delete nextQuantities[partId];
    onUpdate({ partIds: project.partIds.filter((id) => id !== partId), partQuantities: nextQuantities });
    setSelectedPart((part) => part?.id === partId ? null : part);
  };

  const updatePartQuantity = (partId, quantity) => {
    const safeQuantity = Math.max(0, Number(quantity) || 0);
    onUpdate({ partQuantities: { ...(project.partQuantities || {}), [partId]: safeQuantity } });
  };

  return (
    <div className="parts-workspace">
      <div>
        <div className="section-toolbar">
          <button onClick={() => setLinkingPart(true)}>Link Part</button>
        </div>
        {linkedParts.length === 0 ? <section className="panel empty-panel">No parts linked yet.</section> : (
          <div className="linked-part-grid">
            {linkedParts.map((part) => (
              <button key={part.id} className="linked-part-card" onClick={() => setSelectedPart(part)}>
                <div className="part-image">{part.image ? <PartPreviewImage part={part} /> : part.name.slice(0, 2).toUpperCase()}</div>
                <strong>{part.name}</strong>
                <span>{categoryLabel(categories, part.categoryId)}</span>
                <small>{part.storageLocation || 'No location set'}</small>
              </button>
            ))}
          </div>
        )}
      </div>
      <section className="panel build-parts-card">
        <div className="section-title">
          <h2>Build Parts</h2>
        </div>
        {linkedParts.length ? (
          <div className="project-part-qty-list">
            {linkedParts.map((part) => (
              <div key={part.id} className="project-part-qty-row">
                <span className="project-part-qty-name">{part.name}</span>
                <div className="qty-stepper">
                  <input
                    type="number"
                    min="0"
                    value={project.partQuantities?.[part.id] ?? 1}
                    onChange={(event) => updatePartQuantity(part.id, event.target.value)}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : <p>Link parts to set project-specific quantities.</p>}
      </section>
      {selectedPart && (
        <PartInfoModal
          part={selectedPart}
          categories={categories}
          onClose={() => setSelectedPart(null)}
          onUnlink={unlinkPart}
          onUpdatePart={onUpdatePart}
        />
      )}
      {linkingPart && (
        <LinkPartModal
          parts={parts}
          linkedIds={project.partIds}
          categories={categories}
          onLink={linkPart}
          onClose={() => setLinkingPart(false)}
        />
      )}
    </div>
  );
}

function ProjectFilesTab({ project, template, onUpdate }) {
  const [fileTrackerId, setFileTrackerId] = useState(template.fileTrackers[0]?.id || '');
  const [fileUploadNotes, setFileUploadNotes] = useState('');
  const [stagedAttachment, setStagedAttachment] = useState(null);
  const [fileError, setFileError] = useState('');
  const [fileBusy, setFileBusy] = useState(false);
  const [editSessions, setEditSessions] = useState({});
  const [selectedFileId, setSelectedFileId] = useState('');
  const [viewerScope, setViewerScope] = useState('latest');
  const [expandedFileGroups, setExpandedFileGroups] = useState({});
  const [replaceTargetFileId, setReplaceTargetFileId] = useState('');
  const autoIntegrityBusyRef = useRef(false);
  const projectFilesRef = useRef(project.files);

  useEffect(() => {
    projectFilesRef.current = project.files;
  }, [project.files]);

  const trackedItemKey = (file) => file.trackedItemId || file.id;
  const replaceTargetFile = project.files.find((file) => file.id === replaceTargetFileId) || null;

  const attachProjectFile = async (pickedFile = null, linkedPath = '') => {
    const trackerId = replaceTargetFile?.trackerId || fileTrackerId;
    const tracker = template.fileTrackers.find((item) => item.id === trackerId);
    const trimmedPath = linkedPath.trim();
    if ((!trimmedPath && !pickedFile) || !tracker) return;

    const candidateName = pickedFile?.name || trimmedPath;
    if (!extensionAllowed(candidateName, tracker.extensions)) {
      setFileError(`This tracker only accepts: ${tracker.extensions}`);
      return;
    }

    setFileBusy(true);
    setFileError('');
    try {
      const stored = pickedFile
        ? await savePickedFile(pickedFile, `project-files/${project.id}/${tracker.id}`)
        : linkedLocalFile(trimmedPath);
      const contentHash = stored.path ? await fileHash(stored.path).catch(() => '') : '';
      const trackedItemId = replaceTargetFile ? trackedItemKey(replaceTargetFile) : makeId('tracked-file');
      const baseFiles = replaceTargetFile
        ? project.files.map((file) => trackedItemKey(file) === trackedItemId ? { ...file, latest: false } : file)
        : project.files;
      onUpdate({
        files: [
          ...baseFiles,
          {
            id: makeId('file'),
            trackedItemId,
            trackerId: tracker.id,
            name: stored.name,
            path: stored.path,
            sourcePath: pickedFile ? '' : trimmedPath,
            storageMode: pickedFile ? 'copy' : 'link',
            size: stored.size,
            contentHash,
            latest: true,
            notes: fileUploadNotes.trim(),
            createdAt: new Date().toISOString(),
          },
        ],
      });
      setFileUploadNotes('');
      setStagedAttachment(null);
      setReplaceTargetFileId('');
    } catch (error) {
      setFileError(String(error));
    } finally {
      setFileBusy(false);
    }
  };

  const selectLinkedProjectFile = async () => {
    setFileBusy(true);
    setFileError('');
    try {
      const selectedPath = await pickLinkedFilePath();
      if (selectedPath) setStagedAttachment({ type: 'link-file', path: selectedPath });
    } catch (error) {
      setFileError(String(error));
    } finally {
      setFileBusy(false);
    }
  };

  const selectLinkedProjectFolder = async () => {
    setFileBusy(true);
    setFileError('');
    try {
      const selectedPath = await pickLinkedFolderPath();
      if (selectedPath) setStagedAttachment({ type: 'link-folder', path: selectedPath });
    } catch (error) {
      setFileError(String(error));
    } finally {
      setFileBusy(false);
    }
  };

  const attachProjectFolder = async (pickedFiles = []) => {
    const trackerId = replaceTargetFile?.trackerId || fileTrackerId;
    const tracker = template.fileTrackers.find((item) => item.id === trackerId);
    const allPickedFiles = [...pickedFiles];
    const hasExtensionFilter = Boolean((tracker?.extensions || '').split(',').map((item) => item.trim()).filter(Boolean).length);
    const files = hasExtensionFilter ? allPickedFiles.filter((file) => extensionAllowed(file.name, tracker?.extensions || '')) : allPickedFiles;
    if (!tracker || !files.length) {
      setFileError(tracker?.extensions ? `No files in that folder match: ${tracker.extensions}` : 'No files found in that folder.');
      return;
    }

    setFileBusy(true);
    setFileError('');
    try {
      const now = new Date().toISOString();
      const firstPath = files[0]?.webkitRelativePath || files[0]?.name || 'Folder upload';
      const folderName = firstPath.split('/').filter(Boolean)[0] || 'Folder upload';
      const storedFiles = await Promise.all(files.map(async (file) => {
        const relativePath = file.webkitRelativePath || file.name;
        const relativeParts = relativePath.split('/').filter(Boolean);
        const childRelativePath = relativeParts.length > 1 ? relativeParts.slice(1).join('/') : file.name;
        const folderParts = childRelativePath.split('/').slice(0, -1);
        const library = ['project-files', project.id, tracker.id, folderName, ...folderParts].join('/');
        const stored = await savePickedFile(file, library);
        const contentHash = stored.path ? await fileHash(stored.path).catch(() => '') : '';
        return {
          id: makeId('folder-file'),
          name: relativeParts.length > 1 ? relativePath : stored.name,
          relativePath: childRelativePath,
          path: stored.path,
          size: stored.size,
          contentHash,
        };
      }));
      const folderRecord = {
        id: makeId('file'),
        trackedItemId: replaceTargetFile ? trackedItemKey(replaceTargetFile) : makeId('tracked-file'),
        trackerId: tracker.id,
        type: 'folder',
        name: folderName,
        path: '',
        sourcePath: '',
        storageMode: 'copy',
        size: storedFiles.reduce((total, file) => total + (file.size || 0), 0),
        contentHash: '',
        latest: true,
        notes: fileUploadNotes.trim(),
        folderFiles: storedFiles,
        createdAt: now,
      };
      onUpdate({
        files: [
          ...(replaceTargetFile
            ? project.files.map((file) => trackedItemKey(file) === trackedItemKey(replaceTargetFile) ? { ...file, latest: false } : file)
            : project.files),
          folderRecord,
        ],
      });
      setFileUploadNotes('');
      setStagedAttachment(null);
      setReplaceTargetFileId('');
      if (hasExtensionFilter && files.length !== allPickedFiles.length) setFileError(`Uploaded folder "${folderName}" with ${files.length} matching files. Some files did not match this file type.`);
    } catch (error) {
      setFileError(String(error));
    } finally {
      setFileBusy(false);
    }
  };

  const attachLinkedProjectFolder = async (folderPath) => {
    const trackerId = replaceTargetFile?.trackerId || fileTrackerId;
    const tracker = template.fileTrackers.find((item) => item.id === trackerId);
    if (!tracker || !folderPath) return;
    setFileBusy(true);
    setFileError('');
    try {
      const allFiles = await listLinkedFolderFiles(folderPath);
      const hasExtensionFilter = Boolean((tracker.extensions || '').split(',').map((item) => item.trim()).filter(Boolean).length);
      const files = hasExtensionFilter ? allFiles.filter((file) => extensionAllowed(file.name, tracker.extensions)) : allFiles;
      if (!files.length) {
        setFileError(tracker.extensions ? `No files in that folder match: ${tracker.extensions}` : 'No files found in that folder.');
        return;
      }
      const now = new Date().toISOString();
      const folderName = folderPath.split(/[\\/]/).filter(Boolean).pop() || 'Linked folder';
      const folderFiles = await Promise.all(files.map(async (file) => ({
        id: makeId('folder-file'),
        name: file.relativePath || file.name,
        relativePath: file.relativePath || file.name,
        path: file.path,
        size: file.size || 0,
        contentHash: file.path ? await fileHash(file.path).catch(() => '') : '',
      })));
      onUpdate({
        files: [
          ...(replaceTargetFile
            ? project.files.map((file) => trackedItemKey(file) === trackedItemKey(replaceTargetFile) ? { ...file, latest: false } : file)
            : project.files),
          {
            id: makeId('file'),
            trackedItemId: replaceTargetFile ? trackedItemKey(replaceTargetFile) : makeId('tracked-file'),
            trackerId: tracker.id,
            type: 'folder',
            name: folderName,
            path: '',
            sourcePath: folderPath,
            storageMode: 'link',
            size: folderFiles.reduce((total, file) => total + (file.size || 0), 0),
            contentHash: '',
            latest: true,
            notes: fileUploadNotes.trim(),
            folderFiles,
            createdAt: now,
          },
        ],
      });
      setFileUploadNotes('');
      setStagedAttachment(null);
      setReplaceTargetFileId('');
      if (hasExtensionFilter && files.length !== allFiles.length) setFileError(`Linked folder "${folderName}" with ${files.length} matching files. Some files did not match this file type.`);
    } catch (error) {
      setFileError(String(error));
    } finally {
      setFileBusy(false);
    }
  };

  const loadStagedAttachment = () => {
    if (!stagedAttachment) return;
    if (stagedAttachment.type === 'upload-file') attachProjectFile(stagedAttachment.file);
    if (stagedAttachment.type === 'upload-folder') attachProjectFolder(stagedAttachment.files);
    if (stagedAttachment.type === 'link-file') attachProjectFile(null, stagedAttachment.path);
    if (stagedAttachment.type === 'link-folder') attachLinkedProjectFolder(stagedAttachment.path);
  };

  const beginReplaceFile = (file) => {
    setReplaceTargetFileId(file.id);
    setFileTrackerId(file.trackerId);
    setSelectedFileId(file.id);
  };

  const toggleLatest = (fileId) => {
    const target = project.files.find((file) => file.id === fileId);
    if (!target) return;
    const targetItemKey = trackedItemKey(target);
    onUpdate({
      files: project.files.map((file) =>
        file.id === fileId
          ? { ...file, latest: !file.latest }
          : trackedItemKey(file) === targetItemKey && !target.latest
            ? { ...file, latest: false }
            : file,
      ),
    });
  };

  const removeFile = (fileId) => onUpdate({ files: project.files.filter((file) => file.id !== fileId) });
  const updateFile = (fileId, patch) => onUpdate({ files: project.files.map((file) => file.id === fileId ? { ...file, ...patch } : file) });
  const integrityCheckable = (file) => Boolean(file.path || file.type === 'folder');
  const autoIntegrityCheckable = (file) => file.latest && integrityCheckable(file);
  const visibleIntegrityStatus = (file) => (file.latest && ['changed', 'missing'].includes(file.integrityStatus) ? file.integrityStatus : '');
  const checkAttachmentIntegrity = async (file) => {
    if (!integrityCheckable(file)) return;
    try {
      if (file.type === 'folder') {
        const checkedChildren = await Promise.all((file.folderFiles || []).map(async (child) => {
          try {
            const currentHash = await fileHash(child.path);
            return {
              ...child,
              contentHash: child.contentHash || currentHash,
              integrityStatus: child.contentHash && currentHash !== child.contentHash ? 'changed' : 'ok',
              integrityCheckedAt: new Date().toISOString(),
            };
          } catch {
            return { ...child, integrityStatus: 'missing', integrityCheckedAt: new Date().toISOString() };
          }
        }));
        const statuses = checkedChildren.map((child) => child.integrityStatus);
        updateFile(file.id, {
          folderFiles: checkedChildren,
          integrityStatus: statuses.includes('missing') ? 'missing' : statuses.includes('changed') ? 'changed' : 'ok',
          integrityCheckedAt: new Date().toISOString(),
        });
        return;
      }

      const currentHash = await fileHash(file.path);
      updateFile(file.id, {
        contentHash: file.contentHash || currentHash,
        integrityStatus: file.contentHash && currentHash !== file.contentHash ? 'changed' : 'ok',
        integrityCheckedAt: new Date().toISOString(),
      });
    } catch {
      updateFile(file.id, { integrityStatus: 'missing', integrityCheckedAt: new Date().toISOString() });
    }
  };

  const acceptCurrentFileVersion = async (file) => {
    if (!integrityCheckable(file)) return;
    try {
      if (file.type === 'folder') {
        const checkedChildren = await Promise.all((file.folderFiles || []).map(async (child) => {
          const currentHash = await fileHash(child.path);
          return {
            ...child,
            contentHash: currentHash,
            integrityStatus: 'ok',
            integrityCheckedAt: new Date().toISOString(),
          };
        }));
        updateFile(file.id, {
          folderFiles: checkedChildren,
          integrityStatus: 'ok',
          integrityCheckedAt: new Date().toISOString(),
        });
        return;
      }
      const currentHash = await fileHash(file.path);
      updateFile(file.id, {
        contentHash: currentHash,
        integrityStatus: 'ok',
        integrityCheckedAt: new Date().toISOString(),
      });
    } catch {
      updateFile(file.id, { integrityStatus: 'missing', integrityCheckedAt: new Date().toISOString() });
    }
  };

  const checkAllAttachmentIntegrity = async () => {
    const currentFiles = projectFilesRef.current;
    if (autoIntegrityBusyRef.current || !currentFiles.some(autoIntegrityCheckable)) return;
    autoIntegrityBusyRef.current = true;
    try {
      const checkedFiles = await Promise.all(currentFiles.map(async (file) => {
        if (!autoIntegrityCheckable(file)) return file;
        try {
          if (file.type === 'folder') {
            const checkedChildren = await Promise.all((file.folderFiles || []).map(async (child) => {
              try {
                const currentHash = await fileHash(child.path);
                return {
                  ...child,
                  contentHash: child.contentHash || currentHash,
                  integrityStatus: child.contentHash && currentHash !== child.contentHash ? 'changed' : 'ok',
                  integrityCheckedAt: new Date().toISOString(),
                };
              } catch {
                return { ...child, integrityStatus: 'missing', integrityCheckedAt: new Date().toISOString() };
              }
            }));
            const statuses = checkedChildren.map((child) => child.integrityStatus);
            return {
              ...file,
              folderFiles: checkedChildren,
              integrityStatus: statuses.includes('missing') ? 'missing' : statuses.includes('changed') ? 'changed' : 'ok',
              integrityCheckedAt: new Date().toISOString(),
            };
          }
          const currentHash = await fileHash(file.path);
          return {
            ...file,
            contentHash: file.contentHash || currentHash,
            integrityStatus: file.contentHash && currentHash !== file.contentHash ? 'changed' : 'ok',
            integrityCheckedAt: new Date().toISOString(),
          };
        } catch {
          return { ...file, integrityStatus: 'missing', integrityCheckedAt: new Date().toISOString() };
        }
      }));
      onUpdate({ files: checkedFiles });
    } finally {
      autoIntegrityBusyRef.current = false;
    }
  };

  useEffect(() => {
    checkAllAttachmentIntegrity();
    const timer = window.setInterval(checkAllAttachmentIntegrity, 60000);
    return () => window.clearInterval(timer);
  }, [project.id]);
  const downloadProjectFile = async (file) => {
    try {
      await downloadStoredProjectFile(file);
    } catch (error) {
      setFileError(String(error));
    }
  };
  const fileLibrary = (file) => `project-files/${project.id}/${file.trackerId}`;
  const beginEdit = async (file) => {
    if (file.type === 'folder') {
      setSelectedFileId(file.id);
      return;
    }
    if (!file.path) return;
    setFileBusy(true);
    setFileError('');
    try {
      const baseHash = await fileHash(file.path);
      const editable = file.storageMode === 'link'
        ? { name: file.name, path: file.path, size: file.size || 0 }
        : await prepareEditableFile(file.path, file.name, `${fileLibrary(file)}/working/${file.id}`);

      setEditSessions((current) => ({
        ...current,
        [file.id]: {
          path: editable.path,
          baseHash,
          name: file.name,
          trackerId: file.trackerId,
          trackedItemId: trackedItemKey(file),
          sourcePath: file.storageMode === 'link' ? file.path : '',
        },
      }));
      await openStoredFile(editable.path);
    } catch (error) {
      setFileError(String(error));
    } finally {
      setFileBusy(false);
    }
  };

  const checkFileChanges = async (file, providedSession = editSessions[file.id], options = {}) => {
    if (!providedSession?.path) return false;
    try {
      const currentHash = await fileHash(providedSession.path);
      if (currentHash === providedSession.baseHash) {
        if (!options.quiet) setFileError(`No saved changes found for ${file.name}.`);
        return false;
      }

      if (file.storageMode === 'link') {
        onUpdate({
          files: project.files.map((item) => item.id === file.id ? {
            ...item,
            contentHash: currentHash,
            integrityStatus: 'ok',
            integrityCheckedAt: new Date().toISOString(),
          } : item),
        });
        setEditSessions((current) => ({
          ...current,
          [file.id]: {
            ...providedSession,
            baseHash: currentHash,
          },
        }));
        if (!options.quiet) setFileError(`Updated linked file status for ${file.name}.`);
        return true;
      }

      const bytes = await readStoredFile(providedSession.path);
      const now = new Date().toISOString();
      if (providedSession.versionFileId && providedSession.versionPath) {
        const stored = await overwriteBytesFile(providedSession.versionPath, bytes, file.name);
        const sessionItemKey = providedSession.trackedItemId || trackedItemKey(file);
        onUpdate({
          files: project.files.map((item) =>
            item.id === providedSession.versionFileId
              ? {
                ...item,
                path: stored.path,
                size: stored.size,
                contentHash: currentHash,
                latest: true,
                notes: withLatestVersionNote(item.notes || file.notes, new Date(now)),
                createdAt: now,
              }
              : trackedItemKey(item) === sessionItemKey
                ? { ...item, latest: false }
                : item,
          ),
        });
        setEditSessions((current) => ({
          ...current,
          [file.id]: {
            ...providedSession,
            baseHash: currentHash,
            versionPath: stored.path,
          },
        }));
        if (!options.quiet) setFileError(`Updated ${file.name} in the current edit session.`);
        return true;
      }

      const stored = await saveBytesFile(file.name, fileLibrary(file), bytes);
      const newFileId = makeId('file');
      const newFile = {
        ...file,
        id: newFileId,
        trackedItemId: trackedItemKey(file),
        path: stored.path,
        sourcePath: providedSession.sourcePath || file.sourcePath || '',
        storageMode: 'copy',
        size: stored.size,
        contentHash: currentHash,
        latest: true,
        notes: withLatestVersionNote(file.notes, new Date(now)),
        createdAt: now,
      };
      const itemKey = trackedItemKey(file);
      const resetFiles = project.files.map((item) => trackedItemKey(item) === itemKey ? { ...item, latest: false } : item);
      onUpdate({
        files: [
          ...resetFiles,
          newFile,
        ],
      });
      setEditSessions((current) => {
        const next = { ...current };
        delete next[file.id];
        next[newFileId] = {
          ...providedSession,
          baseHash: currentHash,
          name: file.name,
          trackerId: file.trackerId,
          trackedItemId: itemKey,
          versionFileId: newFileId,
          versionPath: stored.path,
        };
        return next;
      });
      setSelectedFileId(newFileId);
      if (!options.quiet) setFileError(`Saved ${file.name} as a new latest version.`);
      return true;
    } catch (error) {
      if (!options.quiet) setFileError(String(error));
      return false;
    }
  };

  useEffect(() => {
    const onFocus = () => {
      Object.entries(editSessions).forEach(([fileId, session]) => {
        const file = project.files.find((item) => item.id === fileId);
        if (file) checkFileChanges(file, session, { quiet: true });
      });
    };

    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [editSessions, project.files]);

  const sortFiles = (files) => [...files].sort((a, b) => {
    if (a.latest !== b.latest) return a.latest ? -1 : 1;
    const dateA = Date.parse(a.createdAt || '') || 0;
    const dateB = Date.parse(b.createdAt || '') || 0;
    return dateB - dateA || a.name.localeCompare(b.name);
  });
  const grouped = template.fileTrackers.map((tracker) => ({
    tracker,
    files: sortFiles(project.files.filter((file) => file.trackerId === tracker.id)),
  })).filter((group) => group.files.length);
  const latestFiles = sortFiles(project.files.filter((file) => file.latest));
  const allFiles = grouped.flatMap((group) => group.files);
  const viewerFiles = viewerScope === 'latest' ? latestFiles : allFiles;
  const selectedFile = viewerFiles.find((file) => file.id === selectedFileId) || viewerFiles[0] || null;
  const selectedFileTracker = selectedFile ? template.fileTrackers.find((tracker) => tracker.id === selectedFile.trackerId) : null;
  const selectedExtension = fileExtension(selectedFile?.name || '');
  const fullViewerExtensions = new Set(['.pdf', '.stl', '.obj', '.dxf', ...TEXT_EXTENSIONS]);
  const viewerMode = selectedFile && (selectedFile.type === 'folder' || fullViewerExtensions.has(selectedExtension)) ? 'full' : 'compact';
  const fileBusyLabel = fileBusy ? 'Working on file operation...' : '';

  useEffect(() => {
    if (!selectedFile) {
      setSelectedFileId('');
      return;
    }
    if (!selectedFileId || !viewerFiles.some((file) => file.id === selectedFileId)) setSelectedFileId(selectedFile.id);
  }, [project.files, selectedFile, selectedFileId, viewerFiles]);

  return (
    <div className="files-workspace">
      <div className="file-list-pane">
        <section className="panel upload-card">
          <div className="upload-type-row">
            <select value={fileTrackerId} onChange={(event) => { setFileTrackerId(event.target.value); setReplaceTargetFileId(''); }}>
              {template.fileTrackers.map((tracker) => (
                <option key={tracker.id} value={tracker.id}>
                  {tracker.name}{tracker.extensions ? ` (${tracker.extensions})` : ''}
                </option>
              ))}
            </select>
            <input value={fileUploadNotes} onChange={(event) => setFileUploadNotes(event.target.value)} placeholder="Upload notes" />
          </div>
          {replaceTargetFile && (
            <div className="replace-file-notice">
              <span>Changing: {replaceTargetFile.name}</span>
              <button className="ghost" onClick={() => setReplaceTargetFileId('')}>Cancel Change</button>
            </div>
          )}
          <div className="upload-action-row">
            <div className="upload-buttons">
              <label className="file-picker compact-picker">
                <input
                  type="file"
                  accept={acceptFromExtensions(template.fileTrackers.find((tracker) => tracker.id === fileTrackerId)?.extensions || '')}
                  onChange={(event) => {
                    const pickedFile = event.target.files?.[0];
                    if (pickedFile) setStagedAttachment({ type: 'upload-file', file: pickedFile });
                    event.target.value = '';
                  }}
                />
                Upload File
              </label>
              <label className="file-picker compact-picker">
                <input
                  type="file"
                  multiple
                  webkitdirectory=""
                  directory=""
                  onChange={(event) => {
                    const files = Array.from(event.target.files || []);
                    if (files.length) setStagedAttachment({ type: 'upload-folder', files });
                    event.target.value = '';
                  }}
                />
                Upload Folder
              </label>
              <button onClick={selectLinkedProjectFile} disabled={fileBusy}>Link File</button>
              <button onClick={selectLinkedProjectFolder} disabled={fileBusy}>Link Folder</button>
            </div>
            <button className={stagedAttachment ? '' : 'secondary'} onClick={loadStagedAttachment} disabled={fileBusy || !stagedAttachment}>
              {fileBusy ? 'Loading...' : stagedAttachment?.type?.includes('folder') ? 'Load Folder' : 'Load File'}
            </button>
          </div>
          <BusyNotice label={fileBusyLabel} />
          {fileError && <p className="error-text">{fileError}</p>}
        </section>

        {grouped.length === 0 ? <section className="panel empty-panel">No files attached yet.</section> : grouped.map(({ tracker, files }) => {
          const expanded = !!expandedFileGroups[tracker.id];
          const latestInGroup = files.filter((file) => file.latest);
          const visibleFiles = expanded ? files : (latestInGroup.length ? latestInGroup : files.slice(0, 1));
          const olderCount = Math.max(0, files.length - visibleFiles.length);
          const hasHiddenFiles = files.length > (latestInGroup.length ? latestInGroup.length : 1);
          const latestIsLinked = (latestInGroup.length ? latestInGroup : files.slice(0, 1)).some((file) => file.storageMode === 'link');
          return (
          <section key={tracker.id} className="panel file-group">
            <div className="file-group-header">
              <div className="file-group-title-row">
                <h3>{tracker.name}</h3>
                {latestIsLinked && <span className="linked-status">Linked</span>}
              </div>
              <div className="file-group-actions">
                {hasHiddenFiles && (
                  <button
                    className="ghost"
                    onClick={() => setExpandedFileGroups((current) => ({ ...current, [tracker.id]: !current[tracker.id] }))}
                  >
                    {expanded ? 'Collapse' : 'Show all'}
                  </button>
                )}
              </div>
            </div>
            <div className="file-table">
              {visibleFiles.map((file) => (
                <div key={file.id} className="file-row">
                  <div className="file-row-left">
                    {(file.path || file.type === 'folder') && <button className="file-link-button" onClick={() => { setSelectedFileId(file.id); beginEdit(file); }} disabled={fileBusy}>Open</button>}
                    {(file.path || file.type === 'folder') && <button className="file-download-button" onClick={() => downloadProjectFile(file)}>Download</button>}
                    <strong>{file.type === 'folder' ? `${file.name}, ${(file.folderFiles || []).length} files` : file.name}</strong>
                    <div className="file-note-field">
                      <span>Note:</span>
                      <p>{file.notes || ''}</p>
                    </div>
                  </div>
                  <div className="file-row-right">
                    {visibleIntegrityStatus(file) && <span className={`integrity-pill ${file.integrityStatus}`}>{integrityLabel(file.integrityStatus)}</span>}
                    <span className="file-date">{file.createdAt ? new Date(file.createdAt).toLocaleDateString() : ''}</span>
                    {file.latest && <button className="ghost" onClick={() => beginReplaceFile(file)}>Change</button>}
                    <button className={file.latest ? 'latest-pill' : 'mark-latest-button'} onClick={() => { toggleLatest(file.id); setSelectedFileId(file.id); }}>{file.latest ? 'Latest' : 'Mark Latest'}</button>
                    <button className="file-delete-button" onClick={() => removeFile(file.id)} aria-label={`Delete ${file.name}`}>x</button>
                  </div>
                  {(file.path || file.type === 'folder' || editSessions[file.id] || tracker.programPath) && (
                    <div className="file-extra-actions">
                      {file.latest && file.integrityStatus === 'changed' && <button className="ghost" onClick={() => acceptCurrentFileVersion(file)}>Update</button>}
                      {file.path && tracker.programPath && <button className="ghost" onClick={() => openWithProgram(tracker.programPath, file.path)}>Launch</button>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
          );
        })}
      </div>
      <section className={`panel file-viewer-card ${viewerMode === 'compact' ? 'compact-viewer' : 'full-viewer'}`}>
        <div className="section-title">
          <h2>File Viewer</h2>
          <div className="viewer-scope-toggle">
            <button className={viewerScope === 'latest' ? 'active' : ''} onClick={() => setViewerScope('latest')}>Latest Files</button>
            <button className={viewerScope === 'all' ? 'active' : ''} onClick={() => setViewerScope('all')}>All Files</button>
          </div>
          {selectedFile?.path && selectedFileTracker?.programPath && <button className="ghost" onClick={() => openWithProgram(selectedFileTracker.programPath, selectedFile.path)}>Launch</button>}
        </div>
        {selectedFile ? (
          <>
            <select value={selectedFile.id} onChange={(event) => setSelectedFileId(event.target.value)}>
              {viewerFiles.map((file) => (
                <option key={file.id} value={file.id}>
                  {fileTrackerLabel(template.fileTrackers, file.trackerId)} - {file.name}
                </option>
              ))}
            </select>
            <div className="file-viewer-meta">
              <strong>{fileTrackerLabel(template.fileTrackers, selectedFile.trackerId)}</strong>
              <span>{selectedFile.name}</span>
            </div>
            <FilePreview file={selectedFile} />
          </>
        ) : <p>No files available to preview yet.</p>}
      </section>
    </div>
  );
}

function buildCategoryTree(categories) {
  const nodes = categories.map((category) => ({ ...category, children: [] }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const roots = [];

  nodes.forEach((node) => {
    const parent = byId.get(node.parentId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  });

  const sortTree = (items) => items
    .sort((a, b) => ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || a.name.localeCompare(b.name))
    .map((item) => ({ ...item, children: sortTree(item.children) }));

  return sortTree(roots);
}

function descendantCategoryIds(categories, categoryId) {
  const children = categories.filter((category) => category.parentId === categoryId);
  return children.flatMap((category) => [category.id, ...descendantCategoryIds(categories, category.id)]);
}

function categoryTreeCount(node, parts, categories) {
  const ids = new Set([node.id, ...descendantCategoryIds(categories, node.id)]);
  return parts.filter((part) => ids.has(part.categoryId)).length;
}

function orderedCategoryDrafts(categories) {
  return flattenCategoryOptions(categories).map((category, index) => {
    const { depth, label, fullLabel, ...cleanCategory } = category;
    return { ...cleanCategory, sortOrder: index };
  });
}

function CategoryTreeNode({ node, parts, categories, activeId, onSelect, onDropPart, draggingPartId = '', depth = 0 }) {
  const [open, setOpen] = useState(false);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div className="category-tree-line" style={{ paddingLeft: `${depth * 14}px` }}>
        {hasChildren ? (
          <button className="tree-toggle" onClick={() => setOpen((value) => !value)}>{open ? '-' : '+'}</button>
        ) : <span className="tree-toggle-spacer" />}
        <button
          data-library-category-id={node.id}
          className={`category-row tree-row ${activeId === node.id ? 'active' : ''} ${draggingPartId ? 'drop-ready' : ''}`}
          onClick={() => onSelect(node.id)}
        >
          {node.name} <span>{categoryTreeCount(node, parts, categories)}</span>
        </button>
      </div>
      {open && hasChildren && node.children.map((child) => (
        <CategoryTreeNode
          key={child.id}
          node={child}
          parts={parts}
          categories={categories}
          activeId={activeId}
          onSelect={onSelect}
          onDropPart={onDropPart}
          draggingPartId={draggingPartId}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

function CategoryManager({ categories, onUpdate, onClose }) {
  const [drafts, setDrafts] = useState(categories);
  const [newCategory, setNewCategory] = useState({ name: '', parentId: '' });
  const [dragId, setDragId] = useState('');
  const [dragOverId, setDragOverId] = useState('');
  const [dragOverPosition, setDragOverPosition] = useState('before');
  const [mergeSource, setMergeSource] = useState('');
  const [mergeTarget, setMergeTarget] = useState('');
  const [remaps, setRemaps] = useState({});
  const orderedDrafts = flattenCategoryOptions(drafts.filter((category) => category.id !== 'cat-unassigned'));

  useEffect(() => {
    setDrafts(categories);
  }, [categories]);

  const applyCategories = (nextDrafts, nextRemaps = remaps) => {
    const ordered = orderedCategoryDrafts(nextDrafts);
    setDrafts(ordered);
    onUpdate(ordered, nextRemaps);
  };

  const updateCategory = (categoryId, patch) => {
    applyCategories(drafts.map((category) => category.id === categoryId ? { ...category, ...patch } : category));
  };

  const addCategory = () => {
    if (!newCategory.name.trim()) return;
    applyCategories([
      ...drafts,
      {
        id: makeId('cat'),
        name: newCategory.name.trim(),
        parentId: newCategory.parentId || null,
        sortOrder: drafts.length,
      },
    ]);
    setNewCategory({ name: '', parentId: '' });
  };

  const deleteCategory = (categoryId) => {
    const blocked = new Set([categoryId, ...descendantCategoryIds(drafts, categoryId)]);
    applyCategories(drafts.filter((category) => !blocked.has(category.id)));
  };

  const exportTemplate = () => {
    downloadBytes('buildbook-categories.json', new TextEncoder().encode(JSON.stringify(drafts, null, 2)), 'application/json');
  };

  const importTemplate = async (file) => {
    if (!file) return;
    const imported = JSON.parse(await file.text());
    if (!Array.isArray(imported)) return;
    applyCategories(imported.map((category, index) => ({ id: category.id || makeId('cat'), name: category.name || 'Category', parentId: category.parentId || null, sortOrder: category.sortOrder ?? index })));
  };

  const reorderCategory = (activeDragId, targetId, position = 'before') => {
    setDragOverId('');
    if (!activeDragId || activeDragId === targetId) return;
    const dragged = drafts.find((category) => category.id === activeDragId);
    const target = drafts.find((category) => category.id === targetId);
    if (!dragged || !target) return;
    if (descendantCategoryIds(drafts, dragged.id).includes(target.id)) return;

    const nextParentId = target.parentId || null;
    const moved = drafts.map((category) => (
      category.id === dragged.id ? { ...category, parentId: nextParentId } : category
    ));
    const siblings = moved
      .filter((category) => (category.parentId || null) === nextParentId)
      .sort((a, b) => ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) || a.name.localeCompare(b.name));
    const fromIndex = siblings.findIndex((category) => category.id === dragged.id);
    let targetIndex = siblings.findIndex((category) => category.id === target.id);
    if (fromIndex < 0 || targetIndex < 0) return;
    const [item] = siblings.splice(fromIndex, 1);
    targetIndex = siblings.findIndex((category) => category.id === target.id);
    siblings.splice(targetIndex + (position === 'after' ? 1 : 0), 0, item);
    const siblingOrder = new Map(siblings.map((category, index) => [category.id, index]));

    applyCategories(moved.map((category) => (
      siblingOrder.has(category.id) ? { ...category, sortOrder: siblingOrder.get(category.id) } : category
    )));
    setDragId('');
    setDragOverPosition('before');
  };

  const categoryDropAtPoint = (clientX, clientY) => {
    const row = document.elementFromPoint(clientX, clientY)?.closest('[data-category-id]');
    if (!row) return { id: '', position: 'before' };
    const rect = row.getBoundingClientRect();
    return { id: row.dataset.categoryId || '', position: clientY > rect.top + rect.height / 2 ? 'after' : 'before' };
  };

  const startCategoryDrag = (event, categoryId) => {
    event.preventDefault();
    const handle = event.currentTarget;
    setDragId(categoryId);
    handle.setPointerCapture?.(event.pointerId);

    const moveCategory = (moveEvent) => {
      const target = categoryDropAtPoint(moveEvent.clientX, moveEvent.clientY);
      setDragOverId(target.id && target.id !== categoryId ? target.id : '');
      setDragOverPosition(target.position);
    };
    const finishCategoryDrag = (upEvent) => {
      const target = categoryDropAtPoint(upEvent.clientX, upEvent.clientY);
      handle.releasePointerCapture?.(event.pointerId);
      handle.removeEventListener('pointermove', moveCategory);
      handle.removeEventListener('pointerup', finishCategoryDrag);
      handle.removeEventListener('pointercancel', cancelCategoryDrag);
      reorderCategory(categoryId, target.id, target.position);
    };
    const cancelCategoryDrag = () => {
      handle.releasePointerCapture?.(event.pointerId);
      handle.removeEventListener('pointermove', moveCategory);
      handle.removeEventListener('pointerup', finishCategoryDrag);
      handle.removeEventListener('pointercancel', cancelCategoryDrag);
      setDragId('');
      setDragOverId('');
      setDragOverPosition('before');
    };

    handle.addEventListener('pointermove', moveCategory);
    handle.addEventListener('pointerup', finishCategoryDrag);
    handle.addEventListener('pointercancel', cancelCategoryDrag);
  };

  const mergeCategory = () => {
    if (!mergeSource || !mergeTarget || mergeSource === mergeTarget) return;
    const blocked = new Set([mergeSource, ...descendantCategoryIds(drafts, mergeSource)]);
    if (blocked.has(mergeTarget)) return;

    const nextDrafts = drafts
      .filter((category) => category.id !== mergeSource)
      .map((category) => category.parentId === mergeSource ? { ...category, parentId: mergeTarget } : category);
    const nextRemaps = { ...remaps, [mergeSource]: mergeTarget };
    setRemaps(nextRemaps);
    applyCategories(nextDrafts, nextRemaps);
    setMergeSource('');
    setMergeTarget('');
  };

  const levelLabel = (depth) => (depth === 0 ? 'Root' : `Sub ${depth}`);

  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal category-manager-modal">
        <div className="section-title">
          <h2>Edit Categories</h2>
          <button className="ghost modal-x" onClick={onClose}>x</button>
        </div>
        <div className="category-template-actions">
          <button className="ghost" onClick={exportTemplate}>Export Template</button>
          <label className="file-picker header-picker">
            <input
              type="file"
              accept=".json"
              onChange={(event) => {
                importTemplate(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            Import Template
          </label>
        </div>
        <section className="category-create-box">
          <input value={newCategory.name} onChange={(event) => setNewCategory((current) => ({ ...current, name: event.target.value }))} placeholder="New category name" />
          <select value={newCategory.parentId} onChange={(event) => setNewCategory((current) => ({ ...current, parentId: event.target.value }))}>
            <option value="">Root category</option>
            {orderedDrafts.map((category) => <option key={category.id} value={category.id}>{category.fullLabel}</option>)}
          </select>
          <button onClick={addCategory}>Add Category</button>
        </section>
        <section className="category-merge-box">
          <div>
            <h3>Merge Categories</h3>
            <p>Move parts out of one category and delete it. Child categories move under the destination.</p>
          </div>
          <select value={mergeSource} onChange={(event) => setMergeSource(event.target.value)}>
            <option value="">Category to merge...</option>
            {orderedDrafts.filter((category) => category.id !== 'cat-unassigned').map((category) => (
              <option key={category.id} value={category.id}>{category.fullLabel}</option>
            ))}
          </select>
          <select value={mergeTarget} onChange={(event) => setMergeTarget(event.target.value)}>
            <option value="">Destination...</option>
            {orderedDrafts.filter((category) => category.id !== mergeSource).map((category) => (
              <option key={category.id} value={category.id}>{category.fullLabel}</option>
            ))}
          </select>
          <button className="secondary" onClick={mergeCategory}>Merge</button>
        </section>
        <div className="category-manager-list">
          {orderedDrafts.map((category) => {
            const blocked = new Set([category.id, ...descendantCategoryIds(drafts, category.id)]);
            return (
              <div
                key={category.id}
                data-category-id={category.id}
                className={`category-edit-row depth-${Math.min(category.depth, 4)} ${dragId === category.id ? 'dragging' : ''} ${dragOverId === category.id ? `drop-${dragOverPosition}` : ''}`}
                style={{ marginLeft: `${category.depth * 28}px` }}
              >
                <span
                  className="category-drag-handle"
                  onPointerDown={(event) => startCategoryDrag(event, category.id)}
                  title="Drag to reorder"
                >
                  ::
                </span>
                <span className={`category-depth-pill depth-${Math.min(category.depth, 4)}`}>{levelLabel(category.depth)}</span>
                <input value={category.name} onChange={(event) => updateCategory(category.id, { name: event.target.value })} />
                <select value={category.parentId || ''} onChange={(event) => updateCategory(category.id, { parentId: event.target.value || null })}>
                  <option value="">Root category</option>
                  {orderedDrafts.filter((option) => !blocked.has(option.id)).map((option) => (
                    <option key={option.id} value={option.id}>{option.fullLabel}</option>
                  ))}
                </select>
                <button className="ghost" disabled={category.id === 'cat-unassigned'} onClick={() => deleteCategory(category.id)}>Delete</button>
              </div>
            );
          })}
        </div>
        <div className="modal-footer">
          <button className="secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function Parts({ state, updateState }) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showUnassigned, setShowUnassigned] = useState(false);
  const [editingCategories, setEditingCategories] = useState(false);
  const [creatingPart, setCreatingPart] = useState(false);
  const [draggingPartId, setDraggingPartId] = useState('');
  const [partDragGhost, setPartDragGhost] = useState(null);
  const partDragRef = useRef(null);
  const thumbnailJobsRef = useRef(new Set());
  const suppressPartClickRef = useRef(false);
  const selected = state.parts.find((part) => part.id === selectedId) || null;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const categoryIds = categoryFilter
      ? new Set([categoryFilter, ...descendantCategoryIds(state.categories, categoryFilter)])
      : null;

    return state.parts.filter((part) => {
      if (showUnassigned && part.categoryId !== 'cat-unassigned') return false;
      if (categoryIds && !categoryIds.has(part.categoryId)) return false;
      if (!q) return true;
      return [part.name, categoryLabel(state.categories, part.categoryId), part.storageLocation, part.specSummary, part.notes]
        .some((value) => String(value || '').toLowerCase().includes(q));
    });
  }, [query, state.parts, state.categories, categoryFilter, showUnassigned]);

  const categoryOptions = useMemo(() => flattenCategoryOptions(state.categories), [state.categories]);
  const categoryTree = useMemo(() => buildCategoryTree(state.categories.filter((category) => category.id !== 'cat-unassigned')), [state.categories]);
  const unassignedCount = state.parts.filter((part) => part.categoryId === 'cat-unassigned').length;

  const createPart = async (draft) => {
    if (!draft.name.trim()) return;
    const now = new Date().toISOString();
    const partId = makeId('part');
    const image = draft.imageFile ? await savePartImageWithThumbnail(draft.imageFile, partId) : null;
    const document = draft.documentFile ? await savePickedFile(draft.documentFile, `part-documents/${partId}`) : null;
    const documentHash = document?.path ? await fileHash(document.path).catch(() => '') : '';
    const part = {
      id: partId,
      name: draft.name.trim(),
      categoryId: draft.categoryId || 'cat-unassigned',
      image: image?.image || '',
      imageThumbnail: image?.imageThumbnail || '',
      productUrl: draft.productUrl.trim(),
      storageLocation: draft.storageLocation.trim(),
      specSummary: draft.specSummary.trim(),
      notes: draft.notes.trim(),
      documents: document ? [{
        id: makeId('doc'),
        name: document.name,
        path: document.path,
        sourcePath: '',
        storageMode: 'copy',
        size: document.size,
        contentHash: documentHash,
        type: document.name.toLowerCase().endsWith('.pdf') ? 'datasheet' : 'document',
        createdAt: now,
      }] : [],
      createdAt: now,
      updatedAt: now,
    };
    updateState((current) => ({
      ...current,
      parts: [part, ...current.parts],
      projects: current.projects.map((project) => (
        project.id === draft.projectId && !project.partIds.includes(partId)
          ? { ...project, partIds: [...project.partIds, partId], partQuantities: { ...(project.partQuantities || {}), [partId]: 1 }, updatedAt: now }
          : project
      )),
    }));
    setSelectedId(partId);
    setCreatingPart(false);
  };

  const updatePart = (partId, patch) => {
    updateState((current) => ({
      ...current,
      parts: current.parts.map((part) =>
        part.id === partId ? { ...part, ...patch, updatedAt: new Date().toISOString() } : part,
      ),
    }));
  };

  useEffect(() => {
    const missing = visible.filter((part) => part.image && !part.imageThumbnail && !thumbnailJobsRef.current.has(part.id));
    if (!missing.length) return undefined;
    return runWhenIdle(() => {
      missing.slice(0, 2).forEach((part) => {
        thumbnailJobsRef.current.add(part.id);
        savePhotoThumbnailFromPath(part.image, part.name, `part-images/${part.id}/thumbs`)
          .then((thumbnail) => updatePart(part.id, { imageThumbnail: thumbnail.path }))
          .catch((error) => console.warn('Could not create part thumbnail', error))
          .finally(() => thumbnailJobsRef.current.delete(part.id));
      });
    });
  }, [visible]);

  const movePartToCategory = (categoryId, droppedPartId = '') => {
    const partId = droppedPartId || draggingPartId;
    if (!partId || !categoryId) return;
    updatePart(partId, { categoryId });
    setDraggingPartId('');
    setPartDragGhost(null);
  };

  const categoryDropAtPoint = (clientX, clientY) => (
    document.elementFromPoint(clientX, clientY)?.closest('[data-library-category-id]')?.dataset.libraryCategoryId || ''
  );

  const beginPartPointerDrag = (event, partId) => {
    if (event.button !== 0) return;
    partDragRef.current = { partId, x: event.clientX, y: event.clientY, dragging: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const movePartPointerDrag = (event) => {
    const drag = partDragRef.current;
    if (!drag) return;
    const moved = Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 6;
    if (moved && !drag.dragging) {
      partDragRef.current = { ...drag, dragging: true };
      setDraggingPartId(drag.partId);
    }
    if (partDragRef.current?.dragging) setPartDragGhost({ partId: drag.partId, x: event.clientX, y: event.clientY });
  };

  const endPartPointerDrag = (event) => {
    const drag = partDragRef.current;
    if (!drag) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (drag.dragging) {
      suppressPartClickRef.current = true;
      const categoryId = categoryDropAtPoint(event.clientX, event.clientY);
      if (categoryId) movePartToCategory(categoryId, drag.partId);
      else setDraggingPartId('');
      setPartDragGhost(null);
      window.setTimeout(() => {
        suppressPartClickRef.current = false;
      }, 0);
    }
    partDragRef.current = null;
  };

  const duplicatePart = (part) => {
    const copy = {
      ...part,
      id: makeId('part'),
      name: `${part.name} Copy`,
      documents: part.documents.map((doc) => ({ ...doc, id: makeId('doc') })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    updateState((current) => ({ ...current, parts: [copy, ...current.parts] }));
    setSelectedId(copy.id);
  };

  const deletePart = (partId) => {
    if (!window.confirm('Delete this part from the Parts Library and unlink it from projects?')) return;
    updateState((current) => ({
      ...current,
      parts: current.parts.filter((part) => part.id !== partId),
      projects: current.projects.map((project) => ({ ...project, partIds: project.partIds.filter((id) => id !== partId) })),
    }));
    setSelectedId('');
  };

  const linkPartToProject = (projectId, partId) => {
    if (!projectId || !partId) return;
    updateState((current) => ({
      ...current,
      projects: current.projects.map((project) => (
        project.id === projectId && !project.partIds.includes(partId)
          ? {
            ...project,
            partIds: [...project.partIds, partId],
            partQuantities: { ...(project.partQuantities || {}), [partId]: 1 },
            updatedAt: new Date().toISOString(),
          }
          : project
      )),
    }));
  };

  const unlinkPartFromProject = (projectId, partId) => {
    updateState((current) => ({
      ...current,
      projects: current.projects.map((project) => {
        if (project.id !== projectId) return project;
        const partQuantities = { ...(project.partQuantities || {}) };
        delete partQuantities[partId];
        return {
          ...project,
          partIds: project.partIds.filter((id) => id !== partId),
          partQuantities,
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
  };

  const updateProjectPartQuantity = (projectId, partId, quantity) => {
    updateState((current) => ({
      ...current,
      projects: current.projects.map((project) => (
        project.id === projectId
          ? {
            ...project,
            partQuantities: { ...(project.partQuantities || {}), [partId]: Math.max(0, Number(quantity) || 0) },
            updatedAt: new Date().toISOString(),
          }
          : project
      )),
    }));
  };

  return (
    <div className="parts-library-page">
      <Header title="Parts Library" subtitle="Reference parts, storage locations, specs, datasheets, and product links.">
        <button className="secondary" onClick={() => setEditingCategories(true)}>Edit Categories</button>
        <button onClick={() => setCreatingPart(true)}>New Part</button>
      </Header>
      <div className="parts-library-toolbar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search parts, notes, specs..." />
        <select value={showUnassigned ? 'cat-unassigned' : categoryFilter} onChange={(event) => {
          const value = event.target.value;
          if (value === 'cat-unassigned') {
            setShowUnassigned(true);
            setCategoryFilter('');
          } else {
            setShowUnassigned(false);
            setCategoryFilter(value);
          }
        }}>
          <option value="">All categories</option>
          <option value="cat-unassigned">Unassigned</option>
          {categoryOptions.filter((category) => category.id !== 'cat-unassigned').map((category) => (
            <option key={category.id} value={category.id}>{category.label}</option>
          ))}
        </select>
      </div>
      <div className="library-layout">
        <aside className="library-sidebar">
          <h3>Categories</h3>
          <button
            className={`category-row ${!categoryFilter && !showUnassigned ? 'active' : ''}`}
            onClick={() => { setCategoryFilter(''); setShowUnassigned(false); }}
          >
            All parts <span>{state.parts.length}</span>
          </button>
          <button
            data-library-category-id="cat-unassigned"
            className={`category-row ${showUnassigned ? 'active' : ''} ${draggingPartId ? 'drop-ready' : ''}`}
            onClick={() => { setCategoryFilter(''); setShowUnassigned(true); }}
          >
            Unassigned <span>{unassignedCount}</span>
          </button>
          <div className="category-tree">
            {categoryTree.map((node) => (
              <CategoryTreeNode
                key={node.id}
                node={node}
                parts={state.parts}
                categories={state.categories}
                activeId={categoryFilter}
                onSelect={(id) => { setCategoryFilter(id); setShowUnassigned(false); }}
                onDropPart={movePartToCategory}
                draggingPartId={draggingPartId}
              />
            ))}
          </div>
        </aside>
        <div>
          {(query || categoryFilter || showUnassigned) && (
            <div className="toolbar">
              <button className="secondary" onClick={() => { setQuery(''); setCategoryFilter(''); setShowUnassigned(false); }}>Clear filters</button>
              <span className="muted-count">{visible.length} shown</span>
            </div>
          )}
          {visible.length === 0 ? <div className="panel empty-panel">No parts found.</div> : (
            <div className="item-grid">
              {visible.map((part) => (
                <div
                  key={part.id}
                  className={`part-card ${draggingPartId === part.id ? 'dragging' : ''}`}
                  role="button"
                  tabIndex={0}
                  onPointerDown={(event) => beginPartPointerDrag(event, part.id)}
                  onPointerMove={movePartPointerDrag}
                  onPointerUp={endPartPointerDrag}
                  onPointerCancel={(event) => {
                    event.currentTarget.releasePointerCapture?.(event.pointerId);
                    partDragRef.current = null;
                    setDraggingPartId('');
                    setPartDragGhost(null);
                  }}
                  onClick={() => {
                    if (draggingPartId || suppressPartClickRef.current) return;
                    setSelectedId(part.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedId(part.id);
                    }
                  }}
                >
                  <div className="part-card-image" draggable={false}>{part.image ? <PartPreviewImage part={part} /> : <div className="image-placeholder">Part</div>}</div>
                  <div className="part-card-body">
                    <span>{categoryLabel(state.categories, part.categoryId)}</span>
                    <strong>{part.name}</strong>
                    <p>{part.storageLocation || 'No location set'}</p>
                    <div className="mini-meta">
                      <span>{part.documents.length} docs</span>
                      {part.productUrl && <span>Product link</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {selected && (
        <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && setSelectedId('')}>
          <div className="modal part-library-modal">
            <PartEditor
              part={selected}
              categories={state.categories}
              projects={state.projects}
              onClose={() => setSelectedId('')}
              onUpdate={(patch) => updatePart(selected.id, patch)}
              onLinkProject={linkPartToProject}
              onUnlinkProject={unlinkPartFromProject}
              onProjectQuantityChange={updateProjectPartQuantity}
              onDuplicate={() => duplicatePart(selected)}
              onDelete={() => deletePart(selected.id)}
              onCreateCategory={(name, parentId) => {
                const category = { id: makeId('cat'), name, parentId: parentId || null, sortOrder: state.categories.length };
                updateState((current) => ({ ...current, categories: [...current.categories, category] }));
                updatePart(selected.id, { categoryId: category.id });
              }}
            />
          </div>
        </div>
      )}
      {partDragGhost && (() => {
        const part = state.parts.find((item) => item.id === partDragGhost.partId);
        if (!part) return null;
        return (
          <div className="part-drag-ghost" style={{ left: partDragGhost.x + 14, top: partDragGhost.y + 14 }}>
            <div className="part-drag-ghost-image">{part.image ? <PartPreviewImage part={part} /> : part.name.slice(0, 2).toUpperCase()}</div>
            <div>
              <strong>{part.name}</strong>
              <span>{categoryLabel(state.categories, part.categoryId)}</span>
            </div>
          </div>
        );
      })()}
      {creatingPart && (
        <NewPartDialog
          categories={state.categories}
          projects={state.projects.filter((project) => project.status === 'active')}
          onCreate={createPart}
          onClose={() => setCreatingPart(false)}
        />
      )}
      {editingCategories && (
        <CategoryManager
          categories={state.categories}
          onClose={() => setEditingCategories(false)}
          onUpdate={(categories, remaps = {}) => updateState((current) => ({
            ...current,
            categories,
            parts: current.parts.map((part) => {
              const categoryId = remaps[part.categoryId] || part.categoryId;
              return categories.some((category) => category.id === categoryId) ? { ...part, categoryId } : { ...part, categoryId: 'cat-unassigned' };
            }),
          }))}
        />
      )}
    </div>
  );
}

function NewPartDialog({ categories, projects, onCreate, onClose }) {
  const [draft, setDraft] = useState({
    name: '',
    categoryId: 'cat-unassigned',
    productUrl: '',
    storageLocation: '',
    imageFile: null,
    documentFile: null,
    projectId: '',
    specSummary: '',
    notes: '',
  });
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const categoryOptions = useMemo(() => flattenCategoryOptions(categories), [categories]);

  const updateName = (name) => {
    setDraft((current) => ({
      ...current,
      name,
      categoryId: categoryTouched ? current.categoryId : suggestCategoryId(name, categories),
    }));
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await onCreate(draft);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal new-part-modal">
        <h2>New Part</h2>
        <div className="new-part-grid">
          <label>Name<input autoFocus value={draft.name} onChange={(event) => updateName(event.target.value)} /></label>
          <label>Category
            <select value={draft.categoryId} onChange={(event) => {
              setCategoryTouched(true);
              setDraft((current) => ({ ...current, categoryId: event.target.value }));
            }}>
              <option value="cat-unassigned">Uncategorized</option>
              {categoryOptions.filter((category) => category.id !== 'cat-unassigned').map((category) => (
                <option key={category.id} value={category.id}>{category.fullLabel}</option>
              ))}
            </select>
          </label>
          <label>Product URL<input value={draft.productUrl} onChange={(event) => setDraft((current) => ({ ...current, productUrl: event.target.value }))} placeholder="https://..." /></label>
          <label>Storage location<input value={draft.storageLocation} onChange={(event) => setDraft((current) => ({ ...current, storageLocation: event.target.value }))} placeholder="Bin, drawer, shelf..." /></label>
          <label className="wide">Image<input type="file" accept="image/*" onChange={(event) => setDraft((current) => ({ ...current, imageFile: event.target.files?.[0] || null }))} /></label>
          <label>Document<input type="file" onChange={(event) => setDraft((current) => ({ ...current, documentFile: event.target.files?.[0] || null }))} /></label>
          <label>Add to project
            <select value={draft.projectId} onChange={(event) => setDraft((current) => ({ ...current, projectId: event.target.value }))}>
              <option value="">Do not link yet</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <label className="wide">Spec summary<textarea value={draft.specSummary} onChange={(event) => setDraft((current) => ({ ...current, specSummary: event.target.value }))} /></label>
          <label className="wide">Notes<textarea value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="modal-footer">
          <button className="secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button onClick={save} disabled={busy || !draft.name.trim()}>{busy ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

function PartEditor({ part, categories, projects, onUpdate, onLinkProject, onUnlinkProject, onProjectQuantityChange, onCreateCategory, onDuplicate, onDelete, onClose }) {
  const [documentError, setDocumentError] = useState('');
  const [documentBusy, setDocumentBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [newCategory, setNewCategory] = useState({ name: '', parentId: '' });
  const [projectToLink, setProjectToLink] = useState('');
  const [expandedPreview, setExpandedPreview] = useState(null);
  const previewDocument = part.documents.find((doc) => doc.isPrimary && isPreviewableFile(doc))
    || part.documents.find(isPreviewableFile);
  const linkedProjects = (projects || []).filter((project) => project.partIds.includes(part.id));
  const linkableProjects = (projects || []).filter((project) => !project.partIds.includes(part.id));

  const attachDocument = async (pickedFile = null) => {
    if (!pickedFile) return;
    setDocumentBusy(true);
    setDocumentError('');
    try {
      const stored = await savePickedFile(pickedFile, `part-documents/${part.id}`);
      const contentHash = stored.path ? await fileHash(stored.path).catch(() => '') : '';
      onUpdate({
        documents: [
          ...part.documents,
          {
            id: makeId('doc'),
            name: stored.name,
            path: stored.path,
            sourcePath: '',
            storageMode: 'copy',
            size: stored.size,
            contentHash,
            type: stored.name.toLowerCase().endsWith('.pdf') ? 'datasheet' : 'document',
            isPrimary: !part.documents.length,
            createdAt: new Date().toISOString(),
          },
        ],
      });
    } catch (error) {
      setDocumentError(String(error));
    } finally {
      setDocumentBusy(false);
    }
  };

  const setPrimaryDocument = (docId) => {
    onUpdate({ documents: part.documents.map((doc) => ({ ...doc, isPrimary: doc.id === docId })) });
  };

  const updateImage = async (file) => {
    if (!file) return;
    setImageBusy(true);
    try {
      onUpdate(await savePartImageWithThumbnail(file, part.id));
    } finally {
      setImageBusy(false);
    }
  };

  return (
    <section className="panel detail-panel">
      <div className="section-title">
        <h2>{part.name}</h2>
        {onClose && <button className="ghost" onClick={onClose}>Close</button>}
        <button className="ghost" onClick={() => downloadBytes(`${safeName(part.name)}-part-info.txt`, new TextEncoder().encode(partInfoText(part, categories)), 'text/plain')}>Export Info</button>
        <button className="ghost" onClick={onDuplicate}>Duplicate</button>
        <button className="ghost danger-button" onClick={onDelete}>Delete</button>
      </div>
      <div className="part-editor-layout">
        <div className="part-editor-main">
          <div className="part-editor-image">
            <button
              className="image-expand-button"
              disabled={!part.image}
              onClick={() => part.image && setExpandedPreview({ name: `${part.name} image`, path: part.image, previewType: 'image' })}
            >
              <div className="part-image detail-image">{part.image ? <StoredImage path={part.image} alt="" /> : part.name.slice(0, 2).toUpperCase()}</div>
            </button>
            <div className="part-image-actions">
              <label className="file-picker compact-picker">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    updateImage(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
                {imageBusy ? 'Saving...' : part.image ? 'Change Image' : 'Add Image'}
              </label>
              <button
                className="ghost"
                type="button"
                onClick={() => openExternalUrl(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(part.name)}`)}
                disabled={!part.name.trim()}
              >
                Search web for Image
              </button>
            </div>
          </div>
          <label>Name<input value={part.name} onChange={(event) => onUpdate({ name: event.target.value })} /></label>
          <label>
            Category
            <select value={part.categoryId} onChange={(event) => onUpdate({ categoryId: event.target.value })}>
              {flattenCategoryOptions(categories).map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
            </select>
          </label>
          <div className="mini-create-grid">
            <input value={newCategory.name} onChange={(event) => setNewCategory((current) => ({ ...current, name: event.target.value }))} placeholder="New category" />
            <select value={newCategory.parentId} onChange={(event) => setNewCategory((current) => ({ ...current, parentId: event.target.value }))}>
              <option value="">Root</option>
              {flattenCategoryOptions(categories).map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
            </select>
            <button
              className="ghost"
              onClick={() => {
                if (!newCategory.name.trim()) return;
                onCreateCategory(newCategory.name.trim(), newCategory.parentId);
                setNewCategory({ name: '', parentId: '' });
              }}
            >
              Add
            </button>
          </div>
          <label>Storage Location<input value={part.storageLocation} onChange={(event) => onUpdate({ storageLocation: event.target.value })} /></label>
          <label>
            Product URL
            <div className="input-action-row">
              <input value={part.productUrl} onChange={(event) => onUpdate({ productUrl: event.target.value })} />
              <button className="ghost" disabled={!part.productUrl} onClick={() => openExternalUrl(part.productUrl)}>Open</button>
            </div>
          </label>
          <label>Spec Summary<textarea value={part.specSummary} onChange={(event) => onUpdate({ specSummary: event.target.value })} /></label>
          <label>Notes<textarea value={part.notes} onChange={(event) => onUpdate({ notes: event.target.value })} /></label>
          <section className="part-project-usage">
            <div className="section-title">
              <h3>Project Usage</h3>
            </div>
            {linkedProjects.length ? linkedProjects.map((project) => (
              <div key={project.id} className="usage-row">
                <span>{project.name}</span>
                <label>
                  Qty
                  <input
                    type="number"
                    min="0"
                    value={project.partQuantities?.[part.id] ?? 1}
                    onChange={(event) => onProjectQuantityChange(project.id, part.id, event.target.value)}
                  />
                </label>
                <button className="ghost" onClick={() => onUnlinkProject(project.id, part.id)}>Unlink</button>
              </div>
            )) : <p>No projects use this part yet.</p>}
            <div className="usage-link-row">
              <select value={projectToLink} onChange={(event) => setProjectToLink(event.target.value)}>
                <option value="">Link to project...</option>
                {linkableProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
              <button
                className="ghost"
                disabled={!projectToLink}
                onClick={() => {
                  onLinkProject(projectToLink, part.id);
                  setProjectToLink('');
                }}
              >
                Link
              </button>
            </div>
          </section>
        </div>
        <div className="part-editor-side">
          <div className="preview-box">
            <h3>File Preview</h3>
            {previewDocument ? (
              <>
                <div className="list-line">
                  <span>{previewDocument.name}</span>
                  <button className="ghost" onClick={() => openStoredFile(previewDocument.path)}>Open</button>
                </div>
                <button className="inline-preview-button" onClick={() => setExpandedPreview(previewDocument)}>
                  <FilePreview file={previewDocument} />
                </button>
              </>
            ) : <p>No previewable file attached yet.</p>}
          </div>
          <div>
            <h3>Documents</h3>
            <div className="attach-form vertical">
              <label className="file-picker wide-picker">
                <input
                  type="file"
                  onChange={(event) => {
                    const pickedFile = event.target.files?.[0];
                    if (pickedFile) attachDocument(pickedFile);
                    event.target.value = '';
                  }}
                />
                {documentBusy ? 'Saving...' : 'Choose Document'}
              </label>
            </div>
            {documentError && <p className="error-text">{documentError}</p>}
            {part.documents.map((doc) => (
              <div key={doc.id} className="list-line">
                <span>{doc.name}</span>
                <div className="row-actions">
                  <button className={doc.isPrimary ? 'latest-pill' : 'ghost'} onClick={() => setPrimaryDocument(doc.id)}>{doc.isPrimary ? 'Default' : 'Set Default'}</button>
                  {isPreviewableFile(doc) && (
                    <button className="ghost" onClick={() => setExpandedPreview(doc)}>Preview</button>
                  )}
                  {doc.path && <button className="ghost" onClick={() => openStoredFile(doc.path)}>Open</button>}
                  <button className="ghost" onClick={() => onUpdate({ documents: part.documents.filter((item) => item.id !== doc.id) })}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {expandedPreview && <ExpandedPartFileModal file={expandedPreview} onClose={() => setExpandedPreview(null)} />}
    </section>
  );
}

function Imports({ state, updateState }) {
  const [importError, setImportError] = useState('');
  const [imageBusy, setImageBusy] = useState('');
  const [importBusy, setImportBusy] = useState('');
  const [itemBusy, setItemBusy] = useState('');
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const selectedBatch = state.importBatches.find((batch) => batch.id === selectedBatchId) || null;

  const createBatch = async (file) => {
    if (!file) return;
    setImportError('');
    setImportBusy(`Reading ${file.name}...`);
    try {
      const lowerName = file.name.toLowerCase();
      const text = lowerName.endsWith('.pdf') ? await extractBasicPdfText(file) : await file.text();
      const rows = lowerName.endsWith('.pdf') ? createSupplierRowsFromText(text) : parseCsv(text);
      if (!rows.length) throw new Error('No importable part rows were found in that file.');
      const items = createImportItemsFromRows(rows, state.parts, state.categories);
      const batch = {
        id: makeId('batch'),
        name: file.name,
        source: lowerName.endsWith('.pdf') ? 'PDF invoice' : lowerName.includes('digikey') ? 'Digi-Key' : 'CSV',
        createdAt: new Date().toISOString(),
        items,
      };
      updateState((current) => ({ ...current, importBatches: [batch, ...current.importBatches] }));
      setSelectedBatchId('');
    } catch (error) {
      setImportError(String(error));
    } finally {
      setImportBusy('');
    }
  };

  const updateItem = (batchId, itemId, patch) => {
    updateState((current) => ({
      ...current,
      importBatches: current.importBatches.map((batch) => batch.id === batchId ? {
        ...batch,
        items: batch.items.map((item) => item.id === itemId ? { ...item, ...patch } : item),
      } : batch),
    }));
  };

  const fetchItemImage = async (batchId, item) => {
    if (!item.imageUrl) return '';
    setImageBusy(item.id);
    setImportError('');
    try {
      const stored = await saveImageFromUrl(item.imageUrl, `import-images/${batchId}`);
      updateItem(batchId, item.id, { imagePath: stored.path, imageName: stored.name });
      return stored.path;
    } catch (error) {
      setImportError(`Image fetch failed for ${item.name}: ${String(error)}`);
      return '';
    } finally {
      setImageBusy('');
    }
  };

  const completeItem = async (batchId, item, forcedAction = item.action) => {
    setItemBusy(item.id);
    try {
      const action = forcedAction === 'merge' && !item.matchId ? 'create' : forcedAction;
      const imagePath = action === 'skip' ? '' : item.imagePath || await fetchItemImage(batchId, item);

      updateState((current) => {
        const partPatch = {
          name: item.name,
          categoryId: item.categoryId || 'cat-unassigned',
          productUrl: item.productUrl || '',
          ...(imagePath ? { image: imagePath } : {}),
          notes: [
            item.sku ? `Imported SKU: ${item.sku}` : '',
            item.imageUrl ? `Imported image URL: ${item.imageUrl}` : '',
          ].filter(Boolean).join('\n'),
          updatedAt: new Date().toISOString(),
        };
        let parts = current.parts;

        if (action === 'create') {
          parts = [{
            id: makeId('part'),
            image: '',
            storageLocation: '',
            specSummary: '',
            documents: [],
            createdAt: new Date().toISOString(),
            ...partPatch,
          }, ...parts];
        } else if (action === 'merge' && item.matchId) {
          parts = parts.map((part) => part.id === item.matchId ? { ...part, ...partPatch, notes: [part.notes, partPatch.notes].filter(Boolean).join('\n') } : part);
        }

        return {
          ...current,
          parts,
          importBatches: current.importBatches.map((batch) => batch.id === batchId ? {
            ...batch,
            items: batch.items.map((draft) => draft.id === item.id ? { ...draft, imagePath, status: action === 'skip' ? 'skipped' : 'imported', action } : draft),
          } : batch),
        };
      });
    } finally {
      setItemBusy('');
    }
  };

  const categoryOptions = flattenCategoryOptions(state.categories);
  const sortedItems = (items) => [...items].sort((a, b) => {
    const rank = { none: 0, recommended: 1, exact: 2 };
    return (rank[a.matchQuality] ?? 0) - (rank[b.matchQuality] ?? 0) || a.name.localeCompare(b.name);
  });

  return (
    <div>
      <Header title="Imports" subtitle="Turn online order exports into draft parts for the library." />
      {importError && <section className="alert alert-error">{importError}</section>}
      <BusyNotice label={importBusy} />
      <section className="panel upload-card">
        <div>
          <h3>Import CSV or PDF</h3>
          <p>Upload supplier exports, invoices, or order files to create draft parts. Quantity columns are ignored.</p>
        </div>
        <label className="file-picker header-picker">
          <input
            disabled={!!importBusy}
            type="file"
            accept=".csv,.txt,.pdf"
            onChange={(event) => {
              createBatch(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          {importBusy ? 'Importing...' : 'Import File'}
        </label>
      </section>
      <div className="imports-layout">
        <aside className="library-sidebar">
          <h3>Batches</h3>
          {state.importBatches.length === 0 ? <p>No imports yet.</p> : state.importBatches.map((batch) => (
            <button
              key={batch.id}
              className={`import-row ${selectedBatch?.id === batch.id ? 'active' : ''}`}
              onClick={() => setSelectedBatchId((current) => current === batch.id ? '' : batch.id)}
            >
              <strong>{batch.name}</strong>
              <span>{new Date(batch.createdAt).toLocaleDateString()}</span>
              <small>{batch.items.filter((item) => item.status === 'draft').length} draft / {batch.items.length} total</small>
            </button>
          ))}
        </aside>
        {!selectedBatch ? <section className="panel empty-panel">Select an import batch.</section> : (
        <section className="panel import-batch">
          <div className="section-title">
            <h2>{selectedBatch.name}</h2>
            <span>{selectedBatch.source} - {new Date(selectedBatch.createdAt).toLocaleDateString()}</span>
          </div>
          <div className="import-review-list">
            {sortedItems(selectedBatch.items).map((item) => (
              <div key={item.id} className={`import-part-row match-${item.matchQuality}`}>
                <label>
                  Category
                  <select value={item.categoryId || 'cat-unassigned'} onChange={(event) => updateItem(selectedBatch.id, item.id, { categoryId: event.target.value })}>
                    {categoryOptions.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
                  </select>
                </label>
                <div className="import-part-summary">
                  {(item.imagePath || item.imageUrl) && (
                    <div className="import-image-preview">
                      {item.imagePath ? <StoredImage path={item.imagePath} alt="" /> : <img src={item.imageUrl} alt="" />}
                    </div>
                  )}
                  <input value={item.name} onChange={(event) => updateItem(selectedBatch.id, item.id, { name: event.target.value })} disabled={item.status !== 'draft'} />
                  <span>{item.matchQuality === 'none' ? 'No suggestion' : item.matchQuality === 'exact' ? 'Exact match' : 'Recommended match'}</span>
                  {item.productUrl && <small>{item.productUrl}</small>}
                  {item.imageUrl && <small>{item.imagePath ? 'Image saved locally' : item.imageUrl}</small>}
                </div>
                <div className="import-action-grid">
                  <select value={item.action} disabled={item.status !== 'draft'} onChange={(event) => updateItem(selectedBatch.id, item.id, { action: event.target.value })}>
                    <option value="create">Create new part</option>
                    <option value="merge">Merge into existing</option>
                    <option value="skip">Skip</option>
                  </select>
                  {item.action === 'merge' && (
                    <select value={item.matchId || ''} disabled={item.status !== 'draft'} onChange={(event) => updateItem(selectedBatch.id, item.id, { matchId: event.target.value })}>
                      <option value="">Choose part...</option>
                      {state.parts.map((part) => <option key={part.id} value={part.id}>{part.name}</option>)}
                    </select>
                  )}
                  {item.status === 'draft' ? (
                    <>
                      {item.imageUrl && !item.imagePath && <button className="ghost" disabled={imageBusy === item.id} onClick={() => fetchItemImage(selectedBatch.id, item)}>{imageBusy === item.id ? 'Fetching...' : 'Fetch Image'}</button>}
                      <button disabled={itemBusy === item.id} onClick={() => completeItem(selectedBatch.id, item, item.action)}>{itemBusy === item.id ? 'Applying...' : 'Apply'}</button>
                      <button className="ghost" disabled={itemBusy === item.id} onClick={() => completeItem(selectedBatch.id, item, 'skip')}>Skip</button>
                    </>
                  ) : <span className="status-badge">{item.status}</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
        )}
      </div>
    </div>
  );
}

function Settings({ state, updateState }) {
  const [showTemplatePreview, setShowTemplatePreview] = useState(false);
  const [showThemeEditor, setShowThemeEditor] = useState(false);
  const [restoreError, setRestoreError] = useState('');
  const [backupNotice, setBackupNotice] = useState('');
  const [backupExportBusy, setBackupExportBusy] = useState(false);
  const [backupRestoreBusy, setBackupRestoreBusy] = useState(false);
  const [lanNotice, setLanNotice] = useState('');
  const [lanError, setLanError] = useState('');
  const [lanBusy, setLanBusy] = useState(false);
  const [lanQr, setLanQr] = useState('');
  const [lanAccessUrl, setLanAccessUrl] = useState('');
  const [storageScan, setStorageScan] = useState(null);
  const [storageBusy, setStorageBusy] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [selectedOrphans, setSelectedOrphans] = useState(new Set());
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateNotice, setUpdateNotice] = useState('');
  const [updateError, setUpdateError] = useState('');
  const [availableReleaseUrl, setAvailableReleaseUrl] = useState('');

  const updateTemplate = (patch) => {
    updateState((current) => ({ ...current, template: { ...current.template, ...patch } }));
  };

  const updateLanServer = (patch) => {
    updateState((current) => ({ ...current, lanServer: { ...(current.lanServer || {}), ...patch } }));
  };

  const updateTheme = (theme) => {
    updateState((current) => ({ ...current, theme: normalizeTheme(theme) }));
  };

  const regenerateLanToken = () => {
    const token = crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    updateLanServer({ token });
  };

  const toggleLanServer = () => {
    if (state.lanServer?.enabled) {
      updateLanServer({ enabled: false });
      return;
    }
    updateLanServer({
      enabled: true,
      requireToken: state.lanServer?.requireToken !== false,
      token: state.lanServer?.token || (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`),
    });
  };

  useEffect(() => {
    let active = true;
    const syncLanServer = async () => {
      setLanBusy(true);
      setLanError('');
      try {
        if (state.lanServer?.enabled) {
          const token = state.lanServer.token;
          const requireToken = state.lanServer.requireToken !== false;
          const info = await startLanServer(state.lanServer.port || 8787, token || '', requireToken);
          const accessUrl = info.url ? (requireToken ? `${info.url}?access=${encodeURIComponent(token)}` : info.url) : '';
          const qr = accessUrl ? await QRCode.toDataURL(accessUrl, { margin: 1, width: 180, color: { dark: '#0d1117', light: '#ffffff' } }) : '';
          if (active) {
            setLanNotice(info.url ? `LAN server running at ${info.url}` : 'LAN server running.');
            setLanAccessUrl(accessUrl);
            setLanQr(qr);
          }
        } else {
          const status = await lanServerStatus();
          if (status.running) await stopLanServer();
          if (active) {
            setLanNotice('');
            setLanAccessUrl('');
            setLanQr('');
          }
        }
      } catch (error) {
        if (active) setLanError(String(error));
      } finally {
        if (active) setLanBusy(false);
      }
    };
    syncLanServer();
    return () => { active = false; };
  }, [state.lanServer?.enabled, state.lanServer?.port, state.lanServer?.token, state.lanServer?.requireToken]);

  const exportBackup = async () => {
    setBackupExportBusy(true);
    setRestoreError('');
    setBackupNotice('');
    try {
      const bytes = await buildWebFullBackupPackage(state);
      downloadBytes(`buildbook-full-backup-v${APP_VERSION}.zip`, bytes, 'application/zip');
      setBackupNotice('Full backup exported successfully.');
    } catch (error) {
      setRestoreError(String(error));
    } finally {
      setBackupExportBusy(false);
    }
  };

  const restoreBackup = async (file) => {
    if (!file) return;
    if (!window.confirm('Restore will replace all current BuildBook data with this backup, including projects, parts, files, images, documents, imports, and settings. Continue?')) return;
    setBackupRestoreBusy(true);
    setRestoreError('');
    setBackupNotice('');
    try {
      const restored = file.name.toLowerCase().endsWith('.zip')
        ? await readFullBackupPackage(file)
        : normalizeState(JSON.parse(await file.text()));
      updateState(() => restored);
      setBackupNotice('Backup restored successfully.');
    } catch (error) {
      setRestoreError(String(error));
    } finally {
      setBackupRestoreBusy(false);
    }
  };

  const runStorageScan = async () => {
    setStorageBusy(true);
    setStorageError('');
    try {
      const scan = await scanStorage(collectReferencedPaths(state));
      setStorageScan(scan);
      setSelectedOrphans(new Set((scan.orphans || []).slice(0, 80).map((file) => file.path)));
    } catch (error) {
      setStorageError(String(error));
    } finally {
      setStorageBusy(false);
    }
  };

  const runStorageCleanup = async () => {
    const deletePaths = [...selectedOrphans];
    if (!deletePaths.length) return;
    if (!window.confirm(`Delete ${deletePaths.length} selected unreferenced stored files?`)) return;
    setStorageBusy(true);
    setStorageError('');
    try {
      const scan = await cleanupOrphanedFiles(collectReferencedPaths(state), deletePaths);
      setStorageScan(scan);
      setSelectedOrphans(new Set((scan.orphans || []).slice(0, 80).map((file) => file.path)));
    } catch (error) {
      setStorageError(String(error));
    } finally {
      setStorageBusy(false);
    }
  };

  const runFullStorageCleanup = async () => {
    const deletePaths = (storageScan?.orphans || []).map((file) => file.path);
    if (!deletePaths.length) return;
    if (!window.confirm(`Delete all ${deletePaths.length} orphaned stored files? This cannot be undone.`)) return;
    setStorageBusy(true);
    setStorageError('');
    try {
      const scan = await cleanupOrphanedFiles(collectReferencedPaths(state), deletePaths);
      setStorageScan(scan);
      setSelectedOrphans(new Set());
    } catch (error) {
      setStorageError(String(error));
    } finally {
      setStorageBusy(false);
    }
  };

  const checkForUpdates = async () => {
    setUpdateBusy(true);
    setUpdateNotice('');
    setUpdateError('');
    setAvailableReleaseUrl('');
    try {
      const response = await fetch(GITHUB_LATEST_RELEASE_API, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (response.status === 404) {
        setUpdateNotice('No published BuildBook releases found yet.');
        return;
      }
      if (!response.ok) throw new Error(`Could not check updates. GitHub returned ${response.status}.`);
      const release = await response.json();
      const latestVersion = release.tag_name || release.name || '';
      if (isNewerVersion(latestVersion, APP_VERSION)) {
        setUpdateNotice(`Update available: ${latestVersion}. Installed: v${APP_VERSION}.`);
        setAvailableReleaseUrl(release.html_url || GITHUB_RELEASES_URL);
      } else {
        setUpdateNotice(`BuildBook is up to date. Installed: v${APP_VERSION}.`);
      }
    } catch (error) {
      setUpdateError(String(error));
    } finally {
      setUpdateBusy(false);
    }
  };

  const toggleOrphan = (path) => {
    setSelectedOrphans((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div>
      <Header title="Settings" subtitle="Defaults and safeguards for documenting electronics projects." />
      <section className="panel settings-section">
        <h2>Project Template</h2>
        <p>Set the default project step tags, starter checklist items, and tracked file types used for project workspaces.</p>
        <button className="settings-template-button" onClick={() => setShowTemplatePreview(true)}>Project Template</button>
      </section>
      <section className="panel settings-section">
        <h2>Color Theme</h2>
        <p>Review current app colors, adjust theme tokens, and export or import a portable theme file.</p>
        <button className="settings-template-button" onClick={() => setShowThemeEditor(true)}>Theme Editor</button>
      </section>
      <section className="panel settings-section">
        <h2>Software Updates</h2>
        <p>Check GitHub Releases for a newer BuildBook installer.</p>
        <div className="button-row">
          <button className="secondary" onClick={checkForUpdates} disabled={updateBusy}>{updateBusy ? 'Checking...' : 'Check for Updates'}</button>
          {availableReleaseUrl && <button onClick={() => openExternalUrl(availableReleaseUrl)}>Open Download Page</button>}
        </div>
        {updateBusy && <BusyNotice label="Checking for updates..." />}
        {updateNotice && <p className="success-text">{updateNotice}</p>}
        {updateError && <p className="error-text">{updateError}</p>}
      </section>
      <section className="panel settings-section">
        <h2>Backup and Restore</h2>
        <p>Backup downloads a portable zip containing all desktop data and assets, plus web-compatible restore data.</p>
        <div className="button-row backup-actions">
          <button className="secondary" onClick={exportBackup} disabled={backupExportBusy || backupRestoreBusy}>{backupExportBusy ? 'Exporting...' : 'Export Backup'}</button>
          <label className={`file-picker header-picker backup-button ${backupExportBusy || backupRestoreBusy ? 'disabled-picker' : ''}`}>
            <input
              type="file"
              accept=".zip,.json"
              disabled={backupExportBusy || backupRestoreBusy}
              onChange={(event) => {
                restoreBackup(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            {backupRestoreBusy ? 'Restoring...' : 'Restore Backup'}
          </label>
        </div>
        {backupRestoreBusy && <BusyNotice label="Restoring backup..." />}
        {backupNotice && <p className="success-text">{backupNotice}</p>}
        {restoreError && <p className="error-text">{restoreError}</p>}
      </section>
      <section className="panel settings-section">
        <h2>Storage Cleanup</h2>
        <p>Scan copied BuildBook files and generated thumbnails for orphaned files no longer referenced by app data.</p>
        <div className="button-row backup-actions">
          <button className="secondary" onClick={runStorageScan} disabled={storageBusy}>{storageBusy ? 'Working...' : 'Scan Storage'}</button>
          <button onClick={runStorageCleanup} disabled={storageBusy || !selectedOrphans.size}>Delete Selected</button>
          <button className="danger-fill" onClick={runFullStorageCleanup} disabled={storageBusy || !storageScan?.orphans?.length}>Delete All Orphaned Files</button>
        </div>
        {storageScan && (
          <div className="settings-list">
            <span>{storageScan.fileCount} stored files, {Math.round(storageScan.totalBytes / 1024 / 1024)} MB total.</span>
            <span>{storageScan.orphanCount} orphan files, {Math.round(storageScan.orphanBytes / 1024 / 1024)} MB recoverable.</span>
            {storageScan.deletedCount ? <span>{storageScan.deletedCount} files deleted.</span> : null}
          </div>
        )}
        {storageScan?.orphans?.length ? (
          <div className="orphan-file-list">
            <div className="orphan-toolbar">
              <button type="button" className="ghost" onClick={() => setSelectedOrphans(new Set((storageScan.orphans || []).slice(0, 80).map((file) => file.path)))}>Select Visible</button>
              <button type="button" className="ghost" onClick={() => setSelectedOrphans(new Set())}>Select None</button>
              <span>{selectedOrphans.size} selected</span>
            </div>
            {storageScan.orphans.slice(0, 80).map((file) => (
              <label key={file.path} className="orphan-file-row">
                <input type="checkbox" checked={selectedOrphans.has(file.path)} onChange={() => toggleOrphan(file.path)} />
                <span>{file.relativePath || file.name}</span>
                <small>{Math.max(1, Math.round(file.size / 1024))} KB</small>
                <small>{file.modifiedAt ? new Date(Number(file.modifiedAt)).toLocaleDateString() : ''}</small>
                <button
                  type="button"
                  className="ghost"
                  onClick={async (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    try {
                      await openStoredFile(file.path);
                    } catch (error) {
                      setStorageError(String(error));
                    }
                  }}
                >
                  Open
                </button>
              </label>
            ))}
            {storageScan.orphans.length > 80 && <p>{storageScan.orphans.length - 80} more orphan files hidden. Only visible checked files will be cleaned.</p>}
          </div>
        ) : null}
        {storageError && <p className="error-text">{storageError}</p>}
      </section>
      <section className="panel settings-section">
        <h2>Local Network Access</h2>
        <p>Serve BuildBook to devices on this local network. Leave this off unless you are actively using it.</p>
        <div className="lan-settings-grid">
          <label>
            Port
            <input
              type="number"
              min="1024"
              max="65535"
              value={state.lanServer?.port || 8787}
              onChange={(event) => updateLanServer({ port: Number(event.target.value) || 8787 })}
              disabled={state.lanServer?.enabled}
            />
          </label>
          <button
            className={state.lanServer?.enabled ? 'danger-fill' : ''}
            onClick={toggleLanServer}
            disabled={lanBusy}
          >
            {lanBusy ? 'Working...' : state.lanServer?.enabled ? 'Turn Off' : 'Turn On'}
          </button>
          <button className="secondary" onClick={regenerateLanToken} disabled={lanBusy || state.lanServer?.enabled}>
            Regenerate Access Code
          </button>
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={state.lanServer?.requireToken !== false}
            onChange={(event) => updateLanServer({ requireToken: event.target.checked })}
            disabled={state.lanServer?.enabled}
          />
          Require access token
        </label>
        {state.lanServer?.enabled && (
          <div className="lan-access-box">
            {lanQr && <img src={lanQr} alt="BuildBook LAN access QR code" />}
            <div>
              <strong>Address</strong>
              <p>{lanNotice.replace('LAN server running at ', '')}</p>
              <strong>Access URL</strong>
              <p>{lanAccessUrl}</p>
              <span>{state.lanServer?.requireToken === false ? 'Token is off. Anyone on the network can open this address.' : 'Scan the QR code once. The phone browser remembers the access code.'}</span>
            </div>
          </div>
        )}
        {lanNotice && <p className="success-text">{lanNotice}</p>}
        {lanError && <p className="error-text">{lanError}</p>}
        <p>Use the shown address from your phone while connected to the same Wi-Fi network.</p>
      </section>
      <section className="panel settings-section">
        <h2>Quick Notes</h2>
        <p>BuildBook is for electronics project documentation. Projects are the workspace; parts are reusable reference records for datasheets, product info, storage location, and related documents.</p>
        <div className="settings-list">
          <span>Use Project Template to tune default workflow tags, checklist starters, and file tracking labels.</span>
          <span>Use project exports when sharing a build package with notes, latest files, linked parts, and documents.</span>
          <span>Use Backup before major cleanup, restore testing, or category/template changes.</span>
        </div>
      </section>
      {showTemplatePreview && (
        <TemplatePreviewModal
          template={state.template}
          onClose={() => setShowTemplatePreview(false)}
          onUpdate={updateTemplate}
        />
      )}
      {showThemeEditor && (
        <ThemeEditorModal
          theme={state.theme}
          onClose={() => setShowThemeEditor(false)}
          onSave={updateTheme}
        />
      )}
    </div>
  );
}

function ThemeEditorModal({ theme, onClose, onSave }) {
  const [draft, setDraft] = useState(() => normalizeTheme(theme));
  const [error, setError] = useState('');

  const updateDraft = (key, value) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const exportTheme = () => {
    const payload = {
      type: 'buildbook-theme',
      version: APP_VERSION,
      theme: normalizeTheme(draft),
    };
    downloadBytes('buildbook-theme.json', new TextEncoder().encode(JSON.stringify(payload, null, 2)), 'application/json');
  };

  const importTheme = async (file) => {
    if (!file) return;
    setError('');
    try {
      const payload = JSON.parse(await file.text());
      const nextTheme = payload.theme && typeof payload.theme === 'object' ? payload.theme : payload;
      setDraft(normalizeTheme(nextTheme));
    } catch (importError) {
      setError(String(importError));
    }
  };

  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal theme-modal">
        <div className="section-title">
          <h2>Theme Editor</h2>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
        <section className="theme-preview" style={{
          '--preview-bg': draft.bg,
          '--preview-sidebar': draft.sidebar,
          '--preview-surface': draft.surface,
          '--preview-raised': draft.surfaceRaised,
          '--preview-field': draft.field,
          '--preview-border': draft.border,
          '--preview-text': draft.text,
          '--preview-muted': draft.textMuted,
          '--preview-accent': draft.accent,
          '--preview-success': draft.success,
          '--preview-danger': draft.danger,
        }}>
          <aside>
            <strong>BuildBook</strong>
            <span>Projects</span>
            <span className="active">Parts Library</span>
            <span>Settings</span>
          </aside>
          <main>
            <div className="theme-preview-header">
              <div>
                <h3>Parts Library</h3>
                <p>Preview of the selected theme colors.</p>
              </div>
              <button>New Part</button>
            </div>
            <div className="theme-preview-grid">
              <article>
                <strong>Nema Motor</strong>
                <span>Motors & Motion</span>
                <input readOnly value="Drawer 1, Bin 1" />
              </article>
              <article>
                <strong>Earthquake PCB</strong>
                <span>Prototyping & Tools</span>
                <button className="danger-fill">Delete</button>
              </article>
            </div>
          </main>
        </section>
        <div className="theme-actions">
          <button onClick={() => onSave(draft)}>Save Theme</button>
          <button className="secondary" onClick={() => setDraft(DEFAULT_THEME)}>Reset Original</button>
          <button className="secondary" onClick={exportTheme}>Export Theme</button>
          <label className="file-picker header-picker backup-button">
            <input
              type="file"
              accept=".json"
              onChange={(event) => {
                importTheme(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            Import Theme
          </label>
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="theme-color-grid">
          {THEME_FIELDS.map(([key, label]) => (
            <div key={key} className="theme-color-row">
              <span>{label}</span>
              <div className="theme-swatch-pair">
                <i style={{ background: DEFAULT_THEME[key] }} title={DEFAULT_THEME[key]} />
                <i style={{ background: draft[key] }} title={draft[key]} />
              </div>
              <input type="color" value={validHexColor(draft[key]) ? draft[key] : DEFAULT_THEME[key]} onChange={(event) => updateDraft(key, event.target.value)} />
              <input value={draft[key]} onChange={(event) => updateDraft(key, event.target.value)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TemplatePreviewModal({ template, onClose, onUpdate }) {
  const [newStep, setNewStep] = useState('');
  const [newChecklist, setNewChecklist] = useState('');
  const [newTracker, setNewTracker] = useState({ name: '', extensions: '', color: '#58a6ff' });
  const [selectedSteps, setSelectedSteps] = useState([]);
  const [dragTrackerId, setDragTrackerId] = useState('');
  const [dragTrackerOverId, setDragTrackerOverId] = useState('');
  const [dragTrackerPosition, setDragTrackerPosition] = useState('before');
  const trackerDragRef = useRef(null);

  const addStep = () => {
    if (!newStep.trim()) return;
    onUpdate({ steps: [...template.steps, newStep.trim()] });
    setNewStep('');
  };

  const toggleSelectedStep = (step) => {
    setSelectedSteps((current) => (
      current.includes(step) ? current.filter((item) => item !== step) : [...current, step]
    ));
  };

  const deleteSelectedSteps = () => {
    if (!selectedSteps.length) return;
    onUpdate({ steps: template.steps.filter((step) => !selectedSteps.includes(step)) });
    setSelectedSteps([]);
  };

  const addChecklist = () => {
    if (!newChecklist.trim()) return;
    onUpdate({ checklist: [...template.checklist, newChecklist.trim()] });
    setNewChecklist('');
  };

  const addTracker = () => {
    if (!newTracker.name.trim()) return;
    onUpdate({
      fileTrackers: [
        ...template.fileTrackers,
        { id: makeId('tracker'), name: newTracker.name.trim(), extensions: newTracker.extensions.trim(), color: newTracker.color || '#58a6ff', programPath: '' },
      ],
    });
    setNewTracker({ name: '', extensions: '', color: '#58a6ff' });
  };

  const updateTracker = (trackerId, patch) => {
    onUpdate({
      fileTrackers: template.fileTrackers.map((tracker) => (
        tracker.id === trackerId ? { ...tracker, ...patch } : tracker
      )),
    });
  };

  const reorderTracker = (sourceId, targetId, position = 'before') => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const current = [...template.fileTrackers];
    const sourceIndex = current.findIndex((tracker) => tracker.id === sourceId);
    let targetIndex = current.findIndex((tracker) => tracker.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [moved] = current.splice(sourceIndex, 1);
    targetIndex = current.findIndex((tracker) => tracker.id === targetId);
    current.splice(targetIndex + (position === 'after' ? 1 : 0), 0, moved);
    onUpdate({ fileTrackers: current });
  };

  const trackerDropAtPoint = (x, y) => {
    const row = document.elementFromPoint(x, y)?.closest?.('[data-template-tracker-id]');
    if (!row) return { id: '', position: 'before' };
    const rect = row.getBoundingClientRect();
    return { id: row.dataset.templateTrackerId || '', position: y > rect.top + rect.height / 2 ? 'after' : 'before' };
  };

  const startTrackerDrag = (event, trackerId) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    trackerDragRef.current = { trackerId };
    setDragTrackerId(trackerId);
    setDragTrackerOverId('');
    setDragTrackerPosition('before');
  };

  const moveTrackerDrag = (event) => {
    const drag = trackerDragRef.current;
    if (!drag) return;
    const target = trackerDropAtPoint(event.clientX, event.clientY);
    setDragTrackerOverId(target.id && target.id !== drag.trackerId ? target.id : '');
    setDragTrackerPosition(target.position);
  };

  const endTrackerDrag = (event) => {
    const drag = trackerDragRef.current;
    if (!drag) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const target = trackerDropAtPoint(event.clientX, event.clientY);
    reorderTracker(drag.trackerId, dragTrackerOverId || target.id, dragTrackerPosition || target.position);
    trackerDragRef.current = null;
    setDragTrackerId('');
    setDragTrackerOverId('');
    setDragTrackerPosition('before');
  };

  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal template-modal">
        <div className="section-title">
          <h2>Project Template</h2>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
        <section className="template-mock">
          <div className="project-card template-card">
            <div className="project-card-image">
              <div>Project</div>
              <span className="status-badge status-active">active</span>
            </div>
            <div className="project-card-body">
              <strong>Template Preview</strong>
              <div className="project-step-tags">
                {template.steps.slice(0, 5).map((step) => <span key={step}>{step}</span>)}
              </div>
              <div className="mini-meta">
                <span>{template.checklist.length} default tasks</span>
                <span>{template.fileTrackers.length} file trackers</span>
              </div>
            </div>
          </div>
          <div className="template-preview-panels">
            <article>
              <h3>Step Buttons</h3>
              <div className="inline-entry">
                <input value={newStep} onChange={(event) => setNewStep(event.target.value)} placeholder="New step" />
                <button onClick={addStep}>Add</button>
                {selectedSteps.length > 0 && (
                  <button className="danger-fill" onClick={deleteSelectedSteps}>Delete Selected</button>
                )}
              </div>
              <div className="step-tags template-tags">
                {template.steps.map((step) => (
                  <button
                    key={step}
                    className={`tag ${selectedSteps.includes(step) ? 'selected-delete' : 'active'}`}
                    onClick={() => toggleSelectedStep(step)}
                  >
                    {step}
                  </button>
                ))}
              </div>
            </article>
            <article>
              <h3>Default Checklist</h3>
              <div className="inline-entry">
                <input value={newChecklist} onChange={(event) => setNewChecklist(event.target.value)} placeholder="Default task" />
                <button onClick={addChecklist}>Add</button>
              </div>
              {template.checklist.map((item) => (
                <div key={item} className="list-line">
                  <span>{item}</span>
                  <button className="ghost" onClick={() => onUpdate({ checklist: template.checklist.filter((text) => text !== item) })}>Delete</button>
                </div>
              ))}
            </article>
            <article className="wide">
              <h3>Tracked File Types</h3>
              <div className="tracker-row">
                <input value={newTracker.name} onChange={(event) => setNewTracker((current) => ({ ...current, name: event.target.value }))} placeholder="Tracker name" />
                <input value={newTracker.extensions} onChange={(event) => setNewTracker((current) => ({ ...current, extensions: event.target.value }))} placeholder=".pdf,.dxf" />
                <input aria-label="Tracker color" type="color" value={validHexColor(newTracker.color) ? newTracker.color : '#58a6ff'} onChange={(event) => setNewTracker((current) => ({ ...current, color: event.target.value }))} />
                <button onClick={addTracker}>Add</button>
              </div>
              {template.fileTrackers.map((tracker) => (
                <div
                  key={tracker.id}
                  data-template-tracker-id={tracker.id}
                  className={`tracker-edit-row ${dragTrackerId === tracker.id ? 'dragging' : ''} ${dragTrackerOverId === tracker.id ? `drop-${dragTrackerPosition}` : ''}`}
                >
                  <span
                    className="drag-handle"
                    title="Drag to reorder"
                    onPointerDown={(event) => startTrackerDrag(event, tracker.id)}
                    onPointerMove={moveTrackerDrag}
                    onPointerUp={endTrackerDrag}
                    onPointerCancel={endTrackerDrag}
                  >
                    ::
                  </span>
                  <input value={tracker.name} onChange={(event) => updateTracker(tracker.id, { name: event.target.value })} placeholder="Tracker name" />
                  <input value={tracker.extensions || ''} onChange={(event) => updateTracker(tracker.id, { extensions: event.target.value })} placeholder=".pdf,.dxf" />
                  <input aria-label={`${tracker.name} color`} type="color" value={validHexColor(tracker.color) ? tracker.color : '#58a6ff'} onChange={(event) => updateTracker(tracker.id, { color: event.target.value })} />
                  <button className="ghost danger-button" onClick={() => onUpdate({ fileTrackers: template.fileTrackers.filter((item) => item.id !== tracker.id) })}>Delete</button>
                </div>
              ))}
            </article>
          </div>
        </section>
      </div>
    </div>
  );
}

function Header({ title, subtitle, children }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {children && <div className="header-actions">{children}</div>}
    </header>
  );
}
