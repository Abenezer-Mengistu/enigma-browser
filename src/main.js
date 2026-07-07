const {
  app, BrowserWindow, session, ipcMain, Menu, shell, clipboard, screen, nativeImage, nativeTheme, dialog, webContents,
} = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const crypto = require('crypto');
const { isSafeExternalUrl, isNavigableUrl, hardenSession, FINGERPRINT_INJECT, FORCE_LIGHT_PAGE } = require('./security');
const { listTemplates } = require('./session-templates');
const { DEFAULT_PRIVACY, effectiveSettings } = require('./privacy-store');
const { encryptVault, decryptVault } = require('./sync-crypto');
const { sharedEngine } = require('./filter-engine');
const {
  initUpdater, checkForUpdates, checkPendingUpdateOnStartup, downloadUpdate, installUpdate, quitAndInstall, getUpdateStatus, openReleasePage, getInstallInfo,
} = require('./updater');
const {
  loadExtensions, saveExtensions, readManifest, applyExtensionsToSession, removeExtensionsFromSession,
} = require('./extensions');
const { detectBrowsers, importFromBrowser, starterSessionsSeed } = require('./browser-import');
const {
  deriveLocalKey, loadPasswordDoc, savePasswordDoc, listForHost, listBySession,
  upsertEntry, removeEntry, exportPlain, importPlain,
} = require('./password-store');

const SYNC_VAULT_NAME = 'enigma-vault.json';
const DNS_PRESETS = {
  cloudflare: ['https://cloudflare-dns.com/dns-query'],
  quad9: ['https://dns.quad9.net/dns-query'],
  adguard: ['https://dns.adguard-dns.com/dns-query'],
};
let syncFolderWatcher = null;
let lastSyncFolderMtime = 0;

app.setName('Enigma');
if (process.platform === 'win32') app.setAppUserModelId('app.enigmabrowser');

/** Always use OS app-data — never store profiles beside a portable/USB .exe */
function resolveUserDataRoot() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Enigma');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Enigma');
  }
  return path.join(os.homedir(), '.config', 'Enigma');
}
app.setPath('userData', resolveUserDataRoot());

app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer');
app.commandLine.appendSwitch('disable-features', 'WebContentsForceDark');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'default_public_interface_only');

const DATA = app.getPath('userData');
const USERS_ROOT = path.join(DATA, 'users');
const REGISTRY_PATH = path.join(USERS_ROOT, 'registry.json');
const INSTALL_BINDING_PATH = path.join(DATA, 'install-binding.json');
const LEGACY_PATHS = {
  history: path.join(DATA, 'history.json'),
  bookmarks: path.join(DATA, 'bookmarks.json'),
  settings: path.join(DATA, 'settings.json'),
  session: path.join(DATA, 'session.json'),
  notes: path.join(DATA, 'notes.txt'),
};

let activeUserId = 'u_default';

function userDir(userId) {
  const dir = path.join(USERS_ROOT, userId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function userPaths(userId = activeUserId) {
  const dir = userDir(userId);
  return {
    history: path.join(dir, 'history.json'),
    bookmarks: path.join(dir, 'bookmarks.json'),
    settings: path.join(dir, 'settings.json'),
    session: path.join(dir, 'session.json'),
    notes: path.join(dir, 'notes.txt'),
  };
}

function sessionPartition(userId, sessionId, ephemeral) {
  const prefix = ephemeral ? 'partition' : 'persist';
  return `${prefix}:u${userId}_s_${sessionId}`;
}

function mainPartition(userId = activeUserId) {
  return `persist:u${userId}_main`;
}

function machineFingerprint() {
  const parts = [os.hostname(), os.userInfo().username, process.platform, 'enigma-v1'];
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

function wipeAllLocalData() {
  try {
    if (fs.existsSync(USERS_ROOT)) fs.rmSync(USERS_ROOT, { recursive: true, force: true });
    for (const legacy of Object.values(LEGACY_PATHS)) {
      try { if (fs.existsSync(legacy)) fs.unlinkSync(legacy); } catch {}
    }
    const partsDir = path.join(DATA, 'Partitions');
    if (fs.existsSync(partsDir)) fs.rmSync(partsDir, { recursive: true, force: true });
    try { if (fs.existsSync(INSTALL_BINDING_PATH)) fs.unlinkSync(INSTALL_BINDING_PATH); } catch {}
  } catch (e) { console.error('[wipeAllLocalData]', e); }
}

/** Bind profile storage to this computer — new machine = fresh start */
function ensureMachineBinding() {
  fs.mkdirSync(DATA, { recursive: true });
  const machineId = machineFingerprint();
  const binding = read(INSTALL_BINDING_PATH, null);
  const hadUsers = fs.existsSync(REGISTRY_PATH);

  if (!binding) {
    write(INSTALL_BINDING_PATH, {
      machineId,
      boundAt: Date.now(),
      appVersion: app.getVersion(),
    });
    return !hadUsers;
  }

  if (binding.machineId !== machineId) {
    wipeAllLocalData();
    write(INSTALL_BINDING_PATH, {
      machineId,
      boundAt: Date.now(),
      appVersion: app.getVersion(),
    });
    return true;
  }
  return false;
}

function emptySessionSeed(color = '#8b5cf6') {
  return {
    profiles: [{ id: 'default', name: 'Main', color, isIncognito: false, ephemeral: false, partition: null }],
    activePid: 'default',
    tabsByPid: { default: [] },
    activeTid: { default: null },
  };
}

function privacyPresetSettings(preset) {
  if (preset === 'strict') {
    return {
      blockTrackers: true,
      httpsOnly: true,
      doNotTrack: true,
      blockPopups: true,
      filterLists: true,
      fingerprintProtection: true,
      webrtcProtection: true,
      mixedContentBlock: true,
    };
  }
  if (preset === 'relaxed') {
    return {
      blockTrackers: false,
      httpsOnly: false,
      doNotTrack: false,
      blockPopups: true,
      filterLists: false,
      fingerprintProtection: false,
      webrtcProtection: false,
      mixedContentBlock: false,
    };
  }
  return {
    blockTrackers: true,
    httpsOnly: false,
    doNotTrack: true,
    blockPopups: true,
    filterLists: true,
    fingerprintProtection: true,
    webrtcProtection: true,
    mixedContentBlock: false,
  };
}

function privacyPresetDoc(preset) {
  if (preset === 'strict') {
    return {
      ...DEFAULT_PRIVACY,
      filterLists: true,
      fingerprintProtection: true,
      webrtcProtection: true,
      mixedContentBlock: true,
    };
  }
  if (preset === 'relaxed') {
    return {
      ...DEFAULT_PRIVACY,
      filterLists: false,
      fingerprintProtection: false,
      webrtcProtection: false,
      mixedContentBlock: false,
    };
  }
  return { ...DEFAULT_PRIVACY };
}

function seedUserFiles(userId, opts = {}) {
  const {
    color = '#8b5cf6',
    settings: settingsOverride = {},
    privacyPreset = 'balanced',
    starterSession = null,
  } = opts;
  const paths = userPaths(userId);
  if (!migrateLegacyIntoUser(userId)) {
    write(paths.settings, {
      ...DEFAULT_SETTINGS,
      restoreSession: false,
      ...privacyPresetSettings(privacyPreset),
      ...settingsOverride,
    });
    write(paths.history, []);
    write(paths.bookmarks, []);
    write(privacyPath(userId), privacyPresetDoc(privacyPreset));

    const session = emptySessionSeed(color);
    if (starterSession && starterSession.id && starterSession.id !== 'custom') {
      const sid = `s_${Date.now()}`;
      session.profiles.push({
        id: sid,
        name: starterSession.name || starterSession.id,
        color: starterSession.color || color,
        isIncognito: true,
        ephemeral: !!starterSession.ephemeral,
        partition: null,
        templateId: starterSession.id,
        privacy: starterSession.defaults || {},
        searchEngine: starterSession.defaults?.searchEngine || settingsOverride.searchEngine || DEFAULT_SETTINGS.searchEngine,
      });
      session.tabsByPid[sid] = [];
      session.activeTid[sid] = null;
    }
    write(paths.session, session);
    try { fs.writeFileSync(paths.notes, ''); } catch { /* ignore */ }
  } else if (!fs.existsSync(paths.settings)) {
    write(paths.settings, { ...DEFAULT_SETTINGS, restoreSession: false, ...settingsOverride });
  }
}

function migrateLegacyIntoUser(userId) {
  const paths = userPaths(userId);
  let copied = false;
  for (const [key, legacy] of Object.entries(LEGACY_PATHS)) {
    const dest = paths[key];
    if (fs.existsSync(legacy) && !fs.existsSync(dest)) {
      try { fs.copyFileSync(legacy, dest); copied = true; } catch (e) { console.error('[migrate]', key, e); }
    }
  }
  return copied;
}

function ensureUsersMigrated() {
  fs.mkdirSync(USERS_ROOT, { recursive: true });
  if (fs.existsSync(REGISTRY_PATH)) return;

  const hasLegacy = Object.values(LEGACY_PATHS).some(p => fs.existsSync(p));
  if (!hasLegacy) return;

  const userId = 'u_default';
  userDir(userId);
  seedUserFiles(userId, { name: 'You', color: '#8b5cf6', type: 'account' });
  write(REGISTRY_PATH, {
    activeUserId: userId,
    onboardingComplete: true,
    users: [{ id: userId, name: 'You', color: '#8b5cf6', type: 'account', created: Date.now() }],
  });
}

function getRegistry() {
  fs.mkdirSync(USERS_ROOT, { recursive: true });
  if (!fs.existsSync(REGISTRY_PATH)) {
    return { activeUserId: null, users: [], onboardingComplete: false };
  }
  const reg = read(REGISTRY_PATH, { activeUserId: null, users: [], onboardingComplete: false });
  if (!reg.onboardingComplete && reg.users?.length) {
    reg.onboardingComplete = true;
    saveRegistry(reg);
  }
  return reg;
}

function saveRegistry(reg) {
  write(REGISTRY_PATH, reg);
}

function setActiveUser(userId) {
  if (!userId) return;
  activeUserId = userId;
  appSettings = getSettings();
  const ses = session.fromPartition(mainPartition(userId));
  applySessionPolicy(ses);
}

async function reloadUserExtensions(targetSes = null) {
  if (!activeUserId) return [];
  const doc = loadExtensions(read, userDir, activeUserId);
  const ses = targetSes || session.fromPartition(mainPartition(activeUserId));
  await removeExtensionsFromSession(ses);
  return applyExtensionsToSession(ses, doc.items);
}

async function applyExtensionsForSession(sessionId, ephemeral = false) {
  if (!activeUserId) return [];
  const doc = loadExtensions(read, userDir, activeUserId);
  const ses = session.fromPartition(sessionPartition(activeUserId, sessionId, ephemeral));
  await removeExtensionsFromSession(ses);
  return applyExtensionsToSession(ses, doc.items);
}
function loadAppIcon() {
  const candidates = [];
  if (app.isPackaged) {
    candidates.push(
      path.join(process.resourcesPath, 'icons', 'icon.ico'),
      path.join(process.resourcesPath, 'icons', 'icon.png'),
      path.join(process.resourcesPath, 'icons', 'icon_256.png'),
      path.join(process.resourcesPath, 'icons', 'icon_128.png'),
    );
  }
  candidates.push(
    path.join(__dirname, '../assets/icons/icon.ico'),
    path.join(__dirname, '../assets/icons/icon.png'),
    path.join(__dirname, '../assets/icons/icon_256.png'),
    path.join(__dirname, '../assets/icons/icon_128.png'),
  );
  for (const iconPath of candidates) {
    try {
      if (!fs.existsSync(iconPath)) continue;
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty()) return img;
    } catch {}
  }
  return nativeImage.createEmpty();
}

const APP_ICON = loadAppIcon();

const DEFAULT_SETTINGS = {
  homepage: 'https://google.com',
  searchEngine: 'google',
  theme: 'dark',
  showClock: true,
  compactTabs: false,
  verticalTabs: false,
  burnEphemeralOnQuit: false,
  blockTrackers: true,
  httpsOnly: false,
  doNotTrack: true,
  blockPopups: true,
  restoreSession: false,
  closeTabsOnExit: false,
  rememberCloseTabsChoice: false,
  filterLists: true,
  fingerprintProtection: true,
  webrtcProtection: true,
  mixedContentBlock: false,
  checkUpdates: true,
  autoInstallUpdates: false,
  sessionRules: {},
  secureDns: 'off',
  secureDnsCustom: '',
  syncFolder: '',
  syncWatchFolder: false,
};

const sessionConfigs = new Map();
const sessionBlockedCounts = new Map();

function sessionKey(userId, sessionId) {
  return `${userId}:${sessionId}`;
}

function privacyPath(userId = activeUserId) {
  return path.join(userDir(userId), 'privacy.json');
}

function getPrivacyDoc(userId = activeUserId) {
  return { ...DEFAULT_PRIVACY, ...read(privacyPath(userId), {}) };
}

function savePrivacyDoc(doc, userId = activeUserId) {
  write(privacyPath(userId), { ...DEFAULT_PRIVACY, ...doc });
}

function getSessionConfig(userId, sessionId) {
  return sessionConfigs.get(sessionKey(userId, sessionId)) || {};
}

function parseProxy(proxyStr) {
  if (!proxyStr || !String(proxyStr).trim()) return null;
  const s = String(proxyStr).trim();
  if (s === 'direct') return { mode: 'direct' };
  try {
    const u = new URL(s.includes('://') ? s : `http://${s}`);
    const scheme = u.protocol.replace(':', '');
    if (scheme === 'socks5' || scheme === 'socks4') {
      return { proxyRules: `${scheme}=${u.hostname}:${u.port || 1080}` };
    }
    const port = u.port || (scheme === 'https' ? 443 : 80);
    return { proxyRules: `http=${u.hostname}:${port};https=${u.hostname}:${port}` };
  } catch {
    return { proxyRules: s };
  }
}

async function applyProxy(ses, proxyStr) {
  const cfg = parseProxy(proxyStr);
  if (cfg) await ses.setProxy(cfg);
}

const read  = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } };
const write = (p, d)  => { try { fs.writeFileSync(p, JSON.stringify(d, null, 2)); } catch (e) { console.error(e); } };

let mainWin = null;
let splashWin = null;
const browserWindows = new Set();
const windowSessions = new Map();
const pendingBoots = new Map();
const tabBarBounds = new Map();
const windowCloseAllowed = new Set();

function pointInRect(p, r) {
  return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
}

function sendWin(win, channel, payload) {
  if (!win || win.isDestroyed()) return;
  try { win.webContents.send(channel, payload); } catch { /* window closing */ }
}

function getMainWin() {
  if (mainWin && !mainWin.isDestroyed()) return mainWin;
  for (const w of browserWindows) {
    if (!w.isDestroyed()) return w;
  }
  return null;
}

function winFromEvent(e) {
  if (e?.sender) {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w && !w.isDestroyed()) return w;
  }
  return getMainWin();
}

function broadcastToWindows(channel, payload) {
  for (const w of browserWindows) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

function mergeSessionSnapshots(snapshots) {
  const list = snapshots.filter(Boolean);
  if (!list.length) return null;
  const base = { ...list[list.length - 1] };
  const tabsByPid = {};
  const activeTid = {};
  for (const snap of list) {
    for (const [pid, tabs] of Object.entries(snap.tabsByPid || {})) {
      if (!Array.isArray(tabs)) continue;
      if (!tabsByPid[pid]) tabsByPid[pid] = [];
      for (const tab of tabs) {
        if (!tab?.id || tabsByPid[pid].some(t => t.id === tab.id)) continue;
        tabsByPid[pid].push(tab);
      }
    }
    if (snap.activePid && snap.activeTid?.[snap.activePid]) {
      activeTid[snap.activePid] = snap.activeTid[snap.activePid];
    }
  }
  return { ...base, tabsByPid, activeTid };
}

function persistMergedSessions() {
  const merged = mergeSessionSnapshots([...windowSessions.values()]);
  if (merged) write(userPaths().session, merged);
}

function attachWindowShortcuts(win) {
  win.webContents.on('before-input-event', (e, k) => {
    const c = k.control || k.meta;
    if (!c) {
      if (!k.shift && !k.alt && k.key === 'F11') {
        win.webContents.send('cmd', 'fullscreen');
        e.preventDefault();
      }
      return;
    }
    const MAP = {
      t: 'new-tab', w: 'close-tab', r: 'reload', l: 'focus-url',
      f: 'find', b: 'bookmarks', h: 'history', d: 'bookmark',
      '=': 'zoom-in', '+': 'zoom-in', '-': 'zoom-out', '0': 'zoom-reset',
      '[': 'back', ']': 'fwd', p: 'print',
    };
    const cmd = MAP[k.key.toLowerCase()];
    if (cmd) { win.webContents.send('cmd', cmd); e.preventDefault(); return; }
    if (c && k.shift && k.key.toLowerCase() === 't') {
      win.webContents.send('cmd', 'reopen-tab');
      e.preventDefault();
    }
    if (c && k.shift && k.key.toLowerCase() === 'n') {
      win.webContents.send('cmd', 'new-incognito');
      e.preventDefault();
    }
    if (c && k.shift && k.key.toLowerCase() === 'i') {
      win.webContents.send('cmd', 'devtools');
      e.preventDefault();
    }
    if (c && k.shift && k.key.toLowerCase() === 'r') {
      win.webContents.send('cmd', 'hard-reload');
      e.preventDefault();
    }
    if (c && k.shift && k.key.toLowerCase() === 'c') {
      win.webContents.send('cmd', 'copy-url');
      e.preventDefault();
    }
  });
}
const downloads = [];
const downloadItems = new Map();
const hookedSessions = new WeakSet();
let appSettings = { ...DEFAULT_SETTINGS };
let blockedTrackerCount = 0;

function getSettings(userId = activeUserId) {
  if (!userId) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...read(userPaths(userId).settings, {}) };
}

function pwKey(userId = activeUserId) {
  return deriveLocalKey(userId, machineFingerprint());
}

function buildSyncPayload(userId = activeUserId) {
  const paths = userPaths(userId);
  const key = pwKey(userId);
  const pwDoc = loadPasswordDoc(read, userDir, userId);
  return {
    bookmarks: read(paths.bookmarks, []),
    settings: getSettings(userId),
    privacy: getPrivacyDoc(userId),
    sessions: read(paths.session, null),
    passwords: exportPlain(pwDoc, key),
  };
}

function applySyncImport(data, userId = activeUserId) {
  const paths = userPaths(userId);
  if (data.bookmarks) write(paths.bookmarks, data.bookmarks);
  if (data.settings) {
    appSettings = { ...DEFAULT_SETTINGS, ...data.settings };
    write(paths.settings, appSettings);
    applySecureDns(appSettings);
    restartSyncFolderWatch(appSettings);
  }
  if (data.privacy) savePrivacyDoc(data.privacy, userId);
  if (data.sessions) write(paths.session, data.sessions);
  if (data.passwords) {
    const key = pwKey(userId);
    const pwDoc = loadPasswordDoc(read, userDir, userId);
    importPlain(pwDoc, data.passwords, key);
    savePasswordDoc(write, userDir, userId, pwDoc);
  }
}

function applySecureDns(settings = getSettings()) {
  try {
    if (!settings.secureDns || settings.secureDns === 'off') {
      app.configureHostResolver({ secureDnsMode: 'off' });
      return;
    }
    let servers = DNS_PRESETS[settings.secureDns];
    if (settings.secureDns === 'custom') {
      const custom = String(settings.secureDnsCustom || '').trim();
      if (!custom) {
        app.configureHostResolver({ secureDnsMode: 'off' });
        return;
      }
      servers = [custom.includes('://') ? custom : `https://${custom}`];
    }
    if (!servers?.length) {
      app.configureHostResolver({ secureDnsMode: 'off' });
      return;
    }
    app.configureHostResolver({
      secureDnsMode: 'secure',
      secureDnsServers: servers,
    });
  } catch (e) {
    console.error('[secure-dns]', e);
  }
}

function stopSyncFolderWatch() {
  if (syncFolderWatcher) {
    try { syncFolderWatcher.close(); } catch { /* ignore */ }
    syncFolderWatcher = null;
  }
}

function restartSyncFolderWatch(settings = getSettings()) {
  stopSyncFolderWatch();
  const folder = String(settings.syncFolder || '').trim();
  if (!settings.syncWatchFolder || !folder || !fs.existsSync(folder)) return;
  const vaultPath = path.join(folder, SYNC_VAULT_NAME);
  try {
    if (fs.existsSync(vaultPath)) {
      lastSyncFolderMtime = fs.statSync(vaultPath).mtimeMs;
    }
    syncFolderWatcher = fs.watch(folder, () => {
      if (!fs.existsSync(vaultPath)) return;
      const stat = fs.statSync(vaultPath);
      if (stat.mtimeMs <= lastSyncFolderMtime) return;
      lastSyncFolderMtime = stat.mtimeMs;
      mainWin?.webContents.send('sync-folder-changed', {
        path: vaultPath,
        mtime: stat.mtimeMs,
      });
    });
  } catch (e) {
    console.error('[sync-folder-watch]', e);
  }
}

function permissionLabel(permission) {
  return ({
    geolocation: 'use your location',
    media: 'use your camera and/or microphone',
    notifications: 'send notifications',
  })[permission] || permission;
}

function permissionHost(url) {
  try { return new URL(url).hostname; } catch { return url || 'This site'; }
}

function promptPermission(permission, url) {
  if (!mainWin) return false;
  const site = permissionHost(url);
  const { response } = dialog.showMessageBoxSync(mainWin, {
    type: 'question',
    buttons: ['Allow', 'Block'],
    defaultId: 0,
    cancelId: 1,
    title: 'Permission request',
    message: `${site} wants to ${permissionLabel(permission)}`,
    detail: url ? `Origin: ${url}` : '',
    noLink: true,
  });
  return response === 0;
}

function notifyPermissionBlocked(permission, url) {
  mainWin?.webContents.send('permission-blocked', { permission, url });
}

function hookDownloads(ses) {
  if (hookedSessions.has(ses)) return;
  hookedSessions.add(ses);
  ses.on('will-download', (_, item) => {
    const savePath = path.join(os.homedir(), 'Downloads', item.getFilename());
    item.setSavePath(savePath);
    const dl = {
      id: Date.now(),
      filename: item.getFilename(),
      url: item.getURL(),
      path: savePath,
      state: 'progressing',
      received: 0,
      total: item.getTotalBytes(),
      paused: false,
    };
    downloadItems.set(dl.id, item);
    downloads.unshift(dl);
    mainWin?.webContents.send('dl-start', dl);
    item.on('updated', (_, st) => {
      dl.state = st;
      dl.received = item.getReceivedBytes();
      dl.total = item.getTotalBytes();
      dl.paused = item.isPaused();
      mainWin?.webContents.send('dl-update', {
        id: dl.id, state: st, received: dl.received, total: dl.total, paused: dl.paused,
      });
    });
    item.once('done', (_, st) => {
      dl.state = st;
      dl.paused = false;
      downloadItems.delete(dl.id);
      mainWin?.webContents.send('dl-done', { id: dl.id, state: st, path: savePath });
    });
  });
}

function syncNativeTheme(_theme) {
  // Enigma chrome theme is CSS-only — never propagate to Chromium / web pages.
  nativeTheme.themeSource = 'light';
}

/** Read OS dark preference without leaving web content on system/dark scheme. */
function readOsPrefersDark() {
  const prev = nativeTheme.themeSource;
  nativeTheme.themeSource = 'system';
  const dark = nativeTheme.shouldUseDarkColors;
  nativeTheme.themeSource = 'light';
  return dark;
}

const webContentsLightHooked = new WeakSet();

function hookWebviewColorScheme() {
  /* disabled — debugger attach on guest pages caused blank renders */
}

let osThemeWatchTimer = null;
function syncOsThemeWatcher(theme) {
  if (osThemeWatchTimer) {
    clearInterval(osThemeWatchTimer);
    osThemeWatchTimer = null;
  }
  if (theme !== 'system') return;
  let last = readOsPrefersDark();
  osThemeWatchTimer = setInterval(() => {
    if (getSettings().theme !== 'system') return;
    const dark = readOsPrefersDark();
    if (dark !== last) {
      last = dark;
      mainWin?.webContents.send('os-theme-changed', dark);
    }
  }, 1500);
}

function buildEffectiveSettings(sessionId = null) {
  const global = getSettings();
  const privacy = getPrivacyDoc();
  const sessCfg = sessionId ? getSessionConfig(activeUserId, sessionId) : {};
  return effectiveSettings(global, privacy, sessCfg.privacy || {});
}

function applySessionPolicy(ses, sessionId = null, ephemeral = false) {
  const onBlocked = () => {
    blockedTrackerCount++;
    if (sessionId) {
      const key = sessionKey(activeUserId, sessionId);
      sessionBlockedCounts.set(key, (sessionBlockedCounts.get(key) || 0) + 1);
      mainWin?.webContents.send('session-blocked', {
        sessionId,
        count: sessionBlockedCounts.get(key),
      });
    }
    mainWin?.webContents.send('tracker-blocked', blockedTrackerCount);
  };
  hardenSession(
    ses,
    () => buildEffectiveSettings(sessionId),
    notifyPermissionBlocked,
    onBlocked,
    promptPermission,
  );
  hookDownloads(ses);
  if (sessionId) {
    const cfg = getSessionConfig(activeUserId, sessionId);
    if (cfg.proxy) void applyProxy(ses, cfg.proxy);
  }
}

function createSplash() {
  splashWin = new BrowserWindow({
    width: 440, height: 280, frame: false, transparent: true,
    alwaysOnTop: true, resizable: false, center: true, skipTaskbar: true,
    icon: APP_ICON,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  splashWin.loadFile(path.join(__dirname, '../assets/splash.html'));
}

function createBrowserWindow(opts = {}) {
  const { x, y, boot, isPrimary = false } = opts;
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    x: Number.isFinite(x) ? x : undefined,
    y: Number.isFinite(y) ? y : undefined,
    width: Math.min(1440, width),
    height: Math.min(920, height),
    minWidth: 900, minHeight: 600,
    show: !isPrimary,
    frame: false,
    backgroundColor: '#0d0b18',
    icon: APP_ICON,
    title: 'Enigma',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: true,
      spellcheck: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  browserWindows.add(win);
  if (isPrimary || !mainWin || mainWin.isDestroyed()) mainWin = win;

  const winId = win.id;
  const wcId = win.webContents.id;

  if (boot) pendingBoots.set(wcId, boot);

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (process.platform === 'win32' && !APP_ICON.isEmpty()) win.setIcon(APP_ICON);
  win.loadFile(path.join(__dirname, '../assets/index.html'));

  if (isPrimary) {
    win.once('ready-to-show', () => {
      setTimeout(() => {
        splashWin?.destroy();
        splashWin = null;
        win.show();
        win.focus();
      }, 1400);
    });
  } else {
    win.once('ready-to-show', () => {
      win.show();
      win.focus();
    });
  }

  attachWindowShortcuts(win);
  win.on('maximize', () => sendWin(win, 'win-state', 'maximized'));
  win.on('unmaximize', () => sendWin(win, 'win-state', 'normal'));
  win.on('close', (e) => {
    if (windowCloseAllowed.has(winId)) {
      windowCloseAllowed.delete(winId);
      return;
    }
    e.preventDefault();
    sendWin(win, 'window-close-request');
  });
  win.on('closed', () => {
    browserWindows.delete(win);
    windowSessions.delete(winId);
    pendingBoots.delete(wcId);
    tabBarBounds.delete(winId);
    persistMergedSessions();
    if (mainWin === win) mainWin = getMainWin();
    broadcastToWindows('tab-merge-highlight', { active: false });
  });

  if (isPrimary) {
    hookWebviewColorScheme();
    initUpdater(() => getMainWin(), {
      hasActiveDownloads: () => downloads.some(d => d.state === 'progressing'),
      shouldCheckUpdates: () => getSettings().checkUpdates !== false,
    });
    win.webContents.once('did-finish-load', () => {
      if (win.isDestroyed() || !app.isPackaged || getSettings().checkUpdates === false) return;
      checkForUpdates().then((result) => {
        if (win.isDestroyed() || !result) return;
        if (result.failedInstall) win.webContents.send('update-install-failed', result);
        else if (result.available) win.webContents.send('update-available', result);
      }).catch(() => {});
    });
    ensureUsersMigrated();
    const reg = getRegistry();
    if (reg.activeUserId) setActiveUser(reg.activeUserId);
  }

  return win;
}

function createMain() {
  createBrowserWindow({ isPrimary: true });
}

// ── IPC: window chrome ────────────────────────────────────────────────────────
ipcMain.handle('win-min', (e) => winFromEvent(e)?.minimize());
ipcMain.handle('win-max', (e) => {
  const win = winFromEvent(e);
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
ipcMain.handle('win-close', (e) => winFromEvent(e)?.close());
ipcMain.handle('confirm-window-close', (e, allow) => {
  const win = winFromEvent(e);
  if (!win) return false;
  if (allow) {
    windowCloseAllowed.add(win.id);
    win.close();
  }
  return true;
});
ipcMain.handle('win-is-max', (e) => winFromEvent(e)?.isMaximized() ?? false);
ipcMain.handle('open-devtools', (e) => winFromEvent(e)?.webContents.openDevTools({ mode: 'detach' }));
ipcMain.handle('get-window-boot', (e) => {
  const boot = pendingBoots.get(e.sender.id);
  if (boot) pendingBoots.delete(e.sender.id);
  return boot || null;
});
ipcMain.handle('open-detached-window', (_, payload = {}) => {
  const px = Number(payload.x);
  const py = Number(payload.y);
  const point = {
    x: Number.isFinite(px) ? px : screen.getPrimaryDisplay().workArea.x + 80,
    y: Number.isFinite(py) ? py : screen.getPrimaryDisplay().workArea.y + 80,
  };
  const display = screen.getDisplayNearestPoint(point);
  const wx = Math.max(display.workArea.x, point.x - 140);
  const wy = Math.max(display.workArea.y, point.y - 48);
  createBrowserWindow({ x: wx, y: wy, boot: payload, isPrimary: false });
  return true;
});
ipcMain.handle('register-tabbar-bounds', (e, bounds) => {
  const win = winFromEvent(e);
  if (!win || !bounds) return false;
  tabBarBounds.set(win.id, bounds);
  return true;
});
ipcMain.handle('find-merge-target', (e, point) => {
  const self = winFromEvent(e);
  let found = null;
  if (point && typeof point.x === 'number' && typeof point.y === 'number') {
    for (const [id, bounds] of tabBarBounds) {
      if (self && id === self.id) continue;
      if (pointInRect(point, bounds)) found = id;
    }
  }
  for (const w of browserWindows) {
    sendWin(w, 'tab-merge-highlight', { active: w.id === found });
  }
  return found;
});
ipcMain.handle('clear-merge-highlight', () => {
  broadcastToWindows('tab-merge-highlight', { active: false });
  return true;
});
ipcMain.on('tab-drag-start', () => {
  broadcastToWindows('report-tabbar-bounds');
});
ipcMain.handle('merge-tab-to-window', (e, { targetWinId, payload }) => {
  const targetWin = BrowserWindow.fromId(Number(targetWinId));
  if (!targetWin || targetWin.isDestroyed()) return false;
  sendWin(targetWin, 'tab-merge-in', payload);
  return true;
});

// ── IPC: users ────────────────────────────────────────────────────────────────
ipcMain.handle('users-init', () => {
  ensureUsersMigrated();
  const reg = getRegistry();
  if (reg.onboardingComplete && reg.activeUserId) setActiveUser(reg.activeUserId);
  return {
    ...reg,
    needsOnboarding: !reg.onboardingComplete,
    appVersion: app.getVersion(),
  };
});

ipcMain.handle('onboarding-complete', (_, { mode, name, color, starterSessions }) => {
  const reg = getRegistry();
  if (reg.onboardingComplete) {
    return { ...reg, needsOnboarding: false, appVersion: app.getVersion() };
  }
  const id = `u_${Date.now()}`;
  const displayName = (name || '').trim() || (mode === 'guest' ? 'Guest' : 'User');
  const accent = color || '#8b5cf6';
  userDir(id);
  seedUserFiles(id, { name: displayName, color: accent, type: mode === 'guest' ? 'guest' : 'account' });
  if (starterSessions !== false) {
    write(userPaths(id).session, starterSessionsSeed(accent));
  }
  const next = {
    activeUserId: id,
    onboardingComplete: true,
    users: [{
      id,
      name: displayName,
      color: accent,
      type: mode === 'guest' ? 'guest' : 'account',
      created: Date.now(),
    }],
  };
  saveRegistry(next);
  setActiveUser(id);
  return { ...next, needsOnboarding: false, appVersion: app.getVersion() };
});

ipcMain.handle('users-switch', (_, userId) => {
  const reg = getRegistry();
  if (!reg.users.some(u => u.id === userId)) return null;
  reg.activeUserId = userId;
  saveRegistry(reg);
  setActiveUser(userId);
  return { activeUserId: userId, users: reg.users };
});

ipcMain.handle('users-create', (_, payload = {}) => {
  const reg = getRegistry();
  const id = `u_${Date.now()}`;
  const name = (payload.name || '').trim() || 'User';
  const color = payload.color || '#8b5cf6';
  const avatar = (payload.avatar || '').trim().slice(0, 4) || '';
  const theme = payload.theme || DEFAULT_SETTINGS.theme;
  const searchEngine = payload.searchEngine || DEFAULT_SETTINGS.searchEngine;
  const homepage = (payload.homepage || '').trim() || DEFAULT_SETTINGS.homepage;
  const privacyPreset = ['strict', 'relaxed', 'balanced'].includes(payload.privacyPreset)
    ? payload.privacyPreset
    : 'balanced';
  const starterSession = payload.starterSession && typeof payload.starterSession === 'object'
    ? payload.starterSession
    : null;

  reg.users.push({
    id,
    name,
    color,
    avatar,
    type: 'account',
    created: Date.now(),
  });
  reg.activeUserId = id;
  reg.onboardingComplete = true;
  saveRegistry(reg);
  userDir(id);
  seedUserFiles(id, {
    name,
    color,
    type: 'account',
    privacyPreset,
    starterSession,
    settings: {
      theme,
      searchEngine,
      homepage,
      showClock: payload.showClock !== false,
      compactTabs: !!payload.compactTabs,
      restoreSession: !!payload.restoreSession,
      checkUpdates: payload.checkUpdates !== false,
    },
  });
  setActiveUser(id);
  return { id, name, color, avatar, users: reg.users };
});

ipcMain.handle('users-remove', async (_, userId) => {
  const reg = getRegistry();
  if (reg.users.length <= 1 || !reg.users.some(u => u.id === userId)) return null;
  reg.users = reg.users.filter(u => u.id !== userId);
  if (reg.activeUserId === userId) reg.activeUserId = reg.users[0].id;
  saveRegistry(reg);
  setActiveUser(reg.activeUserId);
  try {
    const dir = path.join(USERS_ROOT, userId);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) { console.error('[users-remove]', e); }
  return reg;
});

ipcMain.handle('user-main-partition', () => mainPartition());

// ── IPC: sessions (scoped to active user) ─────────────────────────────────────
ipcMain.handle('session-register', async (_, id, config) => {
  const cfg = config || {};
  sessionConfigs.set(sessionKey(activeUserId, id), cfg);
  const ephemeral = !!cfg.ephemeral;
  const ses = session.fromPartition(sessionPartition(activeUserId, id, ephemeral));
  applySessionPolicy(ses, id, ephemeral);
  if (cfg.proxy) await applyProxy(ses, cfg.proxy);
  return true;
});

ipcMain.handle('session-create', async (_, id, config) => {
  const cfg = typeof config === 'boolean' ? { ephemeral: config } : (config || {});
  const ephemeral = !!cfg.ephemeral;
  sessionConfigs.set(sessionKey(activeUserId, id), cfg);
  const partition = sessionPartition(activeUserId, id, ephemeral);
  const ses = session.fromPartition(partition);
  applySessionPolicy(ses, id, ephemeral);
  if (cfg.proxy) await applyProxy(ses, cfg.proxy);
  return partition;
});

ipcMain.handle('session-clear', async (_, id, ephemeral) => {
  try {
    const ses = session.fromPartition(sessionPartition(activeUserId, id, ephemeral));
    await ses.clearStorageData();
    await ses.clearCache();
    await ses.clearAuthCache();
  } catch {}
  return true;
});

ipcMain.handle('session-burn', async (_, id, ephemeral) => {
  const key = sessionKey(activeUserId, id);
  try {
    const ses = session.fromPartition(sessionPartition(activeUserId, id, ephemeral));
    await ses.clearStorageData();
    await ses.clearCache();
    await ses.clearAuthCache();
    await ses.clearCodeCaches?.();
  } catch {}
  sessionBlockedCounts.set(key, 0);
  blockedTrackerCount = 0;
  return true;
});

ipcMain.handle('session-stats', async (_, id, ephemeral) => {
  const ses = session.fromPartition(sessionPartition(activeUserId, id, ephemeral));
  let cookies = [];
  let cacheBytes = 0;
  try { cookies = await ses.cookies.get({}); } catch {}
  try { cacheBytes = await ses.getCacheSize(); } catch {}
  const origins = [...new Set(cookies.map(c => String(c.domain || '').replace(/^\./, '')))].filter(Boolean).slice(0, 40);
  const key = sessionKey(activeUserId, id);
  return {
    cookies: cookies.length,
    origins,
    cacheBytes,
    blocked: sessionBlockedCounts.get(key) || 0,
    filterRules: sharedEngine.domainRules.size,
  };
});

function hostMatchesCookie(host, domain) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  const d = String(domain || '').toLowerCase().replace(/^\./, '');
  if (!h || !d) return false;
  return h === d || h.endsWith('.' + d) || d.endsWith(h);
}

ipcMain.handle('site-data-get', async (_, { sessionId, host, ephemeral }) => {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  if (!h) return { cookies: 0, origins: [], permissions: [] };
  const ses = session.fromPartition(sessionPartition(activeUserId, sessionId, ephemeral));
  let cookies = [];
  try { cookies = await ses.cookies.get({}); } catch {}
  const matched = cookies.filter(c => hostMatchesCookie(h, c.domain));
  const origins = [...new Set(matched.map(c => String(c.domain || '').replace(/^\./, '')))].filter(Boolean);
  const permissions = [];
  for (const perm of ['media', 'geolocation', 'notifications', 'midi', 'pointerLock']) {
    try {
      const st = ses.getPermissionStatus?.({ permission: perm, requestingOrigin: `https://${h}` });
      const status = typeof st === 'string' ? st : st?.state;
      if (status && status !== 'prompt' && status !== 'unknown') permissions.push({ permission: perm, status });
    } catch {}
  }
  return { cookies: matched.length, origins, permissions };
});

ipcMain.handle('site-data-clear', async (_, { sessionId, host, ephemeral }) => {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  if (!h) return false;
  const ses = session.fromPartition(sessionPartition(activeUserId, sessionId, ephemeral));
  const origins = [`https://${h}`, `http://${h}`, `https://www.${h}`, `http://www.${h}`];
  for (const origin of origins) {
    try { await ses.clearStorageData({ origin }); } catch {}
  }
  try {
    const cookies = await ses.cookies.get({});
    for (const c of cookies) {
      if (hostMatchesCookie(h, c.domain)) {
        const scheme = c.secure ? 'https' : 'http';
        const domain = String(c.domain || '').replace(/^\./, '');
        const url = `${scheme}://${domain}${c.path || '/'}`;
        await ses.cookies.remove(url, c.name);
      }
    }
  } catch {}
  return true;
});

ipcMain.handle('browsers-detect', () => detectBrowsers());

ipcMain.handle('import-browser-data', (_, browserId, opts = {}) => {
  const profileId = opts.profileId || 'Default';
  return importFromBrowser(browserId, profileId, opts);
});

ipcMain.handle('session-blocked-count', (_, id) => sessionBlockedCounts.get(sessionKey(activeUserId, id)) || 0);

ipcMain.handle('session-templates', () => listTemplates());

ipcMain.handle('fingerprint-script', () => FINGERPRINT_INJECT);

ipcMain.handle('session-apply-settings', () => {
  appSettings = getSettings();
  applySessionPolicy(session.fromPartition(mainPartition()));
  for (const [key, cfg] of sessionConfigs.entries()) {
    if (!key.startsWith(`${activeUserId}:`)) continue;
    const sessionId = key.slice(activeUserId.length + 1);
    const ses = session.fromPartition(sessionPartition(activeUserId, sessionId, !!cfg.ephemeral));
    applySessionPolicy(ses, sessionId, !!cfg.ephemeral);
  }
  return true;
});

ipcMain.handle('privacy-load', () => getPrivacyDoc());
ipcMain.handle('privacy-save', (_, doc) => { savePrivacyDoc(doc); return true; });
ipcMain.handle('site-exception-set', (_, host, action) => {
  const doc = getPrivacyDoc();
  const h = String(host || '').toLowerCase().replace(/^\./, '');
  if (!h) return doc;
  if (!action) delete doc.siteExceptions[h];
  else doc.siteExceptions[h] = action;
  savePrivacyDoc(doc);
  return doc;
});

ipcMain.handle('sync-export', (_, passphrase) => {
  if (!passphrase || String(passphrase).length < 8) throw new Error('Passphrase must be at least 8 characters');
  return encryptVault(passphrase, buildSyncPayload());
});

ipcMain.handle('sync-import', (_, passphrase, vault) => {
  const data = decryptVault(passphrase, vault);
  applySyncImport(data);
  return data;
});

ipcMain.handle('sync-export-file', async (_, passphrase) => {
  if (!passphrase || String(passphrase).length < 8) throw new Error('Passphrase must be at least 8 characters');
  const vault = encryptVault(passphrase, buildSyncPayload());
  const r = await dialog.showSaveDialog(mainWin, {
    title: 'Export encrypted vault',
    defaultPath: 'enigma-vault.json',
    filters: [{ name: 'Enigma Vault', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, JSON.stringify(vault, null, 2));
  return r.filePath;
});

ipcMain.handle('sync-import-file', async (_, passphrase) => {
  const r = await dialog.showOpenDialog(mainWin, {
    title: 'Import encrypted vault',
    filters: [{ name: 'Enigma Vault', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths?.[0]) return null;
  const vault = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
  const data = decryptVault(passphrase, vault);
  applySyncImport(data);
  return data;
});

ipcMain.handle('sync-folder-pick', async () => {
  const r = await dialog.showOpenDialog(mainWin, {
    title: 'Choose sync folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled || !r.filePaths?.[0] ? null : r.filePaths[0];
});

ipcMain.handle('sync-folder-export', async (_, passphrase) => {
  if (!passphrase || String(passphrase).length < 8) throw new Error('Passphrase must be at least 8 characters');
  const folder = String(getSettings().syncFolder || '').trim();
  if (!folder) throw new Error('No sync folder configured');
  fs.mkdirSync(folder, { recursive: true });
  const vault = encryptVault(passphrase, buildSyncPayload());
  const dest = path.join(folder, SYNC_VAULT_NAME);
  fs.writeFileSync(dest, JSON.stringify(vault, null, 2));
  lastSyncFolderMtime = fs.statSync(dest).mtimeMs;
  return dest;
});

ipcMain.handle('sync-folder-import', async (_, passphrase) => {
  if (!passphrase || String(passphrase).length < 8) throw new Error('Passphrase must be at least 8 characters');
  const folder = String(getSettings().syncFolder || '').trim();
  if (!folder) throw new Error('No sync folder configured');
  const src = path.join(folder, SYNC_VAULT_NAME);
  if (!fs.existsSync(src)) throw new Error('No enigma-vault.json in sync folder');
  const vault = JSON.parse(fs.readFileSync(src, 'utf8'));
  const data = decryptVault(passphrase, vault);
  applySyncImport(data);
  lastSyncFolderMtime = fs.statSync(src).mtimeMs;
  return src;
});

ipcMain.handle('password-bridge-script', () => {
  const p = path.join(__dirname, '../assets/password-bridge.js');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
});

ipcMain.handle('passwords-for-host', (_, sessionId, host) => {
  const doc = loadPasswordDoc(read, userDir, activeUserId);
  return listForHost(doc, sessionId || 'default', host, pwKey());
});

ipcMain.handle('passwords-for-session', (_, sessionId) => {
  const doc = loadPasswordDoc(read, userDir, activeUserId);
  return listBySession(doc, sessionId || 'default', pwKey()).map(({ password, ...rest }) => rest);
});

ipcMain.handle('passwords-save', (_, entry) => {
  const doc = loadPasswordDoc(read, userDir, activeUserId);
  const saved = upsertEntry(doc, entry, pwKey());
  savePasswordDoc(write, userDir, activeUserId, doc);
  return { id: saved.id, host: saved.host, username: saved.username };
});

ipcMain.handle('passwords-remove', (_, id) => {
  const doc = loadPasswordDoc(read, userDir, activeUserId);
  const ok = removeEntry(doc, id);
  if (ok) savePasswordDoc(write, userDir, activeUserId, doc);
  return ok;
});

ipcMain.handle('validate-url', (_, url) => isNavigableUrl(url));

// ── IPC: data (scoped to active user) ─────────────────────────────────────────
ipcMain.handle('history-load', () => {
  const p = userPaths().history;
  const h = read(p, []);
  const seen = new Set();
  const compact = [];
  for (const item of h) {
    if (!item?.url || seen.has(item.url)) continue;
    seen.add(item.url);
    compact.push(item);
  }
  if (compact.length !== h.length) write(p, compact);
  return compact;
});
ipcMain.handle('history-add', (_, e) => {
  const url = e?.url;
  if (!url || url.startsWith('about:')) return;
  const p = userPaths().history;
  const h = read(p, []);
  const filtered = h.filter(x => x.url !== url);
  filtered.unshift({ ...e, ts: Date.now() });
  write(p, filtered.slice(0, 8000));
});
ipcMain.handle('history-clear', () => write(userPaths().history, []));
ipcMain.handle('history-delete', (_, url) => {
  const p = userPaths().history;
  write(p, read(p, []).filter(h => h.url !== url));
});
ipcMain.handle('bm-load', () => read(userPaths().bookmarks, []));
ipcMain.handle('bm-save', (_, d) => write(userPaths().bookmarks, d));
ipcMain.handle('settings-load', () => getSettings());
ipcMain.handle('settings-save', (_, d) => {
  appSettings = { ...DEFAULT_SETTINGS, ...d };
  write(userPaths().settings, appSettings);
  syncNativeTheme(appSettings.theme);
  syncOsThemeWatcher(appSettings.theme);
  applySecureDns(appSettings);
  restartSyncFolderWatch(appSettings);
  return true;
});
ipcMain.handle('os-prefers-dark', () => readOsPrefersDark());
ipcMain.handle('dl-list', () => downloads);
ipcMain.handle('dl-pause', (_, id) => {
  const item = downloadItems.get(id);
  if (!item || item.isPaused()) return false;
  item.pause();
  return true;
});
ipcMain.handle('dl-resume', (_, id) => {
  const item = downloadItems.get(id);
  if (!item || !item.canResume()) return false;
  item.resume();
  return true;
});
ipcMain.handle('dl-cancel', (_, id) => {
  const item = downloadItems.get(id);
  if (!item) return false;
  item.cancel();
  return true;
});
ipcMain.handle('dl-remove', (_, id) => {
  const idx = downloads.findIndex(d => d.id === id);
  if (idx >= 0) downloads.splice(idx, 1);
  downloadItems.delete(id);
  return true;
});
ipcMain.handle('session-save', (e, d) => {
  const win = winFromEvent(e);
  if (win) windowSessions.set(win.id, d);
  persistMergedSessions();
  return true;
});
ipcMain.handle('session-load', () => read(userPaths().session, null));
ipcMain.handle('notes-load', () => {
  try { return fs.readFileSync(userPaths().notes, 'utf8'); } catch { return ''; }
});
ipcMain.handle('notes-save', (_, text) => {
  try { fs.writeFileSync(userPaths().notes, text || ''); } catch (e) { console.error(e); }
  return true;
});
ipcMain.handle('blocked-count', () => blockedTrackerCount);
ipcMain.handle('blocked-reset', () => { blockedTrackerCount = 0; return 0; });
ipcMain.handle('clear-browsing-data', async () => {
  const ses = session.fromPartition(mainPartition());
  await ses.clearStorageData();
  await ses.clearCache();
  return true;
});
ipcMain.handle('export-bookmarks', async (_, data) => {
  const r = await dialog.showSaveDialog(mainWin, {
    title: 'Export bookmarks',
    defaultPath: 'enigma-bookmarks.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, JSON.stringify(data, null, 2));
  return r.filePath;
});
ipcMain.handle('import-bookmarks', async () => {
  const r = await dialog.showOpenDialog(mainWin, {
    title: 'Import bookmarks',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths?.[0]) return null;
  try { return JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); } catch { return null; }
});
ipcMain.handle('save-screenshot', (_, data) => {
  const p = path.join(os.homedir(), 'Downloads', `Enigma-${Date.now()}.png`);
  const buf = Buffer.isBuffer(data)
    ? data
    : Array.isArray(data)
      ? Buffer.from(data)
      : Buffer.from(String(data || ''), 'base64');
  fs.writeFileSync(p, buf);
  return p;
});
ipcMain.handle('print-webview', (_, id) => new Promise((resolve, reject) => {
  const wc = webContents.fromId(Number(id));
  if (!wc || wc.isDestroyed()) {
    reject(new Error('Page not ready'));
    return;
  }
  wc.print({ printBackground: true, silent: false }, (ok, err) => {
    if (ok) resolve(true);
    else reject(new Error(err || 'Print failed'));
  });
}));
ipcMain.handle('capture-webview', async (_, id, opts = {}) => {
  const wc = webContents.fromId(Number(id));
  if (!wc || wc.isDestroyed()) throw new Error('Page not ready');

  const viewW = Math.max(1, Math.round(Number(opts.width) || 0));
  const viewH = Math.max(1, Math.round(Number(opts.height) || 0));

  const pageSize = await wc.executeJavaScript(`({
    w: Math.max(document.documentElement.clientWidth || window.innerWidth || 0, 1),
    h: Math.max(document.documentElement.clientHeight || window.innerHeight || 0, 1),
  })`, true).catch(() => ({ w: viewW || 1280, h: viewH || 720 }));

  const rects = [];
  if (viewW > 1 && viewH > 1) rects.push({ x: 0, y: 0, width: viewW, height: viewH });
  if (pageSize?.w && pageSize?.h) {
    rects.push({
      x: 0,
      y: 0,
      width: Math.min(Math.round(pageSize.w), 4096),
      height: Math.min(Math.round(pageSize.h), 8192),
    });
  }
  rects.push(null);

  for (const rect of rects) {
    try {
      const img = rect ? await wc.capturePage(rect) : await wc.capturePage();
      const png = img.toPNG();
      const size = img.getSize?.() || {};
      if (png?.length > 2000 && (size.width || 0) > 8 && (size.height || 0) > 8) {
        return png.toString('base64');
      }
    } catch { /* try next capture mode */ }
  }
  throw new Error('Capture returned blank image');
});

ipcMain.handle('search-suggest', async (_, q) => {
  const query = String(q || '').trim();
  if (query.length < 2 || query.includes('://')) return [];
  try {
    const res = await fetch(`https://ac.duckduckgo.com/ac/?q=${encodeURIComponent(query)}&type=list`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.[1]) ? data[1].slice(0, 4) : [];
  } catch {
    return [];
  }
});

ipcMain.handle('ext-list', () => loadExtensions(read, userDir, activeUserId).items);
ipcMain.handle('ext-add', async () => {
  const r = await dialog.showOpenDialog(mainWin, {
    title: 'Select unpacked extension folder',
    properties: ['openDirectory'],
  });
  if (r.canceled || !r.filePaths?.[0]) return null;
  const extPath = r.filePaths[0];
  const manifest = readManifest(extPath);
  if (!manifest) throw new Error('Invalid extension — manifest.json not found');
  const doc = loadExtensions(read, userDir, activeUserId);
  const item = {
    id: `ext_${Date.now()}`,
    name: manifest.name || path.basename(extPath),
    path: extPath,
    version: manifest.version || '1.0',
    enabled: true,
  };
  doc.items.push(item);
  saveExtensions(write, userDir, activeUserId, doc);
  await reloadUserExtensions();
  for (const [key] of sessionConfigs) {
    const sid = key.split(':').pop();
    const cfg = sessionConfigs.get(key) || {};
    await applyExtensionsForSession(sid, !!cfg.ephemeral);
  }
  return item;
});
ipcMain.handle('ext-remove', async (_, id) => {
  const doc = loadExtensions(read, userDir, activeUserId);
  doc.items = doc.items.filter(x => x.id !== id);
  saveExtensions(write, userDir, activeUserId, doc);
  await reloadUserExtensions();
  for (const [key] of sessionConfigs) {
    const sid = key.split(':').pop();
    const cfg = sessionConfigs.get(key) || {};
    await applyExtensionsForSession(sid, !!cfg.ephemeral);
  }
  return true;
});
ipcMain.handle('ext-toggle', async (_, id, enabled) => {
  const doc = loadExtensions(read, userDir, activeUserId);
  const item = doc.items.find(x => x.id === id);
  if (!item) return false;
  item.enabled = !!enabled;
  saveExtensions(write, userDir, activeUserId, doc);
  await reloadUserExtensions();
  for (const [key] of sessionConfigs) {
    const sid = key.split(':').pop();
    const cfg = sessionConfigs.get(key) || {};
    await applyExtensionsForSession(sid, !!cfg.ephemeral);
  }
  return true;
});

// ── IPC: misc ─────────────────────────────────────────────────────────────────
ipcMain.handle('open-file', (_, p) => shell.openPath(p));
ipcMain.handle('open-external', (_, u) => {
  if (!isSafeExternalUrl(u)) return false;
  shell.openExternal(u);
  return true;
});
ipcMain.handle('clipboard', (_, t) => clipboard.writeText(t));
ipcMain.handle('app-version', () => app.getVersion());
ipcMain.handle('app-icon-url', () => {
  const candidates = [];
  if (app.isPackaged) {
    candidates.push(
      path.join(process.resourcesPath, 'icons', 'icon_256.png'),
      path.join(process.resourcesPath, 'icons', 'icon_128.png'),
      path.join(process.resourcesPath, 'icons', 'icon.png'),
      path.join(process.resourcesPath, 'icons', 'icon.ico'),
    );
  }
  candidates.push(
    path.join(__dirname, '../assets/icons/icon_256.png'),
    path.join(__dirname, '../assets/icons/icon_128.png'),
    path.join(__dirname, '../assets/icons/icon.png'),
  );
  for (const iconPath of candidates) {
    if (fs.existsSync(iconPath)) {
      return `file://${iconPath.replace(/\\/g, '/')}`;
    }
  }
  return null;
});
ipcMain.handle('chromium-version', () => process.versions.chrome);
ipcMain.handle('electron-version', () => process.versions.electron);

ipcMain.handle('check-for-update', () => checkForUpdates());
ipcMain.handle('download-update', () => downloadUpdate());
ipcMain.handle('install-update', (_, opts) => installUpdate(opts || {}));
ipcMain.handle('quit-and-install', () => quitAndInstall());
ipcMain.handle('update-status', () => getUpdateStatus());
ipcMain.handle('open-update-page', (_, url) => { openReleasePage(url); return true; });
ipcMain.handle('app-install-info', () => getInstallInfo());
ipcMain.handle('has-active-downloads', () => downloads.some(d => d.state === 'progressing'));

ipcMain.handle('context-menu', (e, p) => {
  const win = winFromEvent(e);
  if (!win) return;
  const send = (ch, ...args) => { if (!win.isDestroyed()) win.webContents.send(ch, ...args); };
  const items = [];
  if (p.selectionText?.trim()) {
    items.push(
      { label: `Search "${p.selectionText.slice(0, 30)}"`, click: () => send('cmd', `search-selection:${p.selectionText}`) },
      { label: 'Copy', role: 'copy' },
      { type: 'separator' },
    );
  }
  if (p.linkURL) {
    items.push(
      { label: 'Open in new tab', click: () => send('open-link', p.linkURL) },
      { label: 'Open in incognito', click: () => send('open-link-incog', p.linkURL) },
      { label: 'Copy link', click: () => clipboard.writeText(p.linkURL) },
      { type: 'separator' },
    );
  }
  if (p.mediaType === 'image') {
    items.push(
      { label: 'Open image in new tab', click: () => send('open-link', p.srcURL) },
      { label: 'Copy image address', click: () => clipboard.writeText(p.srcURL) },
      { type: 'separator' },
    );
  }
  if (p.mediaType === 'video') {
    items.push(
      { label: 'Picture in Picture', click: () => send('cmd', 'pip') },
      { type: 'separator' },
    );
  }
  items.push(
    { label: 'Back', enabled: p.canBack, click: () => send('cmd', 'back') },
    { label: 'Forward', enabled: p.canFwd, click: () => send('cmd', 'fwd') },
    { label: 'Reload', click: () => send('cmd', 'reload') },
    { type: 'separator' },
    { label: 'Print…', click: () => send('cmd', 'print') },
    { type: 'separator' },
    { label: 'View page source', click: () => send('cmd', 'view-source') },
    { label: 'Inspect', click: () => send('cmd', 'devtools') },
  );
  Menu.buildFromTemplate(items).popup({ window: win });
});

// ── App lifecycle ─────────────────────────────────────────────────────────────
const lock = app.requestSingleInstanceLock();
if (!lock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = getMainWin();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    ensureMachineBinding();
    ensureUsersMigrated();
    const reg = getRegistry();
    if (reg.activeUserId) setActiveUser(reg.activeUserId);
    applySecureDns(getSettings());
    restartSyncFolderWatch(getSettings());
    syncNativeTheme(appSettings.theme);
    syncOsThemeWatcher(appSettings.theme);
    createSplash();
    createMain();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (browserWindows.size === 0) createMain(); });
}
