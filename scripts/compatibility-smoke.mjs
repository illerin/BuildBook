import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
function readSources(dir) {
  return readdirSync(dir, { withFileTypes: true }).map((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return readSources(path);
    if (!/\.(js|jsx|mjs)$/.test(entry.name)) return '';
    return readFileSync(path, 'utf8');
  }).join('\n');
}

const source = readSources(join(root, 'src'));
const standardsRoot = resolve(root, '..', 'BuildBook_Compatibility_Standards');

const requiredMarkers = [
  'buildbook-backup.json',
  'buildbook-package.json',
  'backup.json',
  'project-manifest.json',
  'project-data.json',
  'photoFolders',
  'instructions',
  'partDocuments',
  'thumbnailPackagePath',
  'fileTrackers',
];

const missing = requiredMarkers.filter((marker) => !source.includes(marker));

if (missing.length) {
  console.error(`Compatibility smoke check failed. Missing markers: ${missing.join(', ')}`);
  process.exit(1);
}

if (!existsSync(standardsRoot)) {
  console.error(`Compatibility smoke check failed. Standards repo not found: ${standardsRoot}`);
  process.exit(1);
}

const {
  readJson,
  readFixtureManifest,
  validateBackupManifest,
  validateFixtureDescriptor,
  validateProjectManifest,
} = await import(pathToFileURL(join(standardsRoot, 'src', 'validate.js')).href);

validateProjectManifest(readJson('examples/project-export.manifest.example.json'));
validateBackupManifest(readJson('examples/full-backup.manifest.example.json'));

for (const name of ['fixtures/desktop-project-export.fixture.json', 'fixtures/web-project-export.fixture.json']) {
  const { fixture, manifest } = readFixtureManifest(name);
  validateFixtureDescriptor(fixture);
  validateProjectManifest(manifest);
}

for (const name of ['fixtures/desktop-full-backup.fixture.json', 'fixtures/web-full-backup.fixture.json']) {
  const { fixture, manifest } = readFixtureManifest(name);
  validateFixtureDescriptor(fixture);
  validateBackupManifest(manifest);
}

console.log('Compatibility smoke check passed with standards fixtures.');
