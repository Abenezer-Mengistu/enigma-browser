#!/usr/bin/env node
/**
 * Generates website/analytics-data.json from GitHub Releases + repo traffic APIs.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const REPO = 'Abenezer-Mengistu/enigma-browser';
const [owner, repo] = REPO.split('/');
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';

async function ghFetch(apiPath) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Enigma-Analytics',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`https://api.github.com${apiPath}`, { headers });
  if (!res.ok) {
    console.warn(`[analytics] ${apiPath} → ${res.status}`);
    return null;
  }
  return res.json();
}

function classifyAsset(name) {
  if (/^Enigma-Setup-/i.test(name)) return { group: 'windows-setup', label: 'Windows Installer' };
  if (/^Enigma-Portable-/i.test(name)) return { group: 'windows-portable', label: 'Windows Portable' };
  if (/mac-arm64/i.test(name)) return { group: 'macos-arm64', label: 'macOS Apple Silicon' };
  if (/mac-x64/i.test(name)) return { group: 'macos-x64', label: 'macOS Intel' };
  if (/\.dmg$/i.test(name)) return { group: 'macos', label: 'macOS DMG' };
  if (/\.AppImage$/i.test(name)) return { group: 'linux-appimage', label: 'Linux AppImage' };
  if (/\.deb$/i.test(name)) return { group: 'linux-deb', label: 'Linux .deb' };
  if (/\.rpm$/i.test(name)) return { group: 'linux-rpm', label: 'Linux .rpm' };
  if (/\.zip$/i.test(name) && /mac/i.test(name)) return { group: 'macos-zip', label: 'macOS Zip' };
  if (/latest\.yml$/i.test(name)) return { group: 'metadata', label: 'Update metadata' };
  if (/\.blockmap$/i.test(name)) return { group: 'metadata', label: 'Block map' };
  if (/downloads\.json$/i.test(name)) return { group: 'metadata', label: 'Manifest' };
  return { group: 'other', label: 'Other' };
}

function sumDownloads(assets, includeMetadata = false) {
  return (assets || []).reduce((n, a) => {
    const { group } = classifyAsset(a.name || '');
    if (!includeMetadata && group === 'metadata') return n;
    return n + (a.downloadCount || 0);
  }, 0);
}

async function fetchAllReleases() {
  const releases = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await ghFetch(`/repos/${owner}/${repo}/releases?per_page=100&page=${page}`);
    if (!batch?.length) break;
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  return releases;
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const repoMeta = await ghFetch(`/repos/${owner}/${repo}`) || {};
const releasesRaw = await fetchAllReleases();
const trafficClones = token ? await ghFetch(`/repos/${owner}/${repo}/traffic/clones`) : null;
const trafficViews = token ? await ghFetch(`/repos/${owner}/${repo}/traffic/views`) : null;

const byPlatform = {};
const byPlatformLabel = {};
let totalDownloads = 0;
let latestVersionDownloads = 0;

const releases = releasesRaw.map((r) => {
  const tag = r.tag_name || '';
  const version = tag.replace(/^v/i, '');
  const assets = (r.assets || []).map((a) => {
    const { group, label } = classifyAsset(a.name);
    const downloadCount = a.download_count || 0;
    if (group !== 'metadata') {
      byPlatform[group] = (byPlatform[group] || 0) + downloadCount;
      byPlatformLabel[group] = label;
      totalDownloads += downloadCount;
      if (version === pkg.version) latestVersionDownloads += downloadCount;
    }
    return {
      name: a.name,
      downloadCount,
      size: a.size,
      contentType: a.content_type,
      updatedAt: a.updated_at,
      group,
      label,
      url: a.browser_download_url,
    };
  }).sort((a, b) => b.downloadCount - a.downloadCount);

  const releaseTotal = sumDownloads(assets.map(a => ({
    name: a.name,
    downloadCount: a.downloadCount,
  })));

  return {
    tag,
    version,
    name: r.name || tag,
    publishedAt: r.published_at,
    isPrerelease: !!r.prerelease,
    isDraft: !!r.draft,
    totalDownloads: releaseTotal,
    assets,
    releaseUrl: r.html_url,
  };
}).filter(r => !r.isDraft);

const topAssets = releases
  .flatMap(r => r.assets.map(a => ({ ...a, version: r.version, tag: r.tag })))
  .filter(a => a.group !== 'metadata')
  .sort((a, b) => b.downloadCount - a.downloadCount)
  .slice(0, 15);

const platformBreakdown = Object.entries(byPlatform)
  .filter(([g]) => g !== 'metadata')
  .map(([id, count]) => ({
    id,
    label: byPlatformLabel[id] || id,
    count,
    percent: totalDownloads ? Math.round((count / totalDownloads) * 1000) / 10 : 0,
  }))
  .sort((a, b) => b.count - a.count);

const cloneTotal = (trafficClones?.clones || []).reduce((n, d) => n + (d.count || 0), 0);
const viewTotal = (trafficViews?.views || []).reduce((n, d) => n + (d.count || 0), 0);

const data = {
  generatedAt: new Date().toISOString(),
  repository: {
    name: repoMeta.full_name || REPO,
    url: repoMeta.html_url || `https://github.com/${REPO}`,
    description: repoMeta.description || '',
    stars: repoMeta.stargazers_count || 0,
    forks: repoMeta.forks_count || 0,
    watchers: repoMeta.subscribers_count || 0,
    openIssues: repoMeta.open_issues_count || 0,
    defaultBranch: repoMeta.default_branch || 'main',
    createdAt: repoMeta.created_at || null,
    pushedAt: repoMeta.pushed_at || null,
  },
  summary: {
    currentVersion: pkg.version,
    releaseCount: releases.length,
    totalDownloads,
    latestVersionDownloads,
    uniqueAssetTypes: platformBreakdown.length,
    stars: repoMeta.stargazers_count || 0,
    forks: repoMeta.forks_count || 0,
    trafficCloneTotal14d: cloneTotal,
    trafficViewTotal14d: viewTotal,
  },
  privacyNote:
    'GitHub does not expose individual downloader names, emails, or IP addresses. ' +
    'Counts reflect anonymous downloads from GitHub Releases (includes website download links).',
  traffic: {
    clones: trafficClones?.clones || [],
    views: trafficViews?.views || [],
    cloneCount: trafficClones?.count || 0,
    viewCount: trafficViews?.count || 0,
  },
  platformBreakdown,
  topAssets,
  releases,
};

const out = path.join(root, 'website', 'analytics-data.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(data, null, 2) + '\n');
console.log(`[analytics] Wrote ${out} (${releases.length} releases, ${totalDownloads} downloads)`);
