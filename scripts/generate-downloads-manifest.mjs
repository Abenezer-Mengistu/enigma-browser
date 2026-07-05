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
const REPO = 'Abenezer-Mengistu/enigma-browser';
const REPO_URL = `https://github.com/${REPO}`;

async function ghFetch(path) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Enigma-Manifest' },
  });
  if (!res.ok) return null;
  return res.json();
}

async function fetchReleaseAssets(version) {
  try {
    const release = await ghFetch(`/releases/tags/v${version}`);
    return release?.assets || null;
  } catch {
    return null;
  }
}

function hasInstallerAssets(assets) {
  return !!assets?.some(a => /^Enigma-(Setup|Portable)-.*\.exe$/i.test(a.name || ''));
}

async function resolvePublishedVersion() {
  const pkgVersion = pkg.version;
  const pkgAssets = await fetchReleaseAssets(pkgVersion);
  if (hasInstallerAssets(pkgAssets)) {
    return { version: pkgVersion, tag: `v${pkgVersion}`, assets: pkgAssets };
  }
  const latest = await ghFetch('/releases/latest');
  if (!latest) {
    return { version: pkgVersion, tag: `v${pkgVersion}`, assets: pkgAssets || [] };
  }
  const version = String(latest.tag_name || '').replace(/^v/i, '') || pkgVersion;
  return {
    version,
    tag: latest.tag_name || `v${version}`,
    assets: latest.assets || [],
  };
}

function tagDownloadUrl(tag, filename) {
  return `${REPO_URL}/releases/download/${tag}/${filename}`;
}

function pickMacAsset(assets, arch) {
  if (!assets?.length) return null;
  const re = new RegExp(`Enigma-[\\d.]+-mac-${arch}\\.(zip|dmg)$`, 'i');
  const matches = assets.filter(a => re.test(a.name));
  const hit = matches.find(a => /\.zip$/i.test(a.name))
    || matches.find(a => /\.dmg$/i.test(a.name));
  if (!hit) return null;
  return {
    url: hit.browser_download_url,
    filename: hit.name,
    format: hit.name.endsWith('.zip') ? 'zip' : 'dmg',
  };
}

async function macVariant(version, arch, label, assets) {
  const picked = pickMacAsset(assets, arch);
  const ext = picked?.format || 'zip';
  const filename = picked?.filename || `Enigma-${version}-mac-${arch}.${ext}`;
  const url = picked?.url || tagDownloadUrl(`v${version}`, filename);
  return {
    label,
    arch,
    url,
    filename,
    format: ext,
  };
}

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
const { version: v, tag, assets: releaseAssets } = await resolvePublishedVersion();
const RELEASE = `${REPO_URL}/releases/tag/${tag}`;
const macArm = await macVariant(v, 'arm64', 'Apple Silicon (M1/M2/M3/M4)', releaseAssets);
const macX64 = await macVariant(v, 'x64', 'Intel Mac', releaseAssets);
const macUsesZip = macArm.format === 'zip' || macX64.format === 'zip';
const setupFile = `Enigma-Setup-${v}.exe`;
const portableFile = `Enigma-Portable-${v}.exe`;

const manifest = {
  name: 'Enigma',
  version: v,
  tag: tag,
  repository: REPO_URL,
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
        url: tagDownloadUrl(tag, setupFile),
        filename: setupFile,
      },
      alternate: {
        label: 'Portable (.exe)',
        description: 'No install — run from any folder or USB drive',
        url: tagDownloadUrl(tag, portableFile),
        filename: portableFile,
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
      variants: [macArm, macX64],
      install: macUsesZip
        ? [
            'Download the .zip for your Mac (Apple Silicon or Intel).',
            'Double-click the zip to extract, then drag Enigma.app into Applications.',
            'First launch: right-click Enigma → Open if macOS blocks unknown apps.',
            'If blocked: run xattr -cr /Applications/Enigma.app in Terminal, then open again.',
          ]
        : [
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
          url: tagDownloadUrl(tag, `Enigma-${v}-linux-x86_64.AppImage`),
          filename: `Enigma-${v}-linux-x86_64.AppImage`,
        },
        {
          label: 'Debian / Ubuntu (.deb)',
          format: 'deb',
          url: tagDownloadUrl(tag, `Enigma-${v}-linux-amd64.deb`),
          filename: `Enigma-${v}-linux-amd64.deb`,
        },
        {
          label: 'Fedora / RHEL (.rpm)',
          format: 'rpm',
          url: tagDownloadUrl(tag, `Enigma-${v}-linux-x86_64.rpm`),
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
        url: tagDownloadUrl(tag, `Enigma-${v}-linux-x86_64.AppImage`),
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
