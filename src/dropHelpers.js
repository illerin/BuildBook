export function droppedFileList(event, accept = () => true) {
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  const fromFiles = [...(event.dataTransfer?.files || [])];
  const fromItems = [...(event.dataTransfer?.items || [])]
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter(Boolean);
  const files = fromFiles.length ? fromFiles : fromItems;
  return files.filter(accept);
}

export function firstDroppedFile(event, accept = () => true) {
  return droppedFileList(event, accept)[0] || null;
}

export function fileLooksImage(file) {
  return Boolean(file?.type?.startsWith('image/') || /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(file?.name || ''));
}

function safeDecodeUrl(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeDroppedImageUrl(value) {
  let text = String(value || '').trim().replace(/^["']|["']$/g, '').replace(/&amp;/g, '&');
  if (/^data:image\//i.test(text)) return text;
  const directUrl = text.match(/https?:\/\/[^\s"'<>]+/i)?.[0] || '';
  text = directUrl || text;
  if (!/^https?:\/\//i.test(text)) return '';
  try {
    const parsed = new URL(text);
    return safeDecodeUrl(parsed.searchParams.get('imgurl') || parsed.searchParams.get('mediaurl') || parsed.searchParams.get('url') || text);
  } catch {
    return text;
  }
}

export function imageUrlFromDrop(event) {
  const transfer = event.dataTransfer;
  if (!transfer) return '';
  const chunks = [];
  for (const type of transfer.types || []) {
    try {
      const value = transfer.getData(type);
      if (value) chunks.push(value);
    } catch {
      // Some browsers block reading specific drag types.
    }
  }
  const html = transfer.getData('text/html');
  chunks.unshift(...[...html.matchAll(/(?:src|href|data-src|data-iurl)=["']([^"']+)["']/gi)].map((match) => match[1]));
  for (const chunk of chunks) {
    const normalized = normalizeDroppedImageUrl(chunk);
    if (normalized) return normalized;
  }
  return '';
}
