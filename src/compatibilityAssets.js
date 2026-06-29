import { readStoredFile, saveBytesFile } from './desktop';
import { detectImageExtensionFromBytes, fileExtension, IMAGE_EXTENSIONS } from './files';

export async function addFileEntry(entries, path, packagePath) {
  if (!path || entries.some((entry) => entry.name === packagePath)) return '';
  try {
    entries.push({ name: packagePath, data: await readStoredFile(path) });
    return packagePath;
  } catch (error) {
    console.warn(`Could not package ${path}`, error);
    return '';
  }
}

export function isKnownImageExtension(extension = '') {
  return IMAGE_EXTENSIONS.includes(String(extension || '').toLowerCase());
}

export function replaceFileExtension(fileName = '', nextExtension = '') {
  const normalizedExtension = String(nextExtension || '').toLowerCase();
  const baseName = String(fileName || '').split(/[\\/]/).pop() || 'file';
  const withoutExtension = baseName.replace(/\.[^.]+$/, '');
  return `${withoutExtension}${normalizedExtension}`;
}

export async function imagePackageExtension(path, fallback = '.jpg') {
  const extension = fileExtension(path);
  if (isKnownImageExtension(extension)) return extension;
  try {
    return detectImageExtensionFromBytes(await readStoredFile(path)) || fallback;
  } catch {
    return fallback;
  }
}

export async function saveZipAsset(entries, packagePath, name, library) {
  if (!packagePath || !entries.has(packagePath)) return '';
  const bytes = entries.get(packagePath);
  let storedName = name || packagePath.split('/').pop();
  const extension = fileExtension(storedName) || fileExtension(packagePath);
  if (!isKnownImageExtension(extension)) {
    const detectedExtension = detectImageExtensionFromBytes(bytes);
    if (detectedExtension) storedName = replaceFileExtension(storedName, detectedExtension);
  }
  const stored = await saveBytesFile(storedName, library, bytes);
  return stored.path;
}
