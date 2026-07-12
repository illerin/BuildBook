import { assetUrl, downloadUrlFile, readStoredFile, saveBytesFile, savePickedFile } from './desktop';
import { dataUrlToBytes, fileNameFromUrl, imageMimeType, safeName } from './files';
import {
  escapeHtml,
  normalizeRichTextWithAssetUrl,
  repairStoredImageSourcesWithAssetUrl,
  richTextStorageHtmlWithAssetUrl,
} from './richTextPolicy';
import { sanitizePastedRichText, sanitizeStoredRichText } from './richTextSanitizer';

export { escapeHtml } from './richTextPolicy';
export { sanitizePastedRichText } from './richTextSanitizer';

export async function saveImageFromUrl(url, library) {
  if (/^data:image\//i.test(url)) {
    const bytes = dataUrlToBytes(url);
    return saveBytesFile(`${safeName(library.split('/').pop() || 'image')}.png`, library, bytes);
  }
  const originalName = fileNameFromUrl(url);
  const hasExtension = /\.[a-z0-9]{2,5}$/i.test(originalName);
  return downloadUrlFile(url, library, hasExtension ? originalName : `${originalName}.jpg`);
}

export async function saveRichTextImageSource(source, library) {
  if (!source) return null;
  if (typeof source === 'string') return saveImageFromUrl(source, library);
  return savePickedFile(source, library);
}

async function externalizeInlineDataImages(html, library) {
  let nextHtml = String(html || '');
  const matches = [...nextHtml.matchAll(/<img\b[^>]*src=["'](data:image\/[^"']+)["'][^>]*>/gi)];
  for (const match of matches) {
    const tag = match[0];
    const dataUrl = match[1];
    const stored = await saveImageFromUrl(dataUrl, library);
    if (!stored?.path) continue;
    let nextTag = tag.replace(/src=["'][^"']+["']/, `src="${escapeHtml(assetUrl(stored.path))}"`);
    nextTag = /data-project-image-path=/.test(nextTag)
      ? nextTag.replace(/data-project-image-path=["'][^"']*["']/, `data-project-image-path="${escapeHtml(stored.path)}"`)
      : nextTag.replace(/<img\b/, `<img data-project-image-path="${escapeHtml(stored.path)}"`);
    nextHtml = nextHtml.replace(tag, nextTag);
  }
  return nextHtml;
}

export function repairStoredImageSources(html) {
  return repairStoredImageSourcesWithAssetUrl(html, assetUrl);
}

export function richTextStorageHtml(html) {
  return richTextStorageHtmlWithAssetUrl(html, assetUrl);
}

export function normalizeRichText(value) {
  return normalizeRichTextWithAssetUrl(sanitizeStoredRichText(value), assetUrl);
}

export async function hydrateRichTextForEditor(html) {
  let nextHtml = normalizeRichText(html);
  const objectUrls = [];
  const matches = [...nextHtml.matchAll(/<img\b[^>]*data-project-image-path=["']([^"']+)["'][^>]*>/gi)];
  for (const match of matches) {
    const tag = match[0];
    const path = match[1];
    if (!path) continue;
    try {
      const bytes = await readStoredFile(path);
      if (!bytes?.length) continue;
      const objectUrl = URL.createObjectURL(new Blob([bytes], { type: imageMimeType(path) }));
      objectUrls.push(objectUrl);
      const nextTag = /\ssrc=["'][^"']*["']/i.test(tag)
        ? tag.replace(/\ssrc=["'][^"']*["']/i, ` src="${escapeHtml(objectUrl)}"`)
        : tag.replace(/<img\b/, `<img src="${escapeHtml(objectUrl)}"`);
      nextHtml = nextHtml.replace(tag, nextTag);
    } catch {
      // Keep the repaired stored-path source if byte hydration fails.
    }
  }
  return { html: nextHtml, objectUrls };
}

export async function normalizeRichTextImages(html, library) {
  return repairStoredImageSources(await externalizeInlineDataImages(html, library));
}
