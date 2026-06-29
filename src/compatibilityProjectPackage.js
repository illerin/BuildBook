import { APP_VERSION, fileTrackerLabel } from './data.js';
import {
  buildBomCsv,
  buildGuideHtml,
  buildProjectReadme,
  categoryPath,
  guessWebFileType,
  partInfoText,
  webDate,
  webId,
  webTrackerId,
} from './compatibility.js';
import { addFileEntry, imagePackageExtension } from './compatibilityAssets.js';
import { packageInlineNoteImages } from './compatibilityNotes.js';
import { escapeHtml } from './richTextPolicy.js';
import { safeName } from './files.js';
import { projectNoteSheets } from './projectNotes.js';
import { createZip, readZip, zipText } from './zip.js';

export function webFileTrackersFromProjectManifest(manifest) {
  const explicitTrackers = Array.isArray(manifest.file_trackers) ? manifest.file_trackers : [];
  const byKey = new Map([
    ['datasheet', { id: webTrackerId('datasheet'), name: 'Datasheets', extensions: '.pdf', programPath: '' }],
    ['firmware', { id: webTrackerId('firmware'), name: 'Firmware', extensions: '.ino,.cpp,.h', programPath: '' }],
    ['drawing', { id: webTrackerId('drawing'), name: 'Drawings', extensions: '.dwg,.dxf', programPath: '' }],
    ['enclosure', { id: webTrackerId('enclosure'), name: 'Enclosure', extensions: '.stl,.step,.3mf', programPath: '' }],
    ['bom', { id: webTrackerId('bom'), name: 'PCB BOM', extensions: '.xlsx,.xls,.csv,.tsv', programPath: '' }],
    ['other', { id: webTrackerId('other'), name: 'Other', extensions: '', programPath: '' }],
  ]);
  for (const tracker of explicitTrackers) {
    const key = String(tracker.key || tracker.id || '').trim();
    if (!key) continue;
    byKey.set(key, {
      id: webTrackerId(key),
      name: tracker.label || tracker.name || key,
      extensions: tracker.extensions || '',
      programPath: '',
    });
  }
  for (const file of manifest.files || []) {
    const key = file.tracker_key || 'other';
    if (!byKey.has(key)) {
      const derivedName = String(file.file_category || '').split('-')[0]?.trim();
      byKey.set(key, {
        id: webTrackerId(key),
        name: derivedName && derivedName.toLowerCase() !== 'imported'
          ? derivedName
          : (file.original_filename ? file.original_filename.split('.').slice(0, -1).join('.') || key : key),
        extensions: '',
        programPath: '',
      });
    }
  }
  return [...byKey.values()];
}

export async function readWebProjectPackage(entries) {
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

  const photoFolders = (webManifest.photo_library || []).map((folder, folderIndex) => ({
    id: folder.id || webId('photo-folder', folderIndex + 1),
    name: folder.name || `Photos ${folderIndex + 1}`,
    photos: (folder.photos || []).map((photo, photoIndex) => ({
      id: photo.id || webId('photo', `${folderIndex + 1}-${photoIndex + 1}`),
      name: photo.name || `Photo ${photoIndex + 1}`,
      note: photo.note || '',
      createdAt: webDate(photo.createdAt || photo.created_at),
      path: '',
      markupPath: '',
      thumbnailPath: '',
      markupThumbnailPath: '',
      packagePath: photo.archive_path || '',
      markupPackagePath: photo.markup_archive_path || '',
      thumbnailPackagePath: photo.thumbnail_archive_path || '',
      markupThumbnailPackagePath: photo.markup_thumbnail_archive_path || '',
    })),
  }));

  const instructions = webManifest.instructions && typeof webManifest.instructions === 'object'
    ? {
        intro: webManifest.instructions.intro || '',
        steps: Array.isArray(webManifest.instructions.steps) ? webManifest.instructions.steps.map((step, index) => ({
          id: step.id || webId('instruction-step', index + 1),
          title: step.title || `Step ${index + 1}`,
          body: step.body || '',
          photoId: step.photoId || '',
        })) : [],
      }
    : { intro: '', steps: [] };

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
        photoFolders,
        instructions,
        createdAt: now,
        updatedAt: now,
      },
      parts,
    },
    entries,
  };
}

export async function readProjectPackage(file) {
  const entries = await readZip(file);
  if (!entries.has('buildbook-package.json') && entries.has('project-manifest.json')) return readWebProjectPackage(entries);
  const manifest = JSON.parse(zipText(entries, 'buildbook-package.json'));
  if (manifest.kind !== 'buildbook-project-package') throw new Error('This is not a BuildBook project package.');
  return { manifest, entries };
}

export async function buildProjectPackage(state, project) {
  const entries = [];
  const linkedParts = project.partIds.map((id) => state.parts.find((part) => part.id === id)).filter(Boolean);
  const exportedProject = {
    ...project,
    notes: await packageInlineNoteImages(entries, project.notes, project.id),
    noteSheets: await Promise.all(projectNoteSheets(project).map(async (sheet) => ({
      ...sheet,
      content: await packageInlineNoteImages(entries, sheet.content, project.id, `note-sheets/${safeName(sheet.id)}`),
    }))),
    instructions: project.instructions ? {
      ...project.instructions,
      intro: await packageInlineNoteImages(entries, project.instructions.intro, project.id, 'instructions/intro-images'),
      steps: await Promise.all((project.instructions.steps || []).map(async (step) => ({
        ...step,
        body: await packageInlineNoteImages(entries, step.body, project.id, `instructions/steps/${safeName(step.id)}`),
      }))),
    } : project.instructions,
    imagePackagePath: '',
    files: [],
    noteImages: [],
    photoFolders: [],
  };

  exportedProject.imagePackagePath = await addFileEntry(entries, project.image, `project/image/${safeName(project.name)}${await imagePackageExtension(project.image)}`);

  for (const image of project.noteImages || []) {
    const packagePath = await addFileEntry(entries, image.path, `project/note-images/${safeName(image.name)}`);
    exportedProject.noteImages.push({ ...image, path: '', packagePath });
  }

  for (const folder of project.photoFolders || []) {
    const exportedPhotos = [];
    for (const photo of folder.photos || []) {
      const packagePath = await addFileEntry(entries, photo.path, `project/photos/${safeName(folder.id)}/${safeName(photo.id)}-${safeName(photo.name)}${await imagePackageExtension(photo.path)}`);
      const markupPackagePath = await addFileEntry(entries, photo.markupPath, `project/photos/${safeName(folder.id)}/markup-${safeName(photo.id)}-${safeName(photo.name)}${await imagePackageExtension(photo.markupPath)}`);
      const thumbnailPackagePath = await addFileEntry(entries, photo.thumbnailPath, `project/photos/${safeName(folder.id)}/thumb-${safeName(photo.id)}.jpg`);
      const markupThumbnailPackagePath = await addFileEntry(entries, photo.markupThumbnailPath, `project/photos/${safeName(folder.id)}/markup-thumb-${safeName(photo.id)}.jpg`);
      exportedPhotos.push({
        ...photo,
        path: '',
        markupPath: '',
        thumbnailPath: '',
        markupThumbnailPath: '',
        packagePath,
        markupPackagePath,
        thumbnailPackagePath,
        markupThumbnailPackagePath,
      });
    }
    exportedProject.photoFolders.push({ ...folder, photos: exportedPhotos });
  }

  for (const file of project.files) {
    const fileRoot = file.latest ? 'project/latest-files' : 'project/older-files';
    if (file.type === 'folder') {
      const folderFiles = [];
      for (const child of file.folderFiles || []) {
        const sourcePath = file.storageMode === 'link' ? child.baselinePath || child.path : child.path;
        const packagePath = await addFileEntry(entries, sourcePath, `${fileRoot}/${safeName(fileTrackerLabel(state.template.fileTrackers, file.trackerId))}/${safeName(file.name)}/${safeName(child.relativePath || child.name)}`);
        folderFiles.push({ ...child, path: '', sourcePath: '', packagePath });
      }
      exportedProject.files.push({ ...file, path: '', sourcePath: '', folderFiles });
      continue;
    }
    const packagePath = await addFileEntry(entries, file.storageMode === 'link' ? file.baselinePath || file.path : file.path, `${fileRoot}/${safeName(fileTrackerLabel(state.template.fileTrackers, file.trackerId))}/${safeName(file.name)}`);
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
    exportedPart.imagePackagePath = await addFileEntry(entries, part.image, `parts/${safeName(part.name)}/image${await imagePackageExtension(part.image)}`);
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
  for (const sheet of projectNoteSheets(project)) {
    entries.push({ name: `project-note-sheets/${safeName(sheet.title)}.html`, data: sheet.content || '' });
  }
  entries.push({ name: 'README.md', data: buildProjectReadme(project, linkedParts, state.categories, state.template.fileTrackers) });
  entries.push({ name: 'build-guide.html', data: buildGuideHtml(project, linkedParts, state.categories, state.template.fileTrackers) });
  entries.push({ name: 'parts-bom.csv', data: buildBomCsv(linkedParts, state.categories) });
  return createZip(entries);
}
