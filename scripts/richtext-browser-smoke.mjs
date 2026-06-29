import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

const chromePath = chromeCandidates.find((candidate) => existsSync(candidate));

assert.ok(chromePath, 'Chrome or Edge is required for rich text browser smoke tests.');

const repoRoot = path.resolve(import.meta.dirname, '..');
const sanitizerUrl = pathToFileURL(path.join(repoRoot, 'src', 'richTextSanitizer.js')).href;
const tempDir = mkdtempSync(path.join(tmpdir(), 'buildbook-richtext-browser-'));
const htmlPath = path.join(tempDir, 'index.html');

writeFileSync(
  htmlPath,
  `<!doctype html>
<html>
  <body>
    <script type="module">
      import { sanitizePastedRichText } from ${JSON.stringify(sanitizerUrl)};

      function assert(condition, message) {
        if (!condition) throw new Error(message);
      }

      const dirty = '<p onclick="alert(1)" style="color:red"><script>alert(1)</script><a href="javascript:alert(1)">bad</a><a href="https://example.test/page" style="x">ok</a><img src="javascript:alert(1)" onerror="x"><img class="x" src="data:image/png;base64,AAAA" data-project-image-path="notes/a.png"><span data-x="drop">text</span></p>';
      const clean = sanitizePastedRichText(dirty);
      assert(!/script|onclick|onerror|style=|javascript:/i.test(clean), 'dangerous paste content was not removed');
      const doc = new DOMParser().parseFromString(clean, 'text/html');
      assert(doc.querySelectorAll('img').length === 1, 'unsafe image was not removed');
      assert(doc.querySelector('img')?.getAttribute('data-project-image-path') === 'notes/a.png', 'project image path was not preserved');
      const goodLink = doc.querySelector('a[href="https://example.test/page"]');
      assert(goodLink?.getAttribute('target') === '_blank', 'safe link target was not applied');
      assert(goodLink?.getAttribute('rel') === 'noopener noreferrer', 'safe link rel was not applied');
      assert(!doc.querySelector('a[href^="javascript:"]'), 'unsafe link href was preserved');

      const plain = sanitizePastedRichText('', 'Line 1\\nLine <2>\\n\\nNext');
      assert(plain === '<p>Line 1<br>Line &lt;2&gt;</p><p>Next</p>', 'plain text paste fallback changed');

      document.body.textContent = 'RICH_TEXT_BROWSER_SMOKE_PASS';
    </script>
  </body>
</html>
`,
);

try {
  const result = spawnSync(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      `--user-data-dir=${path.join(tempDir, 'profile')}`,
      '--no-first-run',
      '--disable-crash-reporter',
      '--virtual-time-budget=5000',
      '--dump-dom',
      pathToFileURL(htmlPath).href,
    ],
    { encoding: 'utf8' },
  );
  if (result.error?.code === 'EPERM' && process.env.RICH_TEXT_BROWSER_REQUIRED !== '1') {
    console.log('Rich text browser smoke check skipped: browser launch blocked by this environment.');
    process.exit(0);
  }
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /RICH_TEXT_BROWSER_SMOKE_PASS/, result.stdout);
  console.log('Rich text browser smoke check passed.');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
