import { IMAGE_EXTENSIONS, fileExtension, safeName } from './files.js';
import { APP_VERSION, categoryLabel, fileTrackerLabel } from './data.js';
import { escapeHtml } from './richTextPolicy.js';

export const DEFAULT_PROJECT_EXPORT_OPTIONS = {
  overviewNotes: true,
  overviewChecklist: true,
  instructions: true,
  photos: true,
  linkedParts: true,
  latestFiles: true,
  allFileVersions: false,
  partDocuments: true,
};

export const FULL_PROJECT_EXPORT_OPTIONS = {
  ...DEFAULT_PROJECT_EXPORT_OPTIONS,
  allFileVersions: true,
};

export function categoryPath(categories, categoryId) {
  return categoryLabel(categories, categoryId).split('/').map((part) => part.trim()).filter(Boolean);
}

export function buildProjectReadme(project, parts, categories, fileTrackers) {
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

export function buildBomCsv(parts, categories) {
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

export function buildGuideHtml(project, parts, categories, fileTrackers) {
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

export function buildInstructionsHtml(project, parts, photoArchiveById = new Map()) {
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

export function stripHtml(value) {
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

export function partInfoText(part, categories) {
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

export function webUploadPath(folder, name) {
  return name ? `uploads/${folder}/${name}` : '';
}

export function webId(prefix, id) {
  return `${prefix}-web-${id}`;
}

export function webDate(value) {
  return value || new Date().toISOString();
}

export function webTrackerId(key = '') {
  return key ? `tracker-web-${key}` : 'tracker-web-other';
}

export function webTrackerKey(trackerId = '') {
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

export function trackerExtensionsKey(extensions = '') {
  return String(extensions || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(',');
}

export function trackerSignature(tracker) {
  return `${String(tracker?.name || '').trim().toLowerCase()}|${trackerExtensionsKey(tracker?.extensions)}`;
}

export function trackerNameKey(name = '') {
  return String(name || '').trim().toLowerCase();
}

export function findMatchingTracker(trackers, importedTracker) {
  return trackers.find((tracker) => tracker.id === importedTracker.id)
    || trackers.find((tracker) => trackerSignature(tracker) === trackerSignature(importedTracker))
    || trackers.find((tracker) => trackerNameKey(tracker.name) === trackerNameKey(importedTracker?.name))
    || (trackerExtensionsKey(importedTracker?.extensions)
      ? trackers.find((tracker) => trackerExtensionsKey(tracker.extensions) === trackerExtensionsKey(importedTracker.extensions))
      : null)
    || null;
}

export function guessWebFileType(name = '') {
  const extension = fileExtension(name);
  if (extension === '.pdf') return 'pdf';
  if (IMAGE_EXTENSIONS.includes(extension)) return 'image';
  return 'file';
}

export function webUploadName(prefix, id, name, fallbackExtension = '') {
  const extension = fileExtension(name) || fallbackExtension;
  const baseName = String(name || id || prefix).split(/[\\/]/).pop() || String(id || prefix);
  const base = safeName(baseName).replace(/\.[^.]+$/, '').slice(0, 70);
  return `${safeName(prefix)}-${safeName(id)}-${base}${extension}`;
}

export function parseWebMetadataValue(metadata, key, fallback) {
  const item = (metadata || []).find((entry) => entry.key === key);
  if (!item?.value) return fallback;
  try {
    return JSON.parse(item.value);
  } catch {
    return fallback;
  }
}

export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function parseWebMetadataArray(metadata, key) {
  return asArray(parseWebMetadataValue(metadata, key, []));
}
