import { DEFAULT_REVISION_SETTINGS } from './data.js';

export function withLatestVersionNote(notes = '', date = new Date()) {
  const cleaned = String(notes || '').replace(/\n?Saved new version .+$/i, '').trimEnd();
  const marker = `Saved new version ${date.toLocaleString()}`;
  return cleaned ? `${cleaned}\n${marker}` : marker;
}

export function normalizeRevisionSettings(settings) {
  return {
    ...DEFAULT_REVISION_SETTINGS,
    ...(settings && typeof settings === 'object' ? settings : {}),
    maxRevisions: Math.max(1, Number(settings?.maxRevisions) || DEFAULT_REVISION_SETTINGS.maxRevisions),
    delayMinutes: Math.max(1, Number(settings?.delayMinutes) || DEFAULT_REVISION_SETTINGS.delayMinutes),
    saveAllRevisions: Boolean(settings?.saveAllRevisions),
    delayEnabled: Boolean(settings?.delayEnabled),
    trackLinkedFiles: Boolean(settings?.trackLinkedFiles),
    retentionMode: settings?.retentionMode === 'hybrid' ? 'hybrid' : 'last-n',
  };
}

export function projectRevisionSettings(project, globalSettings) {
  return normalizeRevisionSettings(project?.revisionSettingsOverride || globalSettings);
}

function retentionBucketKey(date) {
  const value = new Date(date || '');
  return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
}

function monthBucketKey(date) {
  const value = new Date(date || '');
  return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 7);
}

export function fileHistoryPaths(file) {
  const paths = [file?.path, file?.baselinePath];
  (file?.folderFiles || []).forEach((child) => {
    paths.push(child.path, child.baselinePath);
  });
  return paths.filter(Boolean);
}

export function pruneTrackedFiles(files, settings) {
  const normalized = normalizeRevisionSettings(settings);
  if (normalized.saveAllRevisions) return { files, deletedPaths: [] };
  const deletedPaths = [];
  const grouped = new Map();
  files.forEach((file) => {
    const key = file.trackedItemId || file.id;
    const list = grouped.get(key) || [];
    list.push(file);
    grouped.set(key, list);
  });

  const kept = [];
  for (const group of grouped.values()) {
    const latest = group.filter((file) => file.latest);
    const history = group
      .filter((file) => !file.latest)
      .sort((a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0));
    const keepIds = new Set(latest.map((file) => file.id));
    history.slice(0, normalized.maxRevisions).forEach((file) => keepIds.add(file.id));

    if (normalized.retentionMode === 'hybrid') {
      const now = Date.now();
      const dayKeep = new Map();
      const monthKeep = new Map();
      for (const file of history) {
        const stamp = Date.parse(file.createdAt || '');
        if (!stamp) continue;
        const ageDays = Math.floor((now - stamp) / 86400000);
        if (ageDays <= 6) {
          const dayKey = retentionBucketKey(file.createdAt);
          if (dayKey && !dayKeep.has(dayKey)) dayKeep.set(dayKey, file.id);
          continue;
        }
        const monthKey = monthBucketKey(file.createdAt);
        if (monthKey && !monthKeep.has(monthKey)) monthKeep.set(monthKey, file.id);
      }
      [...dayKeep.values(), ...monthKeep.values()].forEach((id) => keepIds.add(id));
    }

    group.forEach((file) => {
      if (keepIds.has(file.id)) kept.push(file);
      else deletedPaths.push(...fileHistoryPaths(file));
    });
  }

  return { files: kept, deletedPaths: [...new Set(deletedPaths)] };
}

export function projectTrackedStorageRows(project) {
  const groups = new Map();
  (project.files || []).forEach((file) => {
    const key = file.trackedItemId || file.id;
    const row = groups.get(key) || { key, name: file.name, size: 0, trackerId: file.trackerId };
    fileHistoryPaths(file).forEach((path) => {
      if (!path || row._seen?.has(path)) return;
      row._seen = row._seen || new Set();
      row._seen.add(path);
    });
    row.size += (file.size || 0) + (file.baselineSize || 0) + ((file.folderFiles || []).reduce((total, child) => total + (child.size || 0) + (child.baselineSize || 0), 0));
    groups.set(key, row);
  });
  return [...groups.values()].map(({ _seen, ...row }) => row).sort((a, b) => b.size - a.size);
}
