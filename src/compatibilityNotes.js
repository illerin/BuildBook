import { assetUrl } from './desktop';
import { safeName } from './files';
import { addFileEntry, imagePackageExtension, saveZipAsset } from './compatibilityAssets';
import { webUploadName, webUploadPath } from './compatibility';
import { escapeHtml } from './richTextPolicy';

export async function addWebUploadEntry(entries, path, folder, fileName) {
  const packagePath = `uploads/${folder}/${fileName}`;
  return addFileEntry(entries, path, packagePath);
}

export async function rewriteNotesForWeb(entries, html, projectId, tableRows = []) {
  let nextHtml = String(html || '');
  const matches = [...nextHtml.matchAll(/<img\b[^>]*data-project-image-path="([^"]+)"[^>]*>/g)];
  for (const [index, match] of matches.entries()) {
    const tag = match[0];
    const path = match[1];
    const fileName = webUploadName('note', `${projectId}-${index + 1}`, path, await imagePackageExtension(path));
    const added = await addWebUploadEntry(entries, path, 'images', fileName);
    if (!added) continue;
    const portableId = `note-${index + 1}`;
    tableRows.push({ id: portableId, image_path: fileName, archive_path: `note-images/${fileName}` });
    const exportPath = await addFileEntry(entries, path, `note-images/${fileName}`);
    const src = `/files/images/${fileName}`;
    let nextTag = tag.replace(/src="[^"]*"/, `src="${escapeHtml(src)}"`);
    nextTag = /data-portable-image-id=/.test(nextTag)
      ? nextTag.replace(/data-portable-image-id="[^"]*"/, `data-portable-image-id="${portableId}"`)
      : nextTag.replace(/<img\b/, `<img data-portable-image-id="${portableId}"`);
    nextTag = nextTag.replace(/\sdata-project-image-path=["'][^"']*["']/g, '');
    nextHtml = nextHtml.replace(tag, nextTag);
    if (!exportPath) tableRows[tableRows.length - 1].archive_path = '';
  }
  return nextHtml;
}

export async function restoreWebNoteImages(entries, html, projectId) {
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

export async function packageInlineNoteImages(entries, html, projectId, packageFolder = 'note-images') {
  let nextHtml = String(html || '');
  const matches = [...nextHtml.matchAll(/data-project-image-path="([^"]+)"/g)];
  for (const [index, match] of matches.entries()) {
    const path = match[1];
    const packagePath = await addFileEntry(entries, path, `projects/${safeName(projectId)}/${packageFolder}/inline-${index}${await imagePackageExtension(path)}`);
    if (packagePath) {
      nextHtml = nextHtml.replace(match[0], `${match[0]} data-project-image-package-path="${escapeHtml(packagePath)}"`);
    }
  }
  return nextHtml;
}

export async function restoreInlineNoteImages(entries, html, projectId, library = `project-note-images/${projectId}`) {
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
