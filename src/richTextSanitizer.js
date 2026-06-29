import { RICH_TEXT_ALLOWED_TAGS, escapeHtml, safeRichTextUrl } from './richTextPolicy.js';

export function sanitizePastedRichText(html, plainText = '') {
  if (!html) {
    return escapeHtml(plainText || '')
      .split(/\n{2,}/)
      .map((block) => `<p>${block.replace(/\n/g, '<br>')}</p>`)
      .join('');
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.body.querySelectorAll('*').forEach((node) => {
    if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'META', 'LINK'].includes(node.tagName)) {
      node.remove();
      return;
    }
    if (!RICH_TEXT_ALLOWED_TAGS.has(node.tagName)) {
      node.replaceWith(...node.childNodes);
      return;
    }
    [...node.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || name === 'class' || name === 'style') {
        node.removeAttribute(attribute.name);
      } else if (node.tagName !== 'A' && name === 'href') {
        node.removeAttribute(attribute.name);
      } else if (node.tagName !== 'IMG' && name === 'src') {
        node.removeAttribute(attribute.name);
      } else if (node.tagName !== 'IMG' && name.startsWith('data-')) {
        node.removeAttribute(attribute.name);
      } else if (!['href', 'src', 'alt', 'title'].includes(name) && !name.startsWith('data-project-image-')) {
        node.removeAttribute(attribute.name);
      }
    });
    if (node.tagName === 'A') {
      const href = safeRichTextUrl(node.getAttribute('href'));
      if (!href) {
        node.removeAttribute('href');
      } else {
        node.setAttribute('href', href);
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    } else if (node.tagName === 'IMG') {
      const src = safeRichTextUrl(node.getAttribute('src'), true);
      if (!src) node.remove();
      else node.setAttribute('src', src);
    }
  });
  return doc.body.innerHTML;
}
