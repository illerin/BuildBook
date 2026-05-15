import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  APP_VERSION,
  STATUSES,
  categoryLabel,
  fileTrackerLabel,
  makeId,
  normalizeState,
} from './data';
import {
  acceptFromExtensions,
  assetUrl,
  downloadBytes,
  downloadUrlFile,
  extensionAllowed,
  linkedLocalFile,
  openExternalUrl,
  openStoredFile,
  openWithProgram,
  prepareEditableFile,
  readStoredFile,
  saveBytesFile,
  savePickedFile,
} from './desktop';
import { loadAppState, saveAppState } from './storage';
import { createZip, readZip, zipText } from './zip';

const TABS = [
  ['projects', 'Projects'],
  ['completed-projects', 'Completed Projects', 'child'],
  ['archived-projects', 'Archived Projects', 'child'],
  ['parts', 'Parts Library'],
  ['imports', 'Imports'],
  ['settings', 'Settings'],
];

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

  const walk = (parentId = '', depth = 0) => sort(children.get(parentId) || []).flatMap((category) => [
    { ...category, depth, label: `${'  '.repeat(depth)}${category.name}` },
    ...walk(category.id, depth + 1),
  ]);

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
    ['cat-passives', ['resistor', 'capacitor', 'inductor', 'diode', 'transistor', 'mosfet']],
    ['cat-mechanical', ['screw', 'standoff', 'enclosure', 'case', 'bracket', 'bearing', 'gear']],
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
    const packagePath = await addFileEntry(entries, file.path, `project/latest-files/${safeName(fileTrackerLabel(state.template.fileTrackers, file.trackerId))}/${safeName(file.name)}`);
    exportedProject.files.push({ ...file, path: '', sourcePath: '', packagePath });
  }

  const exportedParts = [];
  for (const part of linkedParts) {
    const exportedPart = {
      ...part,
      image: '',
      imagePackagePath: '',
      categoryPath: categoryPath(state.categories, part.categoryId),
      documents: [],
    };
    exportedPart.imagePackagePath = await addFileEntry(entries, part.image, `parts/${safeName(part.name)}/image${fileExtension(part.image) || '.image'}`);
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
        const path = await savePackagedAsset(file.packagePath, file.name, `project-files/${projectId}/${file.trackerId}`);
        importedFiles.push({ ...file, id: makeId('file'), path, sourcePath: '', packagePath: '', latest: true, createdAt: new Date().toISOString() });
      }

      for (const part of manifest.parts || []) {
        const decision = partActions[part.id] || { action: 'create', partId: '' };
        const existing = decision.action === 'reuse' ? updatedParts.find((item) => item.id === decision.partId) : null;

        if (existing) {
          importedPartIds.push(existing.id);
          continue;
        }

        const newPartId = makeId('part');
        const image = await savePackagedAsset(part.imagePackagePath, `${part.name}-image`, `part-images/${newPartId}`);
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
          documents,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        delete createdPart.categoryPath;
        delete createdPart.imagePackagePath;
        createdParts.push(createdPart);
        importedPartIds.push(newPartId);
      }

      const importedProject = {
        ...manifest.project,
        id: projectId,
        name: projectName.trim() || manifest.project.name,
        image: projectImage,
        imagePackagePath: '',
        partIds: importedPartIds,
        files: importedFiles,
        noteImages: importedNoteImages,
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

  useEffect(() => {
    loadAppState().then(setState);
  }, []);

  const updateState = (recipe) => {
    setState((current) => {
      const next = normalizeState(recipe(current));
      setSaveState('saving');
      saveAppState(next)
        .then(() => setSaveState('saved'))
        .catch((error) => {
          console.error(error);
          setSaveState('error');
        });
      return next;
    });
  };

  if (!state) return <div className="loading">Loading BuildBook...</div>;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <strong>BuildBook</strong>
          <span>v{APP_VERSION}</span>
        </div>
        {TABS.map(([key, label, kind]) => (
          <button key={key} className={`${tab === key ? 'active' : ''} ${kind === 'child' ? 'sub-nav' : ''}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
        <div className={`save-state ${saveState}`}>{saveState}</div>
      </aside>
      <main className="workspace">
        {tab === 'projects' && <Projects state={state} updateState={updateState} mode="open" />}
        {tab === 'completed-projects' && <Projects state={state} updateState={updateState} mode="completed" />}
        {tab === 'archived-projects' && <Projects state={state} updateState={updateState} mode="archived" />}
        {tab === 'parts' && <Parts state={state} updateState={updateState} />}
        {tab === 'imports' && <Imports state={state} updateState={updateState} />}
        {tab === 'settings' && <Settings state={state} updateState={updateState} />}
      </main>
    </div>
  );
}

function Projects({ state, updateState, mode }) {
  const [selectedId, setSelectedId] = useState('');
  const [pendingImport, setPendingImport] = useState(null);
  const [importError, setImportError] = useState('');
  const selected = state.projects.find((project) => project.id === selectedId);
  const showingCompleted = mode === 'completed';
  const showingArchived = mode === 'archived';
  const visibleProjects = state.projects.filter((project) => (
    showingArchived ? project.status === 'archived'
      : showingCompleted
        ? project.status === 'completed'
        : project.status !== 'completed' && project.status !== 'archived'
  ));

  useEffect(() => {
    if (selected && !visibleProjects.some((project) => project.id === selected.id)) setSelectedId('');
  }, [selected, visibleProjects]);

  const createProject = () => {
    const name = window.prompt('Project name');
    if (!name?.trim()) return;

    const project = {
      id: makeId('project'),
      name: name.trim(),
      status: 'active',
      image: '',
      activeSteps: [],
      notes: '',
      noteImages: [],
      checklist: state.template.checklist.map((text) => ({ id: makeId('check'), text, completedAt: '' })),
      nextSteps: [],
      partIds: [],
      files: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    updateState((current) => ({ ...current, projects: [project, ...current.projects] }));
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
        onDuplicate={() => duplicateProject(selected)}
        onDelete={() => deleteProject(selected.id)}
      />
    );
  }

  return (
    <div>
      <Header
        title={showingArchived ? 'Archived Projects' : showingCompleted ? 'Completed Projects' : 'Projects'}
        subtitle={showingArchived ? 'Paused reference projects kept out of the active workspace.' : showingCompleted ? 'Finished builds and reference projects.' : 'Pick a project to open its overview, parts, and files.'}
      >
        {!showingCompleted && !showingArchived && (
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
        )}
        {!showingCompleted && !showingArchived && <button onClick={createProject}>New Project</button>}
      </Header>
      {importError && <section className="panel error-text">{importError}</section>}

      {visibleProjects.length === 0 ? (
        <section className="panel empty-panel">
          {showingArchived ? 'No archived projects yet.' : showingCompleted ? 'No completed projects yet.' : 'No open projects yet.'}
        </section>
      ) : (
        <div className="project-grid">
          {visibleProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              template={state.template}
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
    </div>
  );
}

function ProjectCard({ project, template, onOpen }) {
  const totalTasks = project.checklist.length;
  const doneTasks = project.checklist.filter((item) => item.completedAt).length;
  const progress = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const latestFiles = project.files.filter((file) => file.latest);

  return (
    <button className="project-card" onClick={onOpen}>
      <div className="project-card-image">
        {project.image ? <StoredImage path={project.image} alt="" /> : <div>Project</div>}
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
        {latestFiles.slice(0, 2).map((file) => (
          <small key={file.id}>{fileTrackerLabel(template.fileTrackers, file.trackerId)}: {file.name}</small>
        ))}
        {totalTasks > 0 && <div className="progress-bar"><div style={{ width: `${progress}%` }} /></div>}
      </div>
    </button>
  );
}

function ProjectWorkspace({ state, project, parts, template, categories, onBack, onUpdate, onDuplicate, onDelete }) {
  const [projectTab, setProjectTab] = useState('overview');
  const [imageBusy, setImageBusy] = useState(false);
  const [imagePreview, setImagePreview] = useState('');
  const [exportNotice, setExportNotice] = useState('');
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

  const exportProject = async () => {
    const bytes = await buildProjectPackage(state, project);
    downloadBytes(`${safeName(project.name)}.buildbook.zip`, bytes, 'application/zip');
    setExportNotice('Project exported.');
    window.clearTimeout(window.__buildBookExportNotice);
    window.__buildBookExportNotice = window.setTimeout(() => setExportNotice(''), 2600);
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
          <button onClick={exportProject}>Export Project</button>
          <button className="danger-fill" onClick={onDelete}>Delete</button>
        </div>
      </section>
      {exportNotice && <p className="export-notice">{exportNotice}</p>}
      <div className="tabs">
        <button className={`tab ${projectTab === 'overview' ? 'active' : ''}`} onClick={() => setProjectTab('overview')}>Project Overview</button>
        <button className={`tab ${projectTab === 'parts' ? 'active' : ''}`} onClick={() => setProjectTab('parts')}>Parts ({linkedParts.length})</button>
        <button className={`tab ${projectTab === 'files' ? 'active' : ''}`} onClick={() => setProjectTab('files')}>Files ({project.files.length})</button>
      </div>
      {projectTab === 'overview' && <ProjectOverviewTab project={project} template={template} onUpdate={onUpdate} />}
      {projectTab === 'parts' && <ProjectPartsTab project={project} parts={parts} categories={categories} template={template} onUpdate={onUpdate} />}
      {projectTab === 'files' && <ProjectFilesTab project={project} template={template} onUpdate={onUpdate} />}
    </div>
  );
}

function ProjectOverviewTab({ project, template, onUpdate }) {
  const [newChecklist, setNewChecklist] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [recentlyCompleted, setRecentlyCompleted] = useState([]);
  const [noteImageBusy, setNoteImageBusy] = useState(false);
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

  const toggleStep = (step) => {
    const activeSteps = project.activeSteps.includes(step)
      ? project.activeSteps.filter((item) => item !== step)
      : [...project.activeSteps, step];
    onUpdate({ activeSteps });
  };

  const addNoteImage = async (file) => {
    if (!file) return;
    setNoteImageBusy(true);
    try {
      const stored = await savePickedFile(file, `project-note-images/${project.id}`);
      onUpdate({
        noteImages: [
          ...(project.noteImages || []),
          { id: makeId('note-img'), name: stored.name, path: stored.path, width: 60, markup: '', createdAt: new Date().toISOString() },
        ],
      });
    } finally {
      setNoteImageBusy(false);
    }
  };

  const updateNoteImage = (imageId, patch) => {
    onUpdate({ noteImages: (project.noteImages || []).map((image) => image.id === imageId ? { ...image, ...patch } : image) });
  };

  return (
    <div className="dashboard-grid">
      <article className="notes-card">
        <div className="section-title">
          <h3>Project Notes</h3>
          <label className="file-picker image-note-picker">
            <input
              type="file"
              accept="image/*"
              onChange={(event) => {
                addNoteImage(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            {noteImageBusy ? 'Adding...' : 'Add Image'}
          </label>
        </div>
        <textarea value={project.notes} onChange={(event) => onUpdate({ notes: event.target.value })} placeholder="Main project notes..." />
        {(project.noteImages || []).length > 0 && (
          <div className="note-image-grid">
            {(project.noteImages || []).map((image) => (
              <div key={image.id} className="note-image-card">
                <StoredImage path={image.path} alt="" style={{ width: `${image.width || 60}%` }} />
                <div className="note-image-controls">
                  <label>
                    Size
                    <input type="range" min="25" max="100" value={image.width || 60} onChange={(event) => updateNoteImage(image.id, { width: Number(event.target.value) })} />
                  </label>
                  <input value={image.markup || ''} onChange={(event) => updateNoteImage(image.id, { markup: event.target.value })} placeholder="Markup / callout note" />
                  <button className="ghost" onClick={() => onUpdate({ noteImages: (project.noteImages || []).filter((item) => item.id !== image.id) })}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </article>
      <div className="overview-side">
        <article>
          <h3>Project Tags</h3>
          <div className="step-tags quick-tag-grid">
            {template.steps.map((step) => (
              <button key={step} className={project.activeSteps.includes(step) ? 'tag active' : 'tag'} onClick={() => toggleStep(step)}>
                {step}
              </button>
            ))}
          </div>
          {!project.activeSteps.length && <p>No quick tags selected yet.</p>}
        </article>

        <article>
          <h3>Checklist</h3>
          <div className="inline-entry">
            <input value={newChecklist} onChange={(event) => setNewChecklist(event.target.value)} placeholder="Add checklist item" />
            <button onClick={addChecklistItem}>Add</button>
          </div>
          <button className="secondary narrow" onClick={() => setShowCompleted((value) => !value)}>
            {showCompleted ? 'Hide Completed' : 'Show Completed'}
          </button>
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
          {latestFiles.length ? latestFiles.map((file, index) => (
            <div key={file.id} className={`latest latest-${index % 5}`}>
              <strong>{fileTrackerLabel(template.fileTrackers, file.trackerId)}</strong>
              <span>{file.name}</span>
              {file.path && <button className="ghost" onClick={() => openStoredFile(file.path)}>Open</button>}
            </div>
          )) : <p>No latest files attached.</p>}
        </article>
      </div>
    </div>
  );
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
const TEXT_EXTENSIONS = ['.txt', '.md', '.json', '.ino', '.cpp', '.c', '.h', '.hpp', '.py', '.js', '.ts', '.tsx', '.jsx', '.html', '.css'];
const MODEL_TRIANGLE_LIMIT = 50000;
const EXTERNAL_VIEWER_MESSAGES = {
  '.dwg': 'DWG preview is not available inline. Open this file in a CAD app.',
  '.step': 'STEP preview is not available inline yet. Open this file in your 3D/CAD app.',
  '.stp': 'STEP preview is not available inline yet. Open this file in your 3D/CAD app.',
  '.xlsx': 'Excel preview is not available inline yet. Open this spreadsheet in Excel or export it as CSV for preview.',
  '.xls': 'Excel preview is not available inline yet. Open this spreadsheet in Excel or export it as CSV for preview.',
};

function fileExtension(fileName = '') {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : '';
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

function imageMimeType(path = '') {
  const extension = fileExtension(path);
  if (extension === '.png') return 'image/png';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.svg') return 'image/svg+xml';
  if (extension === '.bmp') return 'image/bmp';
  return 'image/jpeg';
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
  return <img src={src} alt={alt} className={className} style={style} />;
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
  return <iframe className={className} title={title} src={src} />;
}

function TextFilePreview({ file }) {
  const [content, setContent] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setContent('');
    setError('');

    readStoredFile(file.path)
      .then((bytes) => new TextDecoder().decode(bytes))
      .then((text) => {
        if (active) setContent(text.slice(0, 20000));
      })
      .catch(() => {
        if (active) setError('Preview is not available for this file yet.');
      });

    return () => {
      active = false;
    };
  }, [file.path]);

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
    let active = true;
    readStoredFile(file.path)
      .then((bytes) => new TextDecoder().decode(bytes))
      .then((text) => {
        if (active) setRows(parseCsv(text).slice(0, 40).map((row) => row.slice(0, 12)));
      })
      .catch(() => {
        if (active) setRows([]);
      });
    return () => {
      active = false;
    };
  }, [file.path]);

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
    let active = true;
    setError('');
    setReady(false);

    readStoredFile(file.path)
      .then((bytes) => {
        if (!active) return;
        const triangles = limitTriangles(parseStl(bytes), MODEL_TRIANGLE_LIMIT);
        if (!triangles.length) {
          setError('No previewable STL geometry was found.');
          return;
        }
        trianglesRef.current = triangles;
        viewRef.current = { rotationX: -0.55, rotationY: 0.65, zoom: 1 };
        setReady(true);
        requestAnimationFrame(redraw);
      })
      .catch(() => {
        if (active) setError('Could not preview this STL.');
      });

    return () => {
      active = false;
      trianglesRef.current = [];
    };
  }, [file.path]);

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
    let active = true;
    setError('');

    readStoredFile(file.path)
      .then((bytes) => new TextDecoder().decode(bytes))
      .then((text) => {
        if (!active) return;
        const triangles = limitTriangles(parseObj(text), MODEL_TRIANGLE_LIMIT);
        if (!triangles.length) {
          setError('No previewable OBJ geometry was found.');
          return;
        }
        drawStl(canvasRef.current, triangles);
      })
      .catch(() => {
        if (active) setError('Could not preview this OBJ.');
      });

    return () => {
      active = false;
    };
  }, [file.path]);

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
    let active = true;
    setError('');

    readStoredFile(file.path)
      .then((bytes) => new TextDecoder().decode(bytes))
      .then((text) => {
        if (!active) return;
        const shapes = parseDxf(text);
        if (!shapes.length) {
          setError('No previewable DXF geometry was found.');
          return;
        }
        drawDxf(canvasRef.current, shapes);
      })
      .catch(() => {
        if (active) setError('Could not preview this DXF.');
      });

    return () => {
      active = false;
    };
  }, [file.path]);

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
  context.fillStyle = '#f7f5ef';
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
    context.fillStyle = '#1d6f63';
    context.fill();
    context.strokeStyle = 'rgba(36,48,47,0.18)';
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
  context.fillStyle = '#f7f5ef';
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

  context.strokeStyle = '#1d6f63';
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

  if (extension === '.stl') {
    return <StlPreview file={file} />;
  }

  if (extension === '.obj') {
    return <ObjPreview file={file} />;
  }

  if (extension === '.dxf') {
    return <DxfPreview file={file} />;
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

function PartInfoModal({ part, categories, onClose, onUnlink }) {
  const pdf = part.documents.find((doc) => doc.name.toLowerCase().endsWith('.pdf') && doc.path);

  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal detail-modal">
        <div className="section-title">
          <h2>{part.name}</h2>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
        <div className="part-info-layout">
          <div>
            <div className="part-image detail-image">{part.image ? <StoredImage path={part.image} alt="" /> : part.name.slice(0, 2).toUpperCase()}</div>
            <p><strong>Category:</strong> {categoryLabel(categories, part.categoryId)}</p>
            <p><strong>Storage:</strong> {part.storageLocation || 'No location set'}</p>
            {part.productUrl && (
              <p>
                <strong>Product URL:</strong> {part.productUrl}
                <button className="ghost inline-button" onClick={() => openExternalUrl(part.productUrl)}>Open</button>
              </p>
            )}
            <h3>Spec Summary</h3>
            <p>{part.specSummary || 'No spec summary yet.'}</p>
            <h3>Notes</h3>
            <p>{part.notes || 'No notes yet.'}</p>
          </div>
          <div>
            <h3>Documents</h3>
            {part.documents.length ? part.documents.map((doc) => (
              <div key={doc.id} className="list-line">
                <span>{doc.name}</span>
                {doc.path && <button className="ghost" onClick={() => openStoredFile(doc.path)}>Open</button>}
              </div>
            )) : <p>No documents attached.</p>}
            <div className="preview-box">
              <h3>PDF Preview</h3>
              {pdf ? <PdfPreview path={pdf.path} title={pdf.name} className="pdf-preview" /> : <p>No PDF attached yet.</p>}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="secondary" onClick={() => onUnlink(part.id)}>Unlink Part</button>
          <button onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function ProjectPartsTab({ project, parts, categories, template, onUpdate }) {
  const [selectedPart, setSelectedPart] = useState(null);
  const [selectedFileId, setSelectedFileId] = useState('');
  const [partToLink, setPartToLink] = useState('');
  const linkedParts = project.partIds.map((id) => parts.find((part) => part.id === id)).filter(Boolean);
  const availableParts = parts.filter((part) => !project.partIds.includes(part.id));
  const latestFiles = project.files.filter((file) => file.latest);
  const selectedFile = latestFiles.find((file) => file.id === selectedFileId) || latestFiles[0];
  const selectedFileTracker = selectedFile ? template.fileTrackers.find((tracker) => tracker.id === selectedFile.trackerId) : null;

  useEffect(() => {
    if (!latestFiles.length) setSelectedFileId('');
    else if (!selectedFileId || !latestFiles.some((file) => file.id === selectedFileId)) setSelectedFileId(latestFiles[0].id);
  }, [latestFiles, selectedFileId]);

  const linkPart = () => {
    if (!partToLink) return;
    onUpdate({ partIds: [...project.partIds, partToLink] });
    setPartToLink('');
  };

  const unlinkPart = (partId) => {
    onUpdate({ partIds: project.partIds.filter((id) => id !== partId) });
    setSelectedPart((part) => part?.id === partId ? null : part);
  };

  return (
    <div className="parts-workspace">
      <div>
        <div className="section-toolbar">
          <select value={partToLink} onChange={(event) => setPartToLink(event.target.value)}>
            <option value="">Choose a part to link...</option>
            {availableParts.map((part) => <option key={part.id} value={part.id}>{part.name}</option>)}
          </select>
          <button onClick={linkPart} disabled={!partToLink}>Link Part</button>
        </div>
        {linkedParts.length === 0 ? <section className="panel empty-panel">No parts linked yet.</section> : (
          <div className="linked-part-grid">
            {linkedParts.map((part) => (
              <button key={part.id} className="linked-part-card" onClick={() => setSelectedPart(part)}>
                <div className="part-image">{part.image ? <StoredImage path={part.image} alt="" /> : part.name.slice(0, 2).toUpperCase()}</div>
                <strong>{part.name}</strong>
                <span>{categoryLabel(categories, part.categoryId)}</span>
                <small>{part.storageLocation || 'No location set'}</small>
              </button>
            ))}
          </div>
        )}
      </div>
      <section className="panel file-viewer-card">
        <div className="section-title">
          <h2>Latest File Viewer</h2>
          {selectedFile?.path && <button className="ghost" onClick={() => openStoredFile(selectedFile.path)}>Open</button>}
          {selectedFile?.path && selectedFileTracker?.programPath && <button className="ghost" onClick={() => openWithProgram(selectedFileTracker.programPath, selectedFile.path)}>Launch</button>}
        </div>
        {latestFiles.length ? (
          <>
            <select value={selectedFile?.id || ''} onChange={(event) => setSelectedFileId(event.target.value)}>
              {latestFiles.map((file) => (
                <option key={file.id} value={file.id}>
                  {fileTrackerLabel(template.fileTrackers, file.trackerId)} - {file.name}
                </option>
              ))}
            </select>
            {selectedFile && (
              <div className="file-viewer-meta">
                <strong>{fileTrackerLabel(template.fileTrackers, selectedFile.trackerId)}</strong>
                <span>{selectedFile.name}</span>
              </div>
            )}
            <FilePreview file={selectedFile} />
          </>
        ) : <p>No files are marked latest yet.</p>}
      </section>
      {selectedPart && (
        <PartInfoModal
          part={selectedPart}
          categories={categories}
          onClose={() => setSelectedPart(null)}
          onUnlink={unlinkPart}
        />
      )}
    </div>
  );
}

function ProjectFilesTab({ project, template, onUpdate }) {
  const [filePath, setFilePath] = useState('');
  const [fileTrackerId, setFileTrackerId] = useState(template.fileTrackers[0]?.id || '');
  const [fileStorageMode, setFileStorageMode] = useState('copy');
  const [fileError, setFileError] = useState('');
  const [fileBusy, setFileBusy] = useState(false);
  const [editSessions, setEditSessions] = useState({});

  const attachProjectFile = async (pickedFile = null) => {
    const tracker = template.fileTrackers.find((item) => item.id === fileTrackerId);
    const trimmedPath = filePath.trim();
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
      const resetFiles = project.files.map((file) => file.trackerId === tracker.id ? { ...file, latest: false } : file);
      onUpdate({
        files: [
          ...resetFiles,
          {
            id: makeId('file'),
            trackerId: tracker.id,
            name: stored.name,
            path: stored.path,
            sourcePath: pickedFile ? '' : trimmedPath,
            storageMode: pickedFile ? 'copy' : fileStorageMode,
            size: stored.size,
            contentHash,
            latest: true,
            notes: '',
            createdAt: new Date().toISOString(),
          },
        ],
      });
      if (!pickedFile) setFilePath('');
    } catch (error) {
      setFileError(String(error));
    } finally {
      setFileBusy(false);
    }
  };

  const toggleLatest = (fileId) => {
    const target = project.files.find((file) => file.id === fileId);
    if (!target) return;
    onUpdate({
      files: project.files.map((file) =>
        file.id === fileId
          ? { ...file, latest: !file.latest }
          : file.trackerId === target.trackerId && !target.latest
            ? { ...file, latest: false }
            : file,
      ),
    });
  };

  const removeFile = (fileId) => onUpdate({ files: project.files.filter((file) => file.id !== fileId) });
  const updateFile = (fileId, patch) => onUpdate({ files: project.files.map((file) => file.id === fileId ? { ...file, ...patch } : file) });
  const fileLibrary = (file) => `project-files/${project.id}/${file.trackerId}`;
  const beginEdit = async (file) => {
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

      const bytes = await readStoredFile(providedSession.path);
      const stored = await saveBytesFile(file.name, fileLibrary(file), bytes);
      const now = new Date().toISOString();
      const resetFiles = project.files.map((item) => item.trackerId === file.trackerId ? { ...item, latest: false } : item);
      onUpdate({
        files: [
          ...resetFiles,
          {
            ...file,
            id: makeId('file'),
            path: stored.path,
            sourcePath: providedSession.sourcePath || file.sourcePath || '',
            storageMode: 'copy',
            size: stored.size,
            contentHash: currentHash,
            latest: true,
            notes: file.notes ? `${file.notes}\nSaved new version ${new Date(now).toLocaleString()}` : `Saved new version ${new Date(now).toLocaleString()}`,
            createdAt: now,
          },
        ],
      });
      setEditSessions((current) => {
        const next = { ...current };
        delete next[file.id];
        return next;
      });
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

  return (
    <div>
      <section className="panel upload-card">
        <select value={fileTrackerId} onChange={(event) => setFileTrackerId(event.target.value)}>
          {template.fileTrackers.map((tracker) => (
            <option key={tracker.id} value={tracker.id}>
              {tracker.name}{tracker.extensions ? ` (${tracker.extensions})` : ''}
            </option>
          ))}
        </select>
        {fileStorageMode === 'copy' ? (
          <label className="file-picker compact-picker">
            <input
              type="file"
              accept={acceptFromExtensions(template.fileTrackers.find((tracker) => tracker.id === fileTrackerId)?.extensions || '')}
              onChange={(event) => {
                const pickedFile = event.target.files?.[0];
                if (pickedFile) attachProjectFile(pickedFile);
                event.target.value = '';
              }}
            />
            {fileBusy ? 'Saving...' : 'Choose File'}
          </label>
        ) : (
          <>
            <input value={filePath} onChange={(event) => setFilePath(event.target.value)} placeholder="Paste original file path to link" />
            <button onClick={() => attachProjectFile()} disabled={fileBusy}>{fileBusy ? 'Saving' : 'Attach'}</button>
          </>
        )}
        <div className="storage-options">
          <label>
            <input type="radio" name={`file-storage-${project.id}`} checked={fileStorageMode === 'copy'} onChange={() => setFileStorageMode('copy')} />
            Copy into BuildBook library
          </label>
          <label>
            <input type="radio" name={`file-storage-${project.id}`} checked={fileStorageMode === 'link'} onChange={() => setFileStorageMode('link')} />
            Link original path
          </label>
        </div>
        {fileError && <p className="error-text">{fileError}</p>}
      </section>

      {grouped.length === 0 ? <section className="panel empty-panel">No files attached yet.</section> : grouped.map(({ tracker, files }) => (
        <section key={tracker.id} className="panel file-group">
          <h3>{tracker.name}</h3>
          <div className="file-table">
            {files.map((file) => (
              <div key={file.id} className="file-row">
                <span>{file.latest ? 'Latest' : 'Older'}</span>
                <span>{file.storageMode === 'link' ? 'Linked' : 'Copied'}</span>
                <strong>{file.name}</strong>
                <span>{file.createdAt ? new Date(file.createdAt).toLocaleDateString() : ''}</span>
                {file.path && <button className="ghost" onClick={() => openStoredFile(file.path)}>Open</button>}
                {file.path && <button className="ghost" onClick={() => beginEdit(file)} disabled={fileBusy}>Edit</button>}
                {editSessions[file.id] && <button className="ghost" onClick={() => checkFileChanges(file)}>Check Changes</button>}
                {file.path && tracker.programPath && <button className="ghost" onClick={() => openWithProgram(tracker.programPath, file.path)}>Launch</button>}
                <button className="ghost" onClick={() => toggleLatest(file.id)}>{file.latest ? 'Unset Latest' : 'Mark Latest'}</button>
                <button className="ghost" onClick={() => removeFile(file.id)}>Delete</button>
                <input value={file.notes || ''} onChange={(event) => updateFile(file.id, { notes: event.target.value })} placeholder="File notes" />
              </div>
            ))}
          </div>
        </section>
      ))}
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

function CategoryTreeNode({ node, parts, categories, activeId, onSelect, depth = 0 }) {
  const [open, setOpen] = useState(false);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div className="category-tree-line" style={{ paddingLeft: `${depth * 14}px` }}>
        {hasChildren ? (
          <button className="tree-toggle" onClick={() => setOpen((value) => !value)}>{open ? '-' : '+'}</button>
        ) : <span className="tree-toggle-spacer" />}
        <button className={`category-row tree-row ${activeId === node.id ? 'active' : ''}`} onClick={() => onSelect(node.id)}>
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
  const orderedDrafts = flattenCategoryOptions(drafts);

  const updateCategory = (categoryId, patch) => {
    setDrafts((current) => current.map((category) => category.id === categoryId ? { ...category, ...patch } : category));
  };

  const addCategory = () => {
    if (!newCategory.name.trim()) return;
    setDrafts((current) => [
      ...current,
      {
        id: makeId('cat'),
        name: newCategory.name.trim(),
        parentId: newCategory.parentId || null,
        sortOrder: current.length,
      },
    ]);
    setNewCategory({ name: '', parentId: '' });
  };

  const deleteCategory = (categoryId) => {
    const blocked = new Set([categoryId, ...descendantCategoryIds(drafts, categoryId)]);
    setDrafts((current) => current.filter((category) => !blocked.has(category.id)));
  };

  const save = () => {
    onUpdate(drafts);
    onClose();
  };

  const exportTemplate = () => {
    downloadBytes('buildbook-categories.json', new TextEncoder().encode(JSON.stringify(drafts, null, 2)), 'application/json');
  };

  const importTemplate = async (file) => {
    if (!file) return;
    const imported = JSON.parse(await file.text());
    if (!Array.isArray(imported)) return;
    setDrafts(imported.map((category, index) => ({ id: category.id || makeId('cat'), name: category.name || 'Category', parentId: category.parentId || null, sortOrder: category.sortOrder ?? index })));
  };

  const dropCategory = (targetId) => {
    if (!dragId || dragId === targetId) return;
    setDrafts((current) => {
      const dragged = current.find((category) => category.id === dragId);
      const target = current.find((category) => category.id === targetId);
      if (!dragged || !target) return current;
      return current.map((category) => {
        if (category.id === dragged.id) return { ...category, parentId: target.parentId || null, sortOrder: target.sortOrder ?? 0 };
        if (category.id === target.id) return { ...category, sortOrder: dragged.sortOrder ?? 0 };
        return category;
      });
    });
    setDragId('');
  };

  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal category-manager-modal">
        <div className="section-title">
          <h2>Edit Categories</h2>
          <label className="file-picker header-picker">
            <input
              type="file"
              accept=".json"
              onChange={(event) => {
                importTemplate(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            Import
          </label>
          <button className="ghost" onClick={exportTemplate}>Export</button>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
        <section className="category-create-box">
          <input value={newCategory.name} onChange={(event) => setNewCategory((current) => ({ ...current, name: event.target.value }))} placeholder="New category name" />
          <select value={newCategory.parentId} onChange={(event) => setNewCategory((current) => ({ ...current, parentId: event.target.value }))}>
            <option value="">Root category</option>
            {orderedDrafts.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
          </select>
          <button onClick={addCategory}>Add</button>
        </section>
        <div className="category-manager-list">
          {orderedDrafts.map((category) => {
            const blocked = new Set([category.id, ...descendantCategoryIds(drafts, category.id)]);
            return (
              <div
                key={category.id}
                className={`category-edit-row depth-${Math.min(category.depth, 4)}`}
                draggable={category.id !== 'cat-unassigned'}
                onDragStart={() => setDragId(category.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => dropCategory(category.id)}
              >
                <input value={category.name} onChange={(event) => updateCategory(category.id, { name: event.target.value })} />
                <select value={category.parentId || ''} onChange={(event) => updateCategory(category.id, { parentId: event.target.value || null })}>
                  <option value="">Root category</option>
                  {orderedDrafts.filter((option) => !blocked.has(option.id)).map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
                <button className="ghost" disabled={category.id === 'cat-unassigned'} onClick={() => deleteCategory(category.id)}>Delete</button>
              </div>
            );
          })}
        </div>
        <div className="modal-footer">
          <button className="secondary" onClick={onClose}>Cancel</button>
          <button onClick={save}>Save Categories</button>
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

  const createPart = () => {
    const name = window.prompt('Part name');
    if (!name?.trim()) return;
    const part = {
      id: makeId('part'),
      name: name.trim(),
      categoryId: 'cat-unassigned',
      image: '',
      productUrl: '',
      storageLocation: '',
      specSummary: '',
      notes: '',
      documents: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    updateState((current) => ({ ...current, parts: [part, ...current.parts] }));
    setSelectedId(part.id);
  };

  const updatePart = (partId, patch) => {
    updateState((current) => ({
      ...current,
      parts: current.parts.map((part) =>
        part.id === partId ? { ...part, ...patch, updatedAt: new Date().toISOString() } : part,
      ),
    }));
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

  return (
    <div>
      <Header title="Parts Library" subtitle="Reference parts, storage locations, specs, datasheets, and product links.">
        <button className="secondary" onClick={() => setEditingCategories(true)}>Edit Categories</button>
        <button onClick={createPart}>New Part</button>
      </Header>
      <div className="filters">
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
        {(query || categoryFilter || showUnassigned) && (
          <button className="secondary" onClick={() => { setQuery(''); setCategoryFilter(''); setShowUnassigned(false); }}>Clear</button>
        )}
      </div>
      {visible.length === 0 ? <div className="panel empty-panel">No parts found.</div> : (
        <div className="item-grid">
          {visible.map((part) => (
            <button key={part.id} className="part-card" onClick={() => setSelectedId(part.id)}>
              <div className="part-card-image">{part.image ? <StoredImage path={part.image} alt="" /> : <div>Part</div>}</div>
              <div className="part-card-body">
                <span>{categoryLabel(state.categories, part.categoryId)}</span>
                <strong>{part.name}</strong>
                <p>{part.storageLocation || 'No location set'}</p>
                <div className="mini-meta">
                  <span>{part.documents.length} docs</span>
                  {part.productUrl && <span>Product link</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      {selected && (
        <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && setSelectedId('')}>
          <div className="modal part-library-modal">
            <PartEditor
              part={selected}
              categories={state.categories}
              onClose={() => setSelectedId('')}
              onUpdate={(patch) => updatePart(selected.id, patch)}
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
      {editingCategories && (
        <CategoryManager
          categories={state.categories}
          onClose={() => setEditingCategories(false)}
          onUpdate={(categories) => updateState((current) => ({
            ...current,
            categories,
            parts: current.parts.map((part) => categories.some((category) => category.id === part.categoryId) ? part : { ...part, categoryId: 'cat-unassigned' }),
          }))}
        />
      )}
    </div>
  );
}

function PartEditor({ part, categories, onUpdate, onCreateCategory, onDuplicate, onDelete, onClose }) {
  const [documentPath, setDocumentPath] = useState('');
  const [documentStorageMode, setDocumentStorageMode] = useState('copy');
  const [documentError, setDocumentError] = useState('');
  const [documentBusy, setDocumentBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [newCategory, setNewCategory] = useState({ name: '', parentId: '' });
  const [pdfExpanded, setPdfExpanded] = useState(false);
  const pdf = part.documents.find((doc) => doc.name.toLowerCase().endsWith('.pdf'));

  const attachDocument = async (pickedFile = null) => {
    const trimmedPath = documentPath.trim();
    if (!trimmedPath && !pickedFile) return;
    setDocumentBusy(true);
    setDocumentError('');
    try {
      const stored = pickedFile
        ? await savePickedFile(pickedFile, `part-documents/${part.id}`)
        : linkedLocalFile(trimmedPath);
      onUpdate({
        documents: [
          ...part.documents,
          {
            id: makeId('doc'),
            name: stored.name,
            path: stored.path,
            sourcePath: pickedFile ? '' : trimmedPath,
            storageMode: pickedFile ? 'copy' : documentStorageMode,
            size: stored.size,
            type: stored.name.toLowerCase().endsWith('.pdf') ? 'datasheet' : 'document',
            createdAt: new Date().toISOString(),
          },
        ],
      });
      if (!pickedFile) setDocumentPath('');
    } catch (error) {
      setDocumentError(String(error));
    } finally {
      setDocumentBusy(false);
    }
  };

  const updateImage = async (file) => {
    if (!file) return;
    setImageBusy(true);
    try {
      const stored = await savePickedFile(file, `part-images/${part.id}`);
      onUpdate({ image: stored.path });
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
            <div className="part-image detail-image">{part.image ? <StoredImage path={part.image} alt="" /> : part.name.slice(0, 2).toUpperCase()}</div>
            <label className="file-picker wide-picker">
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
        </div>
        <div className="part-editor-side">
          <div className="preview-box">
            <h3>PDF Preview</h3>
            {pdf ? (
              <>
                <div className="list-line">
                  <span>{pdf.name}</span>
                  <button className="ghost" onClick={() => openStoredFile(pdf.path)}>Open PDF</button>
                </div>
                {pdf.path && (
                  <button className="pdf-preview-toggle" onClick={() => setPdfExpanded(true)}>
                    <PdfPreview path={pdf.path} title={pdf.name} className="pdf-preview compact" />
                    <span>Click preview to expand</span>
                  </button>
                )}
              </>
            ) : <p>No PDF attached yet.</p>}
          </div>
          <div>
            <h3>Documents</h3>
            <div className="attach-form vertical">
              <div className="storage-options">
                <label><input type="radio" name={`document-storage-${part.id}`} checked={documentStorageMode === 'copy'} onChange={() => setDocumentStorageMode('copy')} />Copy into BuildBook library</label>
                <label><input type="radio" name={`document-storage-${part.id}`} checked={documentStorageMode === 'link'} onChange={() => setDocumentStorageMode('link')} />Link original path</label>
              </div>
              {documentStorageMode === 'copy' ? (
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
              ) : (
                <>
                  <input value={documentPath} onChange={(event) => setDocumentPath(event.target.value)} placeholder="Paste original file path to link" />
                  <button onClick={() => attachDocument()} disabled={documentBusy}>{documentBusy ? 'Saving' : 'Attach Document'}</button>
                </>
              )}
            </div>
            {documentError && <p className="error-text">{documentError}</p>}
            {part.documents.map((doc) => (
              <div key={doc.id} className="list-line">
                <span>{doc.name} - {doc.storageMode === 'link' ? 'Linked' : 'Copied'}</span>
                <div className="row-actions">
                  {doc.path && <button className="ghost" onClick={() => openStoredFile(doc.path)}>Open</button>}
                  <button className="ghost" onClick={() => onUpdate({ documents: part.documents.filter((item) => item.id !== doc.id) })}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {pdfExpanded && pdf?.path && (
        <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && setPdfExpanded(false)}>
          <div className="modal pdf-reader-modal">
            <div className="section-title">
              <h2>{pdf.name}</h2>
              <button className="ghost" onClick={() => setPdfExpanded(false)}>Close</button>
            </div>
            <PdfPreview path={pdf.path} title={pdf.name} className="pdf-preview expanded" />
          </div>
        </div>
      )}
    </section>
  );
}

function Imports({ state, updateState }) {
  const [importError, setImportError] = useState('');
  const [imageBusy, setImageBusy] = useState('');

  const createBatch = async (file) => {
    if (!file) return;
    setImportError('');
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
    } catch (error) {
      setImportError(String(error));
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
  };

  const categoryOptions = flattenCategoryOptions(state.categories);
  const sortedItems = (items) => [...items].sort((a, b) => {
    const rank = { none: 0, recommended: 1, exact: 2 };
    return (rank[a.matchQuality] ?? 0) - (rank[b.matchQuality] ?? 0) || a.name.localeCompare(b.name);
  });

  return (
    <div>
      <Header title="Imports" subtitle="Supplier invoices and CSV drafts become reviewed reference parts, never stock counts.">
        <label className="file-picker header-picker">
          <input
            type="file"
            accept=".csv,.txt,.pdf"
            onChange={(event) => {
              createBatch(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          Import File
        </label>
      </Header>
      {importError && <section className="panel error-text">{importError}</section>}
      {state.importBatches.length === 0 ? <section className="panel empty-panel">No import batches yet.</section> : state.importBatches.map((batch) => (
        <section key={batch.id} className="panel import-batch">
          <div className="section-title">
            <h2>{batch.name}</h2>
            <span>{batch.source} - {new Date(batch.createdAt).toLocaleDateString()}</span>
          </div>
          <div className="import-review-list">
            {sortedItems(batch.items).map((item) => (
              <div key={item.id} className={`import-part-row match-${item.matchQuality}`}>
                <label>
                  Category
                  <select value={item.categoryId || 'cat-unassigned'} onChange={(event) => updateItem(batch.id, item.id, { categoryId: event.target.value })}>
                    {categoryOptions.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
                  </select>
                </label>
                <div className="import-part-summary">
                  {(item.imagePath || item.imageUrl) && (
                    <div className="import-image-preview">
                      {item.imagePath ? <StoredImage path={item.imagePath} alt="" /> : <img src={item.imageUrl} alt="" />}
                    </div>
                  )}
                  <input value={item.name} onChange={(event) => updateItem(batch.id, item.id, { name: event.target.value })} disabled={item.status !== 'draft'} />
                  <span>{item.matchQuality === 'none' ? 'No suggestion' : item.matchQuality === 'exact' ? 'Exact match' : 'Recommended match'}</span>
                  {item.productUrl && <small>{item.productUrl}</small>}
                  {item.imageUrl && <small>{item.imagePath ? 'Image saved locally' : item.imageUrl}</small>}
                </div>
                <div className="import-action-grid">
                  <select value={item.action} disabled={item.status !== 'draft'} onChange={(event) => updateItem(batch.id, item.id, { action: event.target.value })}>
                    <option value="create">Create new part</option>
                    <option value="merge">Merge into existing</option>
                    <option value="skip">Skip</option>
                  </select>
                  {item.action === 'merge' && (
                    <select value={item.matchId || ''} disabled={item.status !== 'draft'} onChange={(event) => updateItem(batch.id, item.id, { matchId: event.target.value })}>
                      <option value="">Choose part...</option>
                      {state.parts.map((part) => <option key={part.id} value={part.id}>{part.name}</option>)}
                    </select>
                  )}
                  {item.status === 'draft' ? (
                    <>
                      {item.imageUrl && !item.imagePath && <button className="ghost" disabled={imageBusy === item.id} onClick={() => fetchItemImage(batch.id, item)}>{imageBusy === item.id ? 'Fetching...' : 'Fetch Image'}</button>}
                      <button onClick={() => completeItem(batch.id, item, item.action)}>Apply</button>
                      <button className="ghost" onClick={() => completeItem(batch.id, item, 'skip')}>Skip</button>
                    </>
                  ) : <span className="status-badge">{item.status}</span>}
                </div>
              </div>
            ))}
          </div>
      </section>
      ))}
    </div>
  );
}

function Settings({ state, updateState }) {
  const [newStep, setNewStep] = useState('');
  const [newChecklist, setNewChecklist] = useState('');
  const [showTemplatePreview, setShowTemplatePreview] = useState(false);
  const [restoreError, setRestoreError] = useState('');

  const updateTemplate = (patch) => {
    updateState((current) => ({ ...current, template: { ...current.template, ...patch } }));
  };

  const addTracker = () => {
    updateTemplate({
      fileTrackers: [
        ...state.template.fileTrackers,
        { id: makeId('tracker'), name: 'New Tracker', extensions: '', viewer: 'file', programPath: '' },
      ],
    });
  };

  const exportBackup = () => {
    downloadBytes(`buildbook-backup-v${APP_VERSION}.json`, new TextEncoder().encode(JSON.stringify(state, null, 2)), 'application/json');
  };

  const restoreBackup = async (file) => {
    if (!file) return;
    setRestoreError('');
    try {
      const restored = normalizeState(JSON.parse(await file.text()));
      updateState(() => restored);
    } catch (error) {
      setRestoreError(String(error));
    }
  };

  return (
    <div>
      <Header title="Settings" subtitle="Project template, tracked file types, backup, and launch handlers.">
        <button className="secondary" onClick={() => setShowTemplatePreview(true)}>Project Template</button>
      </Header>
      <div className="settings-grid">
        <section className="panel wide readme-panel">
          <h2>BuildBook v{APP_VERSION}</h2>
          <p>Use Projects for build notes, linked parts, latest files, and exportable project packages. Use Parts Library as a searchable reference shelf for datasheets, product links, and storage locations.</p>
          <div className="header-actions">
            <button className="secondary" onClick={exportBackup}>Export Backup</button>
            <label className="file-picker header-picker">
              <input
                type="file"
                accept=".json"
                onChange={(event) => {
                  restoreBackup(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              Restore Backup
            </label>
          </div>
          {restoreError && <p className="error-text">{restoreError}</p>}
        </section>

        <section className="panel">
          <h2>Project Step Buttons</h2>
          <div className="inline-entry">
            <input value={newStep} onChange={(event) => setNewStep(event.target.value)} placeholder="New step button" />
            <button onClick={() => {
              if (!newStep.trim()) return;
              updateTemplate({ steps: [...state.template.steps, newStep.trim()] });
              setNewStep('');
            }}>Add</button>
          </div>
          {state.template.steps.map((step) => (
            <div key={step} className="list-line">
              <span>{step}</span>
              <button className="ghost" onClick={() => updateTemplate({ steps: state.template.steps.filter((item) => item !== step) })}>Delete</button>
            </div>
          ))}
        </section>

        <section className="panel">
          <h2>Default Checklist</h2>
          <div className="inline-entry">
            <input value={newChecklist} onChange={(event) => setNewChecklist(event.target.value)} placeholder="Default checklist item" />
            <button onClick={() => {
              if (!newChecklist.trim()) return;
              updateTemplate({ checklist: [...state.template.checklist, newChecklist.trim()] });
              setNewChecklist('');
            }}>Add</button>
          </div>
          {state.template.checklist.map((item) => (
            <div key={item} className="list-line">
              <span>{item}</span>
              <button className="ghost" onClick={() => updateTemplate({ checklist: state.template.checklist.filter((text) => text !== item) })}>Delete</button>
            </div>
          ))}
        </section>

        <section className="panel wide">
          <div className="section-title">
            <h2>Tracked File Types</h2>
            <button onClick={addTracker}>Add Tracker</button>
          </div>
          {state.template.fileTrackers.map((tracker) => (
            <div key={tracker.id} className="tracker-row">
              <input
                value={tracker.name}
                onChange={(event) => updateTemplate({
                  fileTrackers: state.template.fileTrackers.map((item) => item.id === tracker.id ? { ...item, name: event.target.value } : item),
                })}
              />
              <input
                value={tracker.extensions}
                onChange={(event) => updateTemplate({
                  fileTrackers: state.template.fileTrackers.map((item) => item.id === tracker.id ? { ...item, extensions: event.target.value } : item),
                })}
                placeholder=".pdf,.dxf"
              />
              <select
                value={tracker.viewer}
                onChange={(event) => updateTemplate({
                  fileTrackers: state.template.fileTrackers.map((item) => item.id === tracker.id ? { ...item, viewer: event.target.value } : item),
                })}
              >
                <option value="pdf">PDF</option>
                <option value="model">3D Model</option>
                <option value="cad">CAD</option>
                <option value="spreadsheet">Spreadsheet</option>
                <option value="text">Text</option>
                <option value="file">File</option>
              </select>
              <input
                value={tracker.programPath || ''}
                onChange={(event) => updateTemplate({
                  fileTrackers: state.template.fileTrackers.map((item) => item.id === tracker.id ? { ...item, programPath: event.target.value } : item),
                })}
                placeholder="Program path"
              />
              <button className="ghost" onClick={() => updateTemplate({ fileTrackers: state.template.fileTrackers.filter((item) => item.id !== tracker.id) })}>
                Delete
              </button>
            </div>
          ))}
        </section>
      </div>
      {showTemplatePreview && (
        <TemplatePreviewModal
          template={state.template}
          onClose={() => setShowTemplatePreview(false)}
          onUpdate={updateTemplate}
        />
      )}
    </div>
  );
}

function TemplatePreviewModal({ template, onClose, onUpdate }) {
  const [newStep, setNewStep] = useState('');
  const [newChecklist, setNewChecklist] = useState('');
  const [newTracker, setNewTracker] = useState({ name: '', extensions: '', viewer: 'file' });

  const addStep = () => {
    if (!newStep.trim()) return;
    onUpdate({ steps: [...template.steps, newStep.trim()] });
    setNewStep('');
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
        { id: makeId('tracker'), name: newTracker.name.trim(), extensions: newTracker.extensions.trim(), viewer: newTracker.viewer, programPath: '' },
      ],
    });
    setNewTracker({ name: '', extensions: '', viewer: 'file' });
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
              </div>
              <div className="step-tags template-tags">
                {template.steps.map((step) => (
                  <button key={step} className="tag active" onClick={() => onUpdate({ steps: template.steps.filter((item) => item !== step) })}>{step}</button>
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
                <select value={newTracker.viewer} onChange={(event) => setNewTracker((current) => ({ ...current, viewer: event.target.value }))}>
                  <option value="pdf">PDF</option>
                  <option value="model">3D Model</option>
                  <option value="cad">CAD</option>
                  <option value="spreadsheet">Spreadsheet</option>
                  <option value="text">Text</option>
                  <option value="file">File</option>
                </select>
                <button onClick={addTracker}>Add</button>
              </div>
              {template.fileTrackers.map((tracker) => (
                <div key={tracker.id} className="list-line">
                  <span>{tracker.name} {tracker.extensions ? `(${tracker.extensions})` : ''}</span>
                  <button className="ghost" onClick={() => onUpdate({ fileTrackers: template.fileTrackers.filter((item) => item.id !== tracker.id) })}>Delete</button>
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
