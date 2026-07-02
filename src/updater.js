'use strict';

const { app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');

const UPDATE_REPO = 'Abenezer-Mengistu/enigma-browser';
const UPDATE_PAGE = 'https://abenezer-mengistu.github.io/enigma-browser/';

let mainWinRef = () => null;
let pendingRelease = null;
let downloading = false;

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.allowDowngrade = false;

function send(channel, payload) {
  mainWinRef()?.webContents.send(channel, payload);
}

function isPortableBuild() {
  return !!(process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR);
}

function parseVersion(v) {
  const m = String(v || '').replace(/^v/i, '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [+m[1], +m[2], +m[3]];
}

function isVersionNewer(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

async function fetchLatestRelease() {
  const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
    headers: { 'User-Agent': 'Enigma-Browser', Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error('Could not fetch release info');
  return res.json();
}

function pickAsset(release, portable) {
  const assets = release.assets || [];
  if (portable) {
    return assets.find(a => /^Enigma-Portable-.*\.exe$/i.test(a.name));
  }
  return assets.find(a => /^Enigma-Setup-.*\.exe$/i.test(a.name));
}

async function downloadAsset(url, dest, onProgress) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Enigma-Browser', Accept: 'application/octet-stream' },
  });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const total = Number(res.headers.get('content-length') || 0);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const file = fs.createWriteStream(dest);
  let received = 0;
  const reader = res.body?.getReader?.();
  if (!reader) throw new Error('Download stream unavailable');

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    file.write(Buffer.from(value));
    const percent = total ? (received / total) * 100 : 0;
    onProgress?.({ percent, transferred: received, total });
  }

  await new Promise((resolve, reject) => {
    file.end(() => resolve());
    file.on('error', reject);
  });
  return dest;
}

function runInstallerAndQuit(installerPath) {
  const args = process.platform === 'win32' ? ['--updated', '/S'] : [];
  const child = spawn(installerPath, args, { detached: true, stdio: 'ignore' });
  child.unref();
  setTimeout(() => app.quit(), 400);
}

function runPortableAndQuit(portablePath) {
  const child = spawn(portablePath, [], {
    detached: true,
    stdio: 'ignore',
    cwd: path.dirname(portablePath),
  });
  child.unref();
  setTimeout(() => app.quit(), 400);
}

function initUpdater(getMainWindow) {
  mainWinRef = getMainWindow;

  autoUpdater.on('download-progress', (p) => {
    send('update-progress', {
      percent: p.percent,
      transferred: p.transferred,
      total: p.total,
      bytesPerSecond: p.bytesPerSecond,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    downloading = false;
    send('update-downloaded', { version: info.version, mode: 'autoUpdater' });
  });

  autoUpdater.on('error', (err) => {
    downloading = false;
    send('update-error', { message: err?.message || String(err) });
  });
}

async function checkForUpdates() {
  const current = app.getVersion();
  const base = {
    currentVersion: current,
    latestVersion: current,
    available: false,
    url: UPDATE_PAGE,
    downloadUrl: UPDATE_PAGE,
    portable: isPortableBuild(),
    canAutoUpdate: app.isPackaged,
  };

  try {
    if (app.isPackaged && !isPortableBuild()) {
      try {
        const result = await autoUpdater.checkForUpdates();
        const info = result?.updateInfo;
        if (info && isVersionNewer(info.version, current)) {
          pendingRelease = { version: info.version, via: 'autoUpdater' };
          return {
            ...base,
            available: true,
            latestVersion: info.version,
            downloadUrl: info.path || UPDATE_PAGE,
          };
        }
      } catch {
        /* fall through to GitHub API */
      }
    }

    const release = await fetchLatestRelease();
    const latest = (release.tag_name || '').replace(/^v/i, '');
    pendingRelease = { release, version: latest, via: 'github' };
    const asset = pickAsset(release, isPortableBuild());
    return {
      ...base,
      available: isVersionNewer(latest, current),
      latestVersion: latest,
      url: release.html_url || UPDATE_PAGE,
      downloadUrl: asset?.browser_download_url || UPDATE_PAGE,
      assetName: asset?.name || null,
    };
  } catch {
    return base;
  }
}

async function downloadUpdate() {
  if (downloading) return { ok: false, reason: 'busy' };
  if (!app.isPackaged) {
    shell.openExternal(UPDATE_PAGE);
    return { ok: false, reason: 'dev' };
  }

  downloading = true;
  send('update-progress', { percent: 0, transferred: 0, total: 0 });

  try {
    if (pendingRelease?.via === 'autoUpdater' && !isPortableBuild()) {
      await autoUpdater.downloadUpdate();
      return { ok: true, mode: 'autoUpdater' };
    }

    const release = pendingRelease?.release || await fetchLatestRelease();
    const portable = isPortableBuild();
    const asset = pickAsset(release, portable);
    if (!asset?.browser_download_url) throw new Error('No update installer found for this build');

    const dest = path.join(
      app.getPath('temp'),
      'enigma-updates',
      asset.name,
    );

    await downloadAsset(asset.browser_download_url, dest, (p) => send('update-progress', p));
    downloading = false;
    const version = (pendingRelease?.version || release.tag_name || '').replace(/^v/i, '');
    send('update-downloaded', { version, mode: portable ? 'portable' : 'installer' });

    setTimeout(async () => {
      if (portable) {
        const targetDir = process.env.PORTABLE_EXECUTABLE_DIR || app.getPath('downloads');
        const finalPath = path.join(targetDir, asset.name);
        try { await fs.promises.copyFile(dest, finalPath); runPortableAndQuit(finalPath); }
        catch { runPortableAndQuit(dest); }
      } else {
        runInstallerAndQuit(dest);
      }
    }, 900);

    return { ok: true, mode: portable ? 'portable' : 'installer' };
  } catch (e) {
    downloading = false;
    send('update-error', { message: e?.message || String(e) });
    throw e;
  }
}

function quitAndInstall() {
  if (isPortableBuild()) return false;
  autoUpdater.quitAndInstall(false, true);
  return true;
}

module.exports = {
  initUpdater,
  checkForUpdates,
  downloadUpdate,
  quitAndInstall,
  isPortableBuild,
};
