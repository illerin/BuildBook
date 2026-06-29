import { APP_VERSION, categoryLabel } from './data';
import { createZip } from './zip';
import { safeName } from './files';
import {
  DEFAULT_PROJECT_EXPORT_OPTIONS,
  buildGuideHtml,
  buildInstructionsHtml,
  categoryPath,
  guessWebFileType,
  stripHtml,
  webTrackerKey,
  webUploadName,
} from './compatibility';
import { addFileEntry, imagePackageExtension } from './compatibilityAssets';
import { rewriteNotesForWeb } from './compatibilityNotes';

export async function buildWebProjectPackage(state, project, exportOptions = {}) {
  const options = { ...DEFAULT_PROJECT_EXPORT_OPTIONS, ...exportOptions };
  const entries = [];
  const now = new Date().toISOString();
  const linkedParts = options.linkedParts ? project.partIds.map((id) => state.parts.find((part) => part.id === id)).filter(Boolean) : [];
  const noteImages = [];
  const notes = options.overviewNotes ? await rewriteNotesForWeb(entries, project.notes, project.id, noteImages) : '';
  const projectImageName = options.overviewNotes && project.image ? webUploadName('project', project.id, `${project.name}${await imagePackageExtension(project.image)}`) : '';
  const projectImageArchive = projectImageName ? `project-image/${projectImageName}` : '';
  if (project.image && projectImageName) await addFileEntry(entries, project.image, projectImageArchive);
  const photoArchiveById = new Map();
  const photoLibrary = [];
  const includePhotoAssets = options.photos || options.instructions;
  if (includePhotoAssets) {
    for (const folder of project.photoFolders || []) {
      const exportedPhotos = [];
      for (const photo of folder.photos || []) {
        const archivePath = `project-photos/${safeName(folder.name)}/${safeName(photo.name)}${await imagePackageExtension(photo.path)}`;
        await addFileEntry(entries, photo.path, archivePath);
        const markupArchivePath = photo.markupPath ? `project-photos/${safeName(folder.name)}/markup-${safeName(photo.name)}${await imagePackageExtension(photo.markupPath)}` : '';
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
        await addManifestFile(file.storageMode === 'link' ? child.baselinePath || child.path : child.path, child.relativePath || child.name, file.notes, child.createdAt || file.createdAt, file.trackerId);
      }
    } else {
      await addManifestFile(file.storageMode === 'link' ? file.baselinePath || file.path : file.path, file.name, file.notes, file.createdAt, file.trackerId);
    }
  }

  const parts = [];
  for (const [partIndex, part] of linkedParts.entries()) {
    const partImageName = part.image ? webUploadName('part', part.id, `${part.name}${await imagePackageExtension(part.image)}`) : '';
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
    note_images: noteImages.map((image, index) => ({ id: image.id || `note-${index + 1}`, image_path: image.image_path, archive_path: image.archive_path })),
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
