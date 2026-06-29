import { readStoredFile } from './desktop';

export async function fileHash(path, clientLocal = false) {
  const bytes = await readStoredFile(path, clientLocal);
  if (crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }

  let hash = 2166136261;
  bytes.forEach((byte) => {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  });
  return `${bytes.length}-${hash >>> 0}`;
}
