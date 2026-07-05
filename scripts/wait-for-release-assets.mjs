#!/usr/bin/env node
/**
 * Poll GitHub until a release tag has installer assets uploaded.
 * Used by CI before generating downloads.json / deploying Pages.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const REPO = 'Abenezer-Mengistu/enigma-browser';
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const maxAttempts = Number(process.env.RELEASE_WAIT_ATTEMPTS || 24);
const waitMs = Number(process.env.RELEASE_WAIT_MS || 10000);

async function ghFetch(apiPath) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Enigma-Release-Wait',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com${apiPath}`, { headers });
  if (!res.ok) return null;
  return res.json();
}

function hasInstallerAssets(assets) {
  return !!assets?.some(a => /^Enigma-(Setup|Portable)-.*\.exe$/i.test(a.name || ''));
}

function normalizeTag(raw) {
  if (!raw) return null;
  const t = String(raw).replace(/^refs\/tags\//, '').trim();
  return t.startsWith('v') ? t : `v${t}`;
}

async function resolveTargetTag() {
  const fromEnv = normalizeTag(process.env.RELEASE_TAG || process.argv[2]);
  if (fromEnv) return fromEnv;
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return `v${pkg.version}`;
}

const targetTag = await resolveTargetTag();
console.log(`[release-wait] Waiting for ${targetTag} assets on ${REPO}…`);

for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  const byTag = await ghFetch(`/repos/${REPO}/releases/tags/${targetTag}`);
  if (hasInstallerAssets(byTag?.assets)) {
    console.log(`[release-wait] ${targetTag} assets ready (${byTag.assets.length} files).`);
    process.exit(0);
  }

  const latest = await ghFetch(`/repos/${REPO}/releases/latest`);
  if (latest?.tag_name === targetTag && hasInstallerAssets(latest?.assets)) {
    console.log(`[release-wait] ${targetTag} is latest with installer assets.`);
    process.exit(0);
  }

  console.log(`[release-wait] Attempt ${attempt}/${maxAttempts} — assets not ready yet.`);
  if (attempt < maxAttempts) await new Promise(r => setTimeout(r, waitMs));
}

console.error(`[release-wait] Timed out waiting for ${targetTag} installer assets.`);
process.exit(1);
