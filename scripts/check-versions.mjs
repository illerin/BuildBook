import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

function match(path, pattern, label) {
  const value = read(path).match(pattern)?.[1];
  if (!value) throw new Error(`Could not read ${label} from ${path}.`);
  return value;
}

const versions = {
  'package.json': JSON.parse(read('package.json')).version,
  'src/data.js': match('src/data.js', /APP_VERSION = '([^']+)'/, 'APP_VERSION'),
  'src-tauri/Cargo.toml': match('src-tauri/Cargo.toml', /^version = "([^"]+)"/m, 'Cargo package version'),
  'src-tauri/tauri.conf.json': JSON.parse(read('src-tauri/tauri.conf.json')).version,
};

const unique = [...new Set(Object.values(versions))];

if (unique.length !== 1) {
  console.error('Version check failed:');
  for (const [file, version] of Object.entries(versions)) {
    console.error(`- ${file}: ${version}`);
  }
  process.exit(1);
}

console.log(`Version check passed: ${unique[0]}`);
