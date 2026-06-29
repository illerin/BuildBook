import { APP_VERSION, normalizeState } from './data.js';
import { createZip, readZip, zipText } from './zip.js';
import { safeName } from './files.js';
import { fileHash } from './fileHash.js';
import { projectNoteSheets } from './projectNotes.js';
import {
  asArray,
  guessWebFileType,
  parseWebMetadataArray,
  webDate,
  webId,
  webTrackerId,
  webTrackerKey,
  webUploadName,
  webUploadPath,
} from './compatibility.js';
import { addFileEntry, imagePackageExtension, saveZipAsset } from './compatibilityAssets.js';
import { addWebUploadEntry, packageInlineNoteImages, restoreInlineNoteImages, restoreWebNoteImages, rewriteNotesForWeb } from './compatibilityNotes.js';

export async function buildFullBackupEntries(state) {
  const entries = [];
  const backupState = JSON.parse(JSON.stringify(state));

  for (const project of backupState.projects || []) {
    project.imagePackagePath = await addFileEntry(entries, project.image, `projects/${safeName(project.id)}/image/${safeName(project.name)}${await imagePackageExtension(project.image)}`);
    if (project.imagePackagePath) project.image = '';
    project.notes = await packageInlineNoteImages(entries, project.notes, project.id);
    project.noteSheets = await Promise.all(projectNoteSheets(project).map(async (sheet) => ({
      ...sheet,
      content: await packageInlineNoteImages(entries, sheet.content, project.id, `note-sheets/${safeName(sheet.id)}`),
    })));
    project.instructions = project.instructions ? {
      ...project.instructions,
      intro: await packageInlineNoteImages(entries, project.instructions.intro, project.id, 'instructions/intro-images'),
      steps: await Promise.all((project.instructions.steps || []).map(async (step) => ({
        ...step,
        body: await packageInlineNoteImages(entries, step.body, project.id, `instructions/steps/${safeName(step.id)}`),
      }))),
    } : project.instructions;

    project.noteImages = await Promise.all((project.noteImages || []).map(async (image) => {
      const packagePath = await addFileEntry(entries, image.path, `projects/${safeName(project.id)}/note-images/${safeName(image.name || image.id)}${await imagePackageExtension(image.path)}`);
      return packagePath ? { ...image, path: '', packagePath } : image;
    }));

    project.photoFolders = await Promise.all((project.photoFolders || []).map(async (folder) => ({
      ...folder,
      photos: await Promise.all((folder.photos || []).map(async (photo) => {
        const packagePath = await addFileEntry(entries, photo.path, `projects/${safeName(project.id)}/photos/${safeName(folder.id)}/${safeName(photo.id)}-${safeName(photo.name)}${await imagePackageExtension(photo.path)}`);
        const markupPackagePath = await addFileEntry(entries, photo.markupPath, `projects/${safeName(project.id)}/photos/${safeName(folder.id)}/markup-${safeName(photo.id)}-${safeName(photo.name)}${await imagePackageExtension(photo.markupPath)}`);
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
          const baselinePackagePath = await addFileEntry(entries, child.baselinePath, `projects/${safeName(project.id)}/files/${safeName(file.trackerId)}/${safeName(file.id)}/baseline/${safeName(child.relativePath || child.name)}`);
          return {
            ...child,
            path: packagePath ? '' : child.path,
            packagePath,
            baselinePath: baselinePackagePath ? '' : child.baselinePath,
            baselinePackagePath,
          };
        }));
        return { ...file, folderFiles, path: '', storageMode: file.storageMode || 'copy' };
      }
      const packagePath = await addFileEntry(entries, file.path, `projects/${safeName(project.id)}/files/${safeName(file.trackerId)}/${safeName(file.id)}-${safeName(file.name)}`);
      const baselinePackagePath = await addFileEntry(entries, file.baselinePath, `projects/${safeName(project.id)}/files/${safeName(file.trackerId)}/baseline/${safeName(file.id)}-${safeName(file.name)}`);
      return {
        ...file,
        path: packagePath ? '' : file.path,
        packagePath,
        baselinePath: baselinePackagePath ? '' : file.baselinePath,
        baselinePackagePath,
      };
    }));
  }

  for (const part of backupState.parts || []) {
    part.imagePackagePath = await addFileEntry(entries, part.image, `parts/${safeName(part.id)}/image/${safeName(part.name)}${await imagePackageExtension(part.image)}`);
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
      const packagePath = await addFileEntry(entries, item.imagePath, `imports/${safeName(batch.id)}/images/${safeName(item.id)}${await imagePackageExtension(item.imagePath)}`);
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

export async function buildFullBackupPackage(state) {
  return createZip(await buildFullBackupEntries(state));
}

export async function readFullBackupPackage(file) {
  const entries = await readZip(file);
  if (!entries.has('buildbook-backup.json') && entries.has('backup.json')) return readWebBackupPackage(entries);
  const manifest = JSON.parse(zipText(entries, 'buildbook-backup.json'));
  if (manifest.kind !== 'buildbook-full-backup') throw new Error('This is not a BuildBook full backup.');
  const restoredState = manifest.state;

  for (const project of restoredState.projects || []) {
    project.image = await saveZipAsset(entries, project.imagePackagePath, `${project.name}-image`, `project-images/${project.id}`) || project.image || '';
    delete project.imagePackagePath;
    project.notes = await restoreInlineNoteImages(entries, project.notes, project.id);
    project.noteSheets = await Promise.all(projectNoteSheets(project).map(async (sheet) => ({
      ...sheet,
      content: await restoreInlineNoteImages(entries, sheet.content, project.id),
    })));
    project.notes = project.noteSheets[0]?.content || project.notes || '';
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
          const fallbackPath = file.sourcePath && child.relativePath ? `${file.sourcePath.replace(/[\\/]+$/, '')}/${child.relativePath.replace(/\\/g, '/')}` : '';
          const path = fallbackPath
            ? await fileHash(fallbackPath).then(() => fallbackPath).catch(() => saveZipAsset(entries, child.packagePath, child.name, `project-files/${project.id}/${file.trackerId}/${file.name}`))
            : await saveZipAsset(entries, child.packagePath, child.name, `project-files/${project.id}/${file.trackerId}/${file.name}`);
          const baselinePath = await saveZipAsset(entries, child.baselinePackagePath, child.name, `project-files/${project.id}/${file.trackerId}/baseline/${file.name}`);
          const restoredChild = path ? { ...child, path } : child;
          restoredChild.baselinePath = baselinePath || restoredChild.baselinePath || '';
          delete restoredChild.packagePath;
          delete restoredChild.baselinePackagePath;
          return restoredChild;
        }));
        return { ...file, folderFiles, path: '', storageMode: file.storageMode === 'link' ? 'link' : 'copy' };
      }
      const path = file.storageMode === 'link' && file.sourcePath
        ? await fileHash(file.sourcePath).then(() => file.sourcePath).catch(() => saveZipAsset(entries, file.packagePath, file.name, `project-files/${project.id}/${file.trackerId}`))
        : await saveZipAsset(entries, file.packagePath, file.name, `project-files/${project.id}/${file.trackerId}`);
      const baselinePath = await saveZipAsset(entries, file.baselinePackagePath, file.name, `project-files/${project.id}/${file.trackerId}/baseline`);
      const restored = path ? { ...file, path, storageMode: file.storageMode === 'link' ? 'link' : 'copy' } : file;
      restored.baselinePath = baselinePath || restored.baselinePath || '';
      delete restored.packagePath;
      delete restored.baselinePackagePath;
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

  return normalizeState(restoredState, { preserveImportedCategories: true });
}

export async function readWebBackupPackage(entries) {
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
  }, { preserveImportedCategories: true });
}

export async function buildWebFullBackupPackage(state) {
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
    const imageName = part.image ? webUploadName('part', id, `${part.name}${await imagePackageExtension(part.image)}`) : null;
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
    const imageName = project.image ? webUploadName('project', id, `${project.name}${await imagePackageExtension(project.image)}`) : null;
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
