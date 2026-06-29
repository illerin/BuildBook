export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];

export function safeName(value) {
  return String(value || 'item')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90) || 'item';
}

export function fileExtension(fileName = '') {
  const baseName = String(fileName || '').split(/[\\/]/).pop() || '';
  const dot = baseName.lastIndexOf('.');
  return dot > 0 ? baseName.slice(dot).toLowerCase() : '';
}

export function fileNameFromUrl(url, fallback = 'part-image') {
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.split('/').filter(Boolean).pop();
    return safeName(name || fallback);
  } catch {
    return safeName(fallback);
  }
}

export function dataUrlToBytes(dataUrl) {
  const [, raw = ''] = String(dataUrl || '').split(',');
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function detectImageExtensionFromBytes(bytes) {
  if (!bytes?.length) return '';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return '.jpg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return '.png';
  if (bytes.length >= 6) {
    const header = new TextDecoder().decode(bytes.slice(0, 6));
    if (header === 'GIF87a' || header === 'GIF89a') return '.gif';
  }
  if (bytes.length >= 12) {
    const riff = new TextDecoder().decode(bytes.slice(0, 4));
    const webp = new TextDecoder().decode(bytes.slice(8, 12));
    if (riff === 'RIFF' && webp === 'WEBP') return '.webp';
  }
  const text = new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 256))).trimStart().toLowerCase();
  if (text.startsWith('<svg') || text.startsWith('<?xml')) return '.svg';
  return '';
}

export function imageMimeType(path = '') {
  const extension = fileExtension(path);
  if (extension === '.png') return 'image/png';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.svg') return 'image/svg+xml';
  if (extension === '.bmp') return 'image/bmp';
  return 'image/jpeg';
}

export function imageMimeTypeFromBytes(bytes, path = '') {
  const detected = detectImageExtensionFromBytes(bytes);
  return detected ? imageMimeType(detected) : imageMimeType(path);
}
