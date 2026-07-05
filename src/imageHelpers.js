import { readStoredFile, saveBytesFile, savePickedFile } from './desktop';
import { imageMimeType, safeName } from './files';
import { saveImageFromUrl } from './richText';
import { cssColor } from './theme';

export async function savePhotoThumbnail(blob, name, library) {
  const bitmap = await createImageBitmap(blob);
  const size = 360;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  context.fillStyle = cssColor('--field', '#151a20');
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

export async function savePhotoThumbnailFromPath(path, name, library) {
  const bytes = await readStoredFile(path);
  return savePhotoThumbnail(new Blob([bytes], { type: imageMimeType(name || path) }), name, library);
}

export async function savePartImageWithThumbnail(file, partId) {
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

export async function savePartImageUrlWithThumbnail(url, partId) {
  const stored = await saveImageFromUrl(url, `part-images/${partId}`);
  let imageThumbnail = '';
  try {
    const thumbnail = await savePhotoThumbnailFromPath(stored.path, stored.name, `part-images/${partId}/thumbs`);
    imageThumbnail = thumbnail.path;
  } catch (error) {
    console.warn('Could not create part thumbnail', error);
  }
  return { image: stored.path, imageThumbnail };
}
