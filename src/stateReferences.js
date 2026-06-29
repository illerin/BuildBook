import { projectNoteSheets } from './projectNotes';

export function collectReferencedPaths(state) {
  const paths = new Set();
  const add = (path) => {
    if (path && typeof path === 'string' && !path.startsWith('blob:')) paths.add(path);
  };
  const addRichTextImages = (html) => {
    for (const match of String(html || '').matchAll(/data-project-image-path="([^"]+)"/g)) add(match[1]);
  };
  state.projects.forEach((project) => {
    add(project.image);
    addRichTextImages(project.notes);
    projectNoteSheets(project).forEach((sheet) => addRichTextImages(sheet.content));
    (project.noteImages || []).forEach((image) => add(image.path));
    (project.photoFolders || []).forEach((folder) => (folder.photos || []).forEach((photo) => {
      add(photo.path);
      add(photo.markupPath);
      add(photo.thumbnailPath);
      add(photo.markupThumbnailPath);
    }));
    (project.files || []).forEach((file) => {
      add(file.path);
      add(file.baselinePath);
      (file.folderFiles || []).forEach((child) => add(child.path));
      (file.folderFiles || []).forEach((child) => add(child.baselinePath));
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
