#!/usr/bin/env node
/**
 * Generates website/downloads.json from package.json version.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const v = pkg.version;
const REPO = 'Abenezer-Mengistu/enigma-browser';
const LATEST = `https://github.com/${REPO}/releases/latest/download`;
const RELEASE = `https://github.com/${REPO}/releases/tag/v${v}`;

async function fetchDownloadCount() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`);
    if (!res.ok) return null;
    const releases = await res.json();
    let total = 0;
    for (const release of releases) {
      for (const asset of release.assets || []) {
        const name = asset.name || '';
        if (/\.(json|blockmap)$/i.test(name)) continue;
        total += asset.download_count || 0;
      }
    }
    return total;
  } catch {
    return null;
  }
}

const downloadCount = await fetchDownloadCount();

const manifest = {
  name: 'Enigma',
  version: v,
  tag: `v${v}`,
  repository: `https://github.com/${REPO}`,
  releasePage: RELEASE,
  updated: new Date().toISOString().slice(0, 10),
  downloadCount,
  downloadCountUpdated: new Date().toISOString(),
  platforms: {
    windows: {
      id: 'windows',
      label: 'Windows',
      icon: '🪟',
      status: 'available',
      minVersion: 'Windows 10 (64-bit)',
      primary: {
        label: 'Installer (.exe)',
        description: 'Recommended — creates Desktop & Start Menu shortcuts',
        url: `${LATEST}/Enigma-Setup-${v}.exe`,
        filename: `Enigma-Setup-${v}.exe`,
      },
      alternate: {
        label: 'Portable (.exe)',
        description: 'No install — run from any folder or USB drive',
        url: `${LATEST}/Enigma-Portable-${v}.exe`,
        filename: `Enigma-Portable-${v}.exe`,
      },
      install: [
        'Download Enigma-Setup and run the installer.',
        'If SmartScreen appears, choose “More info” → “Run anyway”.',
        'Follow the wizard — Desktop shortcut is created automatically.',
        'Launch Enigma from the Desktop or Start Menu.',
      ],
    },
    macos: {
      id: 'macos',
      label: 'macOS',
      icon: '🍎',
      status: 'available',
      minVersion: 'macOS 11 Big Sur or later',
      variants: [
        {
          label: 'Apple Silicon (M1/M2/M3/M4)',
          arch: 'arm64',
          url: `${LATEST}/Enigma-${v}-mac-arm64.dmg`,
          filename: `Enigma-${v}-mac-arm64.dmg`,
        },
        {
          label: 'Intel Mac',
          arch: 'x64',
          url: `${LATEST}/Enigma-${v}-mac-x64.dmg`,
          filename: `Enigma-${v}-mac-x64.dmg`,
        },
      ],
      install: [
        'Download the .dmg for your Mac (Apple Silicon or Intel).',
        'Open the disk image and drag Enigma into Applications.',
        'First launch: right-click Enigma → Open if macOS blocks unknown apps.',
        'Optional: xattr -cr /Applications/Enigma.app in Terminal',
      ],
    },
    linux: {
      id: 'linux',
      label: 'Linux',
      icon: '🐧',
      status: 'available',
      minVersion: 'Ubuntu 20.04+, Fedora 38+, or equivalent',
      variants: [
        {
          label: 'AppImage (universal)',
          format: 'appimage',
          url: `${LATEST}/Enigma-${v}-linux-x86_64.AppImage`,
          filename: `Enigma-${v}-linux-x86_64.AppImage`,
        },
        {
          label: 'Debian / Ubuntu (.deb)',
          format: 'deb',
          url: `${LATEST}/Enigma-${v}-linux-amd64.deb`,
          filename: `Enigma-${v}-linux-amd64.deb`,
        },
        {
          label: 'Fedora / RHEL (.rpm)',
          format: 'rpm',
          url: `${LATEST}/Enigma-${v}-linux-x86_64.rpm`,
          filename: `Enigma-${v}-linux-x86_64.rpm`,
        },
      ],
      install: [
        'AppImage: chmod +x Enigma-*.AppImage && ./Enigma-*.AppImage',
        'Debian/Ubuntu: sudo dpkg -i Enigma-*-linux-amd64.deb',
        'Fedora: sudo dnf install ./Enigma-*-linux-x86_64.rpm',
        'AppImage may need: sudo apt install libfuse2',
      ],
    },
    ios: {
      id: 'ios',
      label: 'iOS & iPadOS',
      icon: '📱',
      status: 'coming_soon',
      minVersion: 'iOS 16+ (planned)',
      note: 'Enigma is a desktop browser. A native iOS app is on the roadmap.',
      install: [
        'Not available yet on iPhone or iPad.',
        'Use Enigma on Windows, macOS, or Linux today.',
        'Bookmark this page for iOS updates.',
      ],
    },
    android: {
      id: 'android',
      label: 'Android',
      icon: '🤖',
      status: 'coming_soon',
      minVersion: 'Android 12+ (planned)',
      note: 'Android builds are planned. Desktop Enigma is available now.',
      install: [
        'Not available yet on Android.',
        'Download Enigma for desktop in the meantime.',
      ],
    },
    freebsd: {
      id: 'freebsd',
      label: 'FreeBSD / Unix',
      icon: '🔷',
      status: 'available',
      minVersion: 'FreeBSD 13+ with Linux compatibility',
      note: 'Use the Linux AppImage via Linuxulator, or build from source.',
      primary: {
        label: 'Linux AppImage',
        url: `${LATEST}/Enigma-${v}-linux-x86_64.AppImage`,
        filename: `Enigma-${v}-linux-x86_64.AppImage`,
      },
      install: [
        'Enable Linux binary compatibility on FreeBSD.',
        'Download the Linux AppImage and run with Linuxulator.',
        'Or clone the repo: npm install && npm run start:dev',
      ],
    },
  },
};

const out = path.join(root, 'website', 'downloads.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Wrote ${out} (v${v})`);

const iconDir = path.join(root, 'website', 'assets', 'icons');
fs.mkdirSync(iconDir, { recursive: true });
for (const name of ['icon_32.png', 'icon_64.png']) {
  const src = path.join(root, 'assets', 'icons', name);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(iconDir, name));
  }
}
console.log('Synced website/assets/icons');
