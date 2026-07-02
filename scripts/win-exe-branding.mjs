/**
 * Windows PE version metadata — Task Manager shows FileDescription / ProductName.
 * electron-builder skips this when signAndEditExecutable is false.
 */
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { rcedit } from 'rcedit';

const root = resolve(import.meta.dirname, '..');

function readAppVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    return String(pkg.version || '1.0.0');
  } catch {
    return '1.0.0';
  }
}

/** Windows expects four-part numeric version e.g. 2.0.1.0 */
function toWinVersion(version) {
  const parts = String(version).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  while (parts.length < 4) parts.push(0);
  return parts.slice(0, 4).join('.');
}

export function brandingOptions(version = readAppVersion()) {
  const winVer = toWinVersion(version);
  return {
    icon: join(root, 'assets', 'icons', 'icon.ico'),
    'file-version': winVer,
    'product-version': winVer,
    'version-string': {
      FileDescription: 'Enigma',
      ProductName: 'Enigma',
      CompanyName: 'Enigma',
      LegalCopyright: 'Copyright 2026 Enigma',
      OriginalFilename: 'Enigma.exe',
      InternalFilename: 'Enigma',
      Comments: 'Enigma - Multi-session privacy container browser',
    },
  };
}

export async function applyWindowsBranding(exePath, version) {
  await rcedit(exePath, brandingOptions(version));
}
