const {
  app, BrowserWindow, session, ipcMain, Menu, shell, clipboard, screen, nativeImage, nativeTheme, dialog
} = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { isSafeExternalUrl, isNavigableUrl, hardenSession } = require('./security');

app.setName('Enigma');
if (process.platform === 'win32') app.setAppUserModelId('app.enigmabrowser');

app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');

const DATA = app.getPath('userData');
const USERS_ROOT = path.join(DATA, 'users');
const REGISTRY_PATH = path.join(USERS_ROOT, 'registry.json');
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

function ensureUsersMigrated() {
  fs.mkdirSync(USERS_ROOT, { recursive: true });
  if (fs.existsSync(REGISTRY_PATH)) return;
  const userId = 'u_default';
  userDir(userId);
  const paths = userPaths(userId);
  for (const [key, legacy] of Object.entries(LEGACY_PATHS)) {
    const dest = paths[key];
    if (fs.existsSync(legacy) && !fs.existsSync(dest)) {
      try { fs.copyFileSync(legacy, dest); } catch (e) { console.error('[migrate]', key, e); }
    }
  }
  if (!fs.existsSync(paths.settings)) write(paths.settings, DEFAULT_SETTINGS);
  if (!fs.existsSync(paths.session)) {
    write(paths.session, {
      profiles: [{ id: 'default', name: 'Main', color: '#8b5cf6', isIncognito: false, ephemeral: false, partition: null }],
      activePid: 'default',
      tabsByPid: {},
      activeTid: {},
    });
  }
  write(REGISTRY_PATH, {
    activeUserId: userId,
    users: [{ id: userId, name: 'You', color: '#8b5cf6', created: Date.now() }],
  });
}

function getRegistry() {
  ensureUsersMigrated();
  return read(REGISTRY_PATH, { activeUserId: 'u_default', users: [] });
}

function saveRegistry(reg) {
  write(REGISTRY_PATH, reg);
}

function setActiveUser(userId) {
  activeUserId = userId;
  appSettings = getSettings();
  applySessionPolicy(session.fromPartition(mainPartition(userId)));
}
const ICON_PATH = path.join(__dirname, '../assets/icons/icon.ico');
const APP_ICON  = nativeImage.createFromPath(ICON_PATH);

const DEFAULT_SETTINGS = {
  homepage: 'https://google.com',
  searchEngine: 'google',
  theme: 'dark',
  showClock: true,
  compactTabs: false,
  blockTrackers: true,
  httpsOnly: false,
  doNotTrack: true,
  blockPopups: true,
  restoreSession: true,
};

const read  = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } };
const write = (p, d)  => { try { fs.writeFileSync(p, JSON.stringify(d, null, 2)); } catch (e) { console.error(e); } };

let mainWin = null;
let splashWin = null;
const downloads = [];
const hookedSessions = new WeakSet();
let appSettings = { ...DEFAULT_SETTINGS };
let blockedTrackerCount = 0;

function getSettings() {
  return { ...DEFAULT_SETTINGS, ...read(userPaths().settings, {}) };
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
    };
    downloads.unshift(dl);
    mainWin?.webContents.send('dl-start', dl);
    item.on('updated', (_, st) => {
      dl.state = st;
      dl.received = item.getReceivedBytes();
      dl.total = item.getTotalBytes();
      mainWin?.webContents.send('dl-update', { id: dl.id, state: st, received: dl.received, total: dl.total });
    });
    item.once('done', (_, st) => {
      dl.state = st;
      mainWin?.webContents.send('dl-done', { id: dl.id, state: st, path: savePath });
    });
  });
}

function syncNativeTheme(theme) {
  if (theme === 'system') nativeTheme.themeSource = 'system';
  else if (theme === 'light') nativeTheme.themeSource = 'light';
  else nativeTheme.themeSource = 'dark';
}

function applySessionPolicy(ses) {
  hardenSession(
    ses,
    getSettings,
    notifyPermissionBlocked,
    () => {
      blockedTrackerCount++;
      mainWin?.webContents.send('tracker-blocked', blockedTrackerCount);
    },
    promptPermission,
  );
  hookDownloads(ses);
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

function createMain() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  mainWin = new BrowserWindow({
    width: Math.min(1440, width),
    height: Math.min(920, height),
    minWidth: 900, minHeight: 600,
    show: false,
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

  mainWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (process.platform === 'win32' && !APP_ICON.isEmpty()) mainWin.setIcon(APP_ICON);
  mainWin.loadFile(path.join(__dirname, '../assets/index.html'));

  mainWin.once('ready-to-show', () => {
    setTimeout(() => {
      splashWin?.destroy();
      splashWin = null;
      mainWin.show();
      mainWin.focus();
    }, 1400);
  });

  mainWin.webContents.on('before-input-event', (e, k) => {
    const c = k.control || k.meta;
    if (!c) return;
    const MAP = {
      t: 'new-tab', w: 'close-tab', r: 'reload', l: 'focus-url',
      f: 'find', b: 'bookmarks', h: 'history', d: 'bookmark',
      '=': 'zoom-in', '+': 'zoom-in', '-': 'zoom-out', '0': 'zoom-reset',
      '[': 'back', ']': 'fwd', p: 'print',
    };
    const cmd = MAP[k.key.toLowerCase()];
    if (cmd) { mainWin.webContents.send('cmd', cmd); e.preventDefault(); return; }
    if (c && k.shift && k.key.toLowerCase() === 't') {
      mainWin.webContents.send('cmd', 'reopen-tab');
      e.preventDefault();
    }
    if (c && k.shift && k.key.toLowerCase() === 'n') {
      mainWin.webContents.send('cmd', 'new-incognito');
      e.preventDefault();
    }
    if (c && k.shift && k.key.toLowerCase() === 'i') {
      mainWin.webContents.send('cmd', 'devtools');
      e.preventDefault();
    }
    if (c && k.shift && k.key.toLowerCase() === 'r') {
      mainWin.webContents.send('cmd', 'hard-reload');
      e.preventDefault();
    }
    if (c && k.shift && k.key.toLowerCase() === 'c') {
      mainWin.webContents.send('cmd', 'copy-url');
      e.preventDefault();
    }
    if (!c && !k.shift && !k.alt && k.key === 'F11') {
      mainWin.webContents.send('cmd', 'fullscreen');
      e.preventDefault();
    }
  });

  mainWin.on('maximize', () => mainWin.webContents.send('win-state', 'maximized'));
  mainWin.on('unmaximize', () => mainWin.webContents.send('win-state', 'normal'));
  mainWin.on('closed', () => { mainWin = null; });

  ensureUsersMigrated();
  const reg = getRegistry();
  setActiveUser(reg.activeUserId || 'u_default');
}

// ── IPC: window chrome ────────────────────────────────────────────────────────
ipcMain.handle('win-min', () => mainWin?.minimize());
ipcMain.handle('win-max', () => (mainWin?.isMaximized() ? mainWin.unmaximize() : mainWin.maximize()));
ipcMain.handle('win-close', () => mainWin?.close());
ipcMain.handle('win-is-max', () => mainWin?.isMaximized() ?? false);
ipcMain.handle('open-devtools', () => mainWin?.webContents.openDevTools({ mode: 'detach' }));

// ── IPC: users ────────────────────────────────────────────────────────────────
ipcMain.handle('users-init', () => {
  ensureUsersMigrated();
  const reg = getRegistry();
  setActiveUser(reg.activeUserId || reg.users[0]?.id || 'u_default');
  return reg;
});

ipcMain.handle('users-switch', (_, userId) => {
  const reg = getRegistry();
  if (!reg.users.some(u => u.id === userId)) return null;
  reg.activeUserId = userId;
  saveRegistry(reg);
  setActiveUser(userId);
  return { activeUserId: userId, users: reg.users };
});

ipcMain.handle('users-create', (_, { name, color }) => {
  const reg = getRegistry();
  const id = `u_${Date.now()}`;
  reg.users.push({ id, name: name || 'User', color: color || '#8b5cf6', created: Date.now() });
  reg.activeUserId = id;
  saveRegistry(reg);
  const paths = userPaths(id);
  write(paths.settings, { ...DEFAULT_SETTINGS });
  write(paths.history, []);
  write(paths.bookmarks, []);
  write(paths.session, {
    profiles: [{ id: 'default', name: 'Main', color: color || '#8b5cf6', isIncognito: false, ephemeral: false, partition: null }],
    activePid: 'default',
    tabsByPid: {},
    activeTid: { default: null },
  });
  try { fs.writeFileSync(paths.notes, ''); } catch {}
  setActiveUser(id);
  return { id, name: name || 'User', color: color || '#8b5cf6', users: reg.users };
});

ipcMain.handle('users-remove', async (_, userId) => {
  const reg = getRegistry();
  if (reg.users.length <= 1 || !reg.users.some(u => u.id === userId)) return null;
  reg.users = reg.users.filter(u => u.id !== userId);
  if (reg.activeUserId === userId) reg.activeUserId = reg.users[0].id;
  saveRegistry(reg);
  setActiveUser(reg.activeUserId);
  return reg;
});

ipcMain.handle('user-main-partition', () => mainPartition());

// ── IPC: sessions (scoped to active user) ─────────────────────────────────────
ipcMain.handle('session-create', (_, id, ephemeral) => {
  const partition = sessionPartition(activeUserId, id, ephemeral);
  applySessionPolicy(session.fromPartition(partition));
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

ipcMain.handle('session-apply-settings', () => {
  appSettings = getSettings();
  return true;
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
  return true;
});
ipcMain.handle('dl-list', () => downloads);
ipcMain.handle('session-save', (_, d) => { write(userPaths().session, d); return true; });
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
ipcMain.handle('save-screenshot', (_, bytes) => {
  const p = path.join(os.homedir(), 'Downloads', `Enigma-${Date.now()}.png`);
  fs.writeFileSync(p, Buffer.from(bytes));
  return p;
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
ipcMain.handle('chromium-version', () => process.versions.chrome);
ipcMain.handle('electron-version', () => process.versions.electron);

ipcMain.handle('context-menu', (_, p) => {
  const items = [];
  if (p.selectionText?.trim()) {
    items.push(
      { label: `Search "${p.selectionText.slice(0, 30)}"`, click: () => mainWin.webContents.send('cmd', `search-selection:${p.selectionText}`) },
      { label: 'Copy', role: 'copy' },
      { type: 'separator' },
    );
  }
  if (p.linkURL) {
    items.push(
      { label: 'Open in new tab', click: () => mainWin.webContents.send('open-link', p.linkURL) },
      { label: 'Open in incognito', click: () => mainWin.webContents.send('open-link-incog', p.linkURL) },
      { label: 'Copy link', click: () => clipboard.writeText(p.linkURL) },
      { type: 'separator' },
    );
  }
  if (p.mediaType === 'image') {
    items.push(
      { label: 'Open image in new tab', click: () => mainWin.webContents.send('open-link', p.srcURL) },
      { label: 'Copy image address', click: () => clipboard.writeText(p.srcURL) },
      { type: 'separator' },
    );
  }
  items.push(
    { label: 'Back', enabled: p.canBack, click: () => mainWin.webContents.send('cmd', 'back') },
    { label: 'Forward', enabled: p.canFwd, click: () => mainWin.webContents.send('cmd', 'fwd') },
    { label: 'Reload', click: () => mainWin.webContents.send('cmd', 'reload') },
    { type: 'separator' },
    { label: 'Print…', click: () => mainWin.webContents.send('cmd', 'print') },
    { type: 'separator' },
    { label: 'View page source', click: () => mainWin.webContents.send('cmd', 'view-source') },
    { label: 'Inspect', click: () => mainWin.webContents.send('cmd', 'devtools') },
  );
  Menu.buildFromTemplate(items).popup({ window: mainWin });
});

// ── App lifecycle ─────────────────────────────────────────────────────────────
const lock = app.requestSingleInstanceLock();
if (!lock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore();
      mainWin.focus();
    }
  });
  app.whenReady().then(() => {
    ensureUsersMigrated();
    setActiveUser(getRegistry().activeUserId || 'u_default');
    syncNativeTheme(appSettings.theme);
    createSplash();
    createMain();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (!mainWin) createMain(); });
}
