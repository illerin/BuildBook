import { APP_VERSION } from './data';

export const GITHUB_REPOSITORY_URL = 'https://github.com/illerin/BuildBook';
export const GITHUB_LATEST_RELEASE_API = 'https://api.github.com/repos/illerin/BuildBook/releases/latest';
const GITHUB_RELEASES_API = 'https://api.github.com/repos/illerin/BuildBook/releases?per_page=30';

export function releaseVersion(version = '') {
  return String(version).replace(/^test-v/i, '').replace(/^v/i, '');
}

export function appReleaseChannel(version = APP_VERSION) {
  return /-test(?:\.|$)/i.test(version) ? 'test' : 'live';
}

function versionNumbers(version = '') {
  const cleaned = releaseVersion(version);
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)(?:-test\.(\d+))?/i);
  if (!match) return [0, 0, 0, -1];
  return [
    Number(match[1]) || 0,
    Number(match[2]) || 0,
    Number(match[3]) || 0,
    match[4] === undefined ? 9999 : Number(match[4]) || 0,
  ];
}

export function isNewerVersion(candidate, current) {
  const next = versionNumbers(candidate);
  const installed = versionNumbers(current);
  return next.some((number, index) => number > (installed[index] || 0)
    && next.slice(0, index).every((previous, previousIndex) => previous === (installed[previousIndex] || 0)));
}

export async function fetchReleaseSummary() {
  const response = await fetch(GITHUB_RELEASES_API, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (response.status === 404) return { live: null, test: null };
  if (!response.ok) throw new Error(`Could not check releases. GitHub returned ${response.status}.`);
  const releases = await response.json();
  return {
    live: releases.find((release) => /^v\d+\.\d+\.\d+$/.test(release.tag_name || '') && !release.prerelease) || null,
    test: releases.find((release) => /^test-v\d+\.\d+\.\d+-test\.(0|[1-9]\d*)$/.test(release.tag_name || '') && release.prerelease) || null,
  };
}
