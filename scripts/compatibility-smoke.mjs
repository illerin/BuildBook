import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const app = readFileSync(join(root, 'src', 'App.jsx'), 'utf8');

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

const missing = requiredMarkers.filter((marker) => !app.includes(marker));

if (missing.length) {
  console.error(`Compatibility smoke check failed. Missing markers: ${missing.join(', ')}`);
  process.exit(1);
}

console.log('Compatibility smoke check passed.');
