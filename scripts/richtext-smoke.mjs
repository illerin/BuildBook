import assert from 'node:assert/strict';
import {
  RICH_TEXT_ALLOWED_TAGS,
  escapeHtml,
  normalizeRichTextWithAssetUrl,
  repairStoredImageSourcesWithAssetUrl,
  richTextStorageHtmlWithAssetUrl,
  safeRichTextUrl,
} from '../src/richTextPolicy.js';

const assetUrl = (path) => `asset://${path}`;

assert.equal(escapeHtml('<img alt="x" & bad>'), '&lt;img alt=&quot;x&quot; &amp; bad&gt;');

assert.equal(safeRichTextUrl('https://example.test/page'), 'https://example.test/page');
assert.equal(safeRichTextUrl('mailto:test@example.test'), 'mailto:test@example.test');
assert.equal(safeRichTextUrl('javascript:alert(1)'), '');
assert.equal(safeRichTextUrl('data:text/html;base64,PHNjcmlwdA==', true), '');
assert.equal(safeRichTextUrl('data:image/png;base64,AAAA', true), 'data:image/png;base64,AAAA');
assert.equal(safeRichTextUrl('blob:http://localhost/image', true), 'blob:http://localhost/image');

assert.equal(RICH_TEXT_ALLOWED_TAGS.has('SCRIPT'), false);
assert.equal(RICH_TEXT_ALLOWED_TAGS.has('IMG'), true);
assert.equal(RICH_TEXT_ALLOWED_TAGS.has('A'), true);

assert.equal(
  normalizeRichTextWithAssetUrl('Line 1\nLine 2\n\nUse 5 < 7 & "ok"', assetUrl),
  '<p>Line 1<br>Line 2</p><p>Use 5 &lt; 7 &amp; &quot;ok&quot;</p>',
);

assert.equal(
  repairStoredImageSourcesWithAssetUrl('<p><img data-project-image-path="notes/a&b.png"></p>', assetUrl),
  '<p><img src="asset://notes/a&amp;b.png" data-project-image-path="notes/a&b.png"></p>',
);

assert.equal(
  richTextStorageHtmlWithAssetUrl('<p><img class="rich-image-selected" src="blob:x" data-project-image-path="notes/a.png"></p>', assetUrl),
  '<p><img src="asset://notes/a.png" data-project-image-path="notes/a.png"></p>',
);

console.log('Rich text smoke check passed.');
