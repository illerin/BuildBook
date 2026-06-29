export const RICH_TEXT_ALLOWED_TAGS = new Set([
  'A',
  'B',
  'BLOCKQUOTE',
  'BR',
  'CODE',
  'DIV',
  'EM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'I',
  'IMG',
  'LI',
  'OL',
  'P',
  'PRE',
  'S',
  'SPAN',
  'STRIKE',
  'STRONG',
  'U',
  'UL',
]);

export function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function safeRichTextUrl(value, allowImages = false) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) return url;
  if (allowImages && (/^data:image\//i.test(url) || /^blob:/i.test(url))) return url;
  return '';
}

export function repairStoredImageSourcesWithAssetUrl(html, resolveAssetUrl) {
  let nextHtml = String(html || '');
  const matches = [...nextHtml.matchAll(/<img\b[^>]*data-project-image-path=["']([^"']+)["'][^>]*>/gi)];
  for (const match of matches) {
    const tag = match[0];
    const path = match[1];
    if (!path) continue;
    const nextSrc = resolveAssetUrl(path);
    const nextTag = /\ssrc=["'][^"']*["']/i.test(tag)
      ? tag.replace(/\ssrc=["'][^"']*["']/i, ` src="${escapeHtml(nextSrc)}"`)
      : tag.replace(/<img\b/, `<img src="${escapeHtml(nextSrc)}"`);
    nextHtml = nextHtml.replace(tag, nextTag);
  }
  return nextHtml;
}

function removeRichImageSelectedClass(html) {
  return String(html || '')
    .replace(/\sclass=(["'])([^"']*)\1/gi, (match, quote, classValue) => {
      const classes = classValue.split(/\s+/).filter((item) => item && item !== 'rich-image-selected');
      return classes.length ? ` class=${quote}${classes.join(' ')}${quote}` : '';
    })
    .replace(/\srich-image-selected\b/g, '');
}

export function richTextStorageHtmlWithAssetUrl(html, resolveAssetUrl) {
  let nextHtml = removeRichImageSelectedClass(repairStoredImageSourcesWithAssetUrl(html, resolveAssetUrl));
  const matches = [...nextHtml.matchAll(/<img\b[^>]*data-project-image-path=["']([^"']+)["'][^>]*>/gi)];
  for (const match of matches) {
    const tag = match[0];
    const path = match[1];
    if (!path) continue;
    const storedSrc = resolveAssetUrl(path);
    const nextTag = /\ssrc=["'][^"']*["']/i.test(tag)
      ? tag.replace(/\ssrc=["'][^"']*["']/i, ` src="${escapeHtml(storedSrc)}"`)
      : tag.replace(/<img\b/, `<img src="${escapeHtml(storedSrc)}"`);
    nextHtml = nextHtml.replace(tag, nextTag);
  }
  return nextHtml;
}

export function normalizeRichTextWithAssetUrl(value, resolveAssetUrl) {
  const text = String(value || '');
  if (!text.trim()) return '';
  if (/<[a-z][\s\S]*>/i.test(text)) return repairStoredImageSourcesWithAssetUrl(text, resolveAssetUrl);
  return text
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}
