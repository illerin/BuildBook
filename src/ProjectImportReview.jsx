import React, { useMemo, useState } from 'react';
import { makeId } from './data';
import { saveBytesFile } from './desktop';
import { findMatchingTracker } from './compatibility';
import { restoreInlineNoteImages } from './compatibilityNotes';
import { projectNoteSheets } from './projectNotes';
import {
  findCategoryByPath,
  flattenCategoryOptions,
  nestedCategoryLabel,
  suggestCategoryId,
} from './categoryHelpers';

function findMatchingPart(parts, importedPart) {
  if (importedPart.productUrl) {
    const byUrl = parts.find((part) => part.productUrl && part.productUrl === importedPart.productUrl);
    if (byUrl) return byUrl;
  }
  return parts.find((part) => part.name.toLowerCase() === importedPart.name.toLowerCase());
}

export default function ProjectImportReview({ state, packageData, onCancel, onImport }) {
  const { manifest, entries } = packageData;
  const categoryOptions = flattenCategoryOptions(state.categories);
  const importedTrackers = manifest.fileTrackers || [];
  const filesByTracker = useMemo(() => {
    const grouped = new Map();
    for (const file of manifest.project?.files || []) {
      const list = grouped.get(file.trackerId) || [];
      list.push(file);
      grouped.set(file.trackerId, list);
    }
    return grouped;
  }, [manifest.project?.files]);
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
  const [trackerDecisions, setTrackerDecisions] = useState(() => Object.fromEntries(importedTrackers.map((tracker) => {
    const match = findMatchingTracker(state.template.fileTrackers, tracker);
    return [tracker.id, { action: match ? 'assign' : 'add', trackerId: match?.id || '' }];
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
      const addedTrackers = importedTrackers.filter((tracker) => (trackerDecisions[tracker.id]?.action || 'add') === 'add');
      const trackerIdMap = Object.fromEntries(importedTrackers.map((tracker) => {
        const decision = trackerDecisions[tracker.id] || { action: 'add', trackerId: '' };
        return [tracker.id, decision.action === 'assign' && decision.trackerId ? decision.trackerId : tracker.id];
      }));
      const projectImage = await savePackagedAsset(manifest.project.imagePackagePath, `${projectName}-image`, `project-images/${projectId}`);
      const importedNoteImages = [];
      const importedNoteSheets = await Promise.all(projectNoteSheets(manifest.project).map(async (sheet) => ({
        ...sheet,
        id: sheet.id || makeId('note-sheet'),
        content: await restoreInlineNoteImages(entries, sheet.content, projectId),
      })));

      for (const image of manifest.project.noteImages || []) {
        const path = await savePackagedAsset(image.packagePath, image.name, `project-note-images/${projectId}`);
        importedNoteImages.push({ ...image, id: makeId('note-img'), path, packagePath: '' });
      }

      const importedPhotoFolders = [];
      for (const folder of manifest.project.photoFolders || []) {
        const photos = [];
        for (const photo of folder.photos || []) {
          const path = await savePackagedAsset(photo.packagePath, photo.name, `project-photos/${projectId}/${folder.id}`);
          const markupPath = await savePackagedAsset(photo.markupPackagePath, `markup-${photo.name}`, `project-photos/${projectId}/markup`);
          const thumbnailPath = await savePackagedAsset(photo.thumbnailPackagePath, `thumb-${photo.name}.jpg`, `project-photos/${projectId}/thumbs`);
          const markupThumbnailPath = await savePackagedAsset(photo.markupThumbnailPackagePath, `markup-thumb-${photo.name}.jpg`, `project-photos/${projectId}/thumbs`);
          photos.push({
            ...photo,
            id: photo.id || makeId('photo'),
            path: path || '',
            markupPath: markupPath || '',
            thumbnailPath: thumbnailPath || '',
            markupThumbnailPath: markupThumbnailPath || '',
            packagePath: '',
            markupPackagePath: '',
            thumbnailPackagePath: '',
            markupThumbnailPackagePath: '',
          });
        }
        importedPhotoFolders.push({
          ...folder,
          id: folder.id || makeId('photo-folder'),
          photos,
        });
      }

      const importedFiles = [];
      for (const file of manifest.project.files || []) {
        const mappedTrackerId = trackerIdMap[file.trackerId] || file.trackerId;
        if (file.type === 'folder') {
          const folderFiles = [];
          for (const child of file.folderFiles || []) {
            const path = await savePackagedAsset(child.packagePath, child.name, `project-files/${projectId}/${mappedTrackerId}/${file.name}`);
            folderFiles.push({ ...child, path, packagePath: '' });
          }
          importedFiles.push({ ...file, id: makeId('file'), trackerId: mappedTrackerId, folderFiles, path: '', sourcePath: '', packagePath: '', latest: file.latest !== false, createdAt: file.createdAt || new Date().toISOString() });
          continue;
        }
        const path = await savePackagedAsset(file.packagePath, file.name, `project-files/${projectId}/${mappedTrackerId}`);
        importedFiles.push({ ...file, id: makeId('file'), trackerId: mappedTrackerId, path, sourcePath: '', packagePath: '', latest: file.latest !== false, createdAt: file.createdAt || new Date().toISOString() });
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
        noteSheets: importedNoteSheets,
        notes: importedNoteSheets[0]?.content || await restoreInlineNoteImages(entries, manifest.project.notes, projectId),
        photoFolders: importedPhotoFolders,
        instructions: manifest.project.instructions ? {
          ...manifest.project.instructions,
          intro: await restoreInlineNoteImages(entries, manifest.project.instructions.intro, projectId, `project-instructions/${projectId}/intro`),
          steps: await Promise.all((manifest.project.instructions.steps || []).map(async (step) => ({
            ...step,
            body: await restoreInlineNoteImages(entries, step.body, projectId, `project-instructions/${projectId}/steps`),
          }))),
        } : { intro: '', steps: [] },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      onImport({
        ...state,
        template: {
          ...state.template,
          fileTrackers: [...state.template.fileTrackers, ...addedTrackers],
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

  const unresolvedTrackerAssignments = Object.values(trackerDecisions).some((decision) => decision.action === 'assign' && !decision.trackerId);
  const newTrackerCount = importedTrackers.filter((tracker) => (trackerDecisions[tracker.id]?.action || 'add') === 'add').length;
  const trackerImportLabel = (tracker) => {
    if (tracker.extensions) return tracker.extensions;
    const names = [...new Set((filesByTracker.get(tracker.id) || []).map((file) => file.name).filter(Boolean))];
    return names.length ? names.slice(0, 2).join(', ') : 'No extension filter';
  };

  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onCancel()}>
      <div className="modal import-review-modal">
        <div className="section-title">
          <h2>Import Project Package</h2>
          <button className="ghost" onClick={onCancel}>Close</button>
        </div>
        <label>Project Name<input value={projectName} onChange={(event) => setProjectName(event.target.value)} /></label>
        {!!importedTrackers.length && (
          <section className="panel tracker-import-panel">
            <div className="section-title">
              <div>
                <h3>Tracked File Types</h3>
                <span>{newTrackerCount ? `${newTrackerCount} tracked file type${newTrackerCount === 1 ? '' : 's'} will be added unless reassigned.` : 'Imported tracked file types will reuse matching local trackers.'}</span>
              </div>
            </div>
            <div className="tracker-import-list">
              {importedTrackers.map((tracker) => {
                const decision = trackerDecisions[tracker.id] || { action: 'add', trackerId: '' };
                return (
                  <div key={tracker.id} className="tracker-import-row">
                    <div className="tracker-import-summary">
                      <strong>{tracker.name}</strong>
                      <span>{trackerImportLabel(tracker)}</span>
                    </div>
                    <div className="tracker-import-actions">
                      <select value={decision.action} onChange={(event) => setTrackerDecisions((current) => ({ ...current, [tracker.id]: { ...decision, action: event.target.value } }))}>
                        <option value="add">Add tracked file type</option>
                        <option value="assign">Assign to existing tracked file type</option>
                      </select>
                      {decision.action === 'assign' && (
                        <select value={decision.trackerId} onChange={(event) => setTrackerDecisions((current) => ({ ...current, [tracker.id]: { ...decision, trackerId: event.target.value } }))}>
                          <option value="">Choose tracked file type...</option>
                          {state.template.fileTrackers.map((trackerOption) => (
                            <option key={trackerOption.id} value={trackerOption.id}>
                              {trackerOption.name}{trackerOption.extensions ? ` (${trackerOption.extensions})` : ''}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
        <div className="import-review-list">
          {sortedParts.map((part) => {
            const exact = findCategoryByPath(state.categories, part.categoryPath || []);
            const decision = partActions[part.id] || { action: 'create', partId: '' };
            return (
              <section key={part.id} className={`import-part-row match-${exact ? 'exact' : categoryDecisions[part.id] === 'cat-unassigned' ? 'none' : 'recommended'}`}>
                <label>
                  Exported Category: {(part.categoryPath || ['Unassigned']).join(' / ')}
                  <select value={categoryDecisions[part.id] || 'cat-unassigned'} onChange={(event) => setCategoryDecisions((current) => ({ ...current, [part.id]: event.target.value }))}>
                    {categoryOptions.map((category) => <option key={category.id} value={category.id}>{nestedCategoryLabel(category)}</option>)}
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
          <button onClick={completeImport} disabled={busy || unresolvedTrackerAssignments}>{busy ? 'Importing...' : 'Import Project'}</button>
        </div>
      </div>
    </div>
  );
}
