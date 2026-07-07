'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getTemplate } = require('./session-templates');

const BROWSERS = [
  {
    id: 'chrome',
    name: 'Google Chrome',
    dataDir: path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data'),
  },
  {
    id: 'edge',
    name: 'Microsoft Edge',
    dataDir: path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'User Data'),
  },
];

function profileDirs(dataDir) {
  if (!dataDir || !fs.existsSync(dataDir)) return [];
  const out = [];
  const def = path.join(dataDir, 'Default');
  if (fs.existsSync(path.join(def, 'Bookmarks'))) {
    out.push({ id: 'Default', name: 'Default', path: def });
  }
  try {
    for (const name of fs.readdirSync(dataDir)) {
      if (!/^Profile \d+$/i.test(name)) continue;
      const p = path.join(dataDir, name);
      if (fs.existsSync(path.join(p, 'Bookmarks'))) {
        out.push({ id: name, name, path: p });
      }
    }
  } catch {}
  return out;
}

function detectBrowsers() {
  return BROWSERS.map(b => {
    const profiles = profileDirs(b.dataDir);
    return profiles.length
      ? { id: b.id, name: b.name, profiles: profiles.map(p => ({ id: p.id, name: p.name })) }
      : null;
  }).filter(Boolean);
}

function flattenBookmarkNode(node, out) {
  if (!node) return;
  if (node.type === 'url' && node.url && !node.url.startsWith('javascript:')) {
    out.push({
      url: node.url,
      title: (node.name || node.url).slice(0, 500),
      ts: Date.now(),
    });
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) flattenBookmarkNode(child, out);
  }
}

function parseBookmarksFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  let raw;
  try { raw = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return []; }
  const out = [];
  for (const key of ['bookmark_bar', 'other', 'synced']) {
    flattenBookmarkNode(raw.roots?.[key], out);
  }
  const seen = new Set();
  return out.filter(b => {
    if (!b.url || seen.has(b.url)) return false;
    seen.add(b.url);
    return true;
  });
}

function chromeTimeToMs(microseconds) {
  if (!microseconds) return Date.now();
  return Math.floor(microseconds / 1000) - 11644473600000;
}

function readHistorySqlite(dbPath, limit = 500) {
  if (!dbPath || !fs.existsSync(dbPath)) return [];
  const tmp = path.join(os.tmpdir(), `enigma-import-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  try {
    fs.copyFileSync(dbPath, tmp);
    let DatabaseSync;
    try { ({ DatabaseSync } = require('node:sqlite')); } catch { return []; }
    const db = new DatabaseSync(tmp, { readOnly: true });
    const rows = db.prepare(
      'SELECT url, title, last_visit_time FROM urls WHERE url NOT LIKE ? ORDER BY last_visit_time DESC LIMIT ?',
    ).all('chrome:%', limit);
    db.close();
    const seen = new Set();
    return rows.map(r => ({
      url: r.url,
      title: (r.title || r.url || '').slice(0, 500),
      ts: chromeTimeToMs(r.last_visit_time),
    })).filter(e => e.url && !e.url.startsWith('chrome:') && !seen.has(e.url) && seen.add(e.url));
  } catch {
    return [];
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function importFromBrowser(browserId, profileId = 'Default', opts = {}) {
  const browser = BROWSERS.find(b => b.id === browserId);
  if (!browser) return { bookmarks: [], history: [] };
  const profilePath = path.join(browser.dataDir, profileId);
  const bookmarks = parseBookmarksFile(path.join(profilePath, 'Bookmarks'));
  const history = opts.includeHistory !== false
    ? readHistorySqlite(path.join(profilePath, 'History'), opts.historyLimit || 500)
    : [];
  return { bookmarks, history, browser: browser.name, profile: profileId };
}

function starterSessionsSeed(accent = '#8b5cf6') {
  const workTpl = getTemplate('work');
  const personalTpl = getTemplate('research');
  const workId = `p_${Date.now()}`;
  const personalId = `p_${Date.now() + 1}`;
  return {
    profiles: [
      { id: 'default', name: 'Main', color: accent, isIncognito: false, ephemeral: false, partition: null },
      {
        id: workId,
        name: 'Work',
        color: workTpl.color || '#3b82f6',
        isIncognito: true,
        ephemeral: false,
        partition: null,
        templateId: 'work',
        privacy: { ...workTpl.defaults },
        searchEngine: workTpl.defaults.searchEngine,
      },
      {
        id: personalId,
        name: 'Personal',
        color: '#22c55e',
        isIncognito: true,
        ephemeral: false,
        partition: null,
        templateId: 'research',
        privacy: { ...personalTpl.defaults },
        searchEngine: personalTpl.defaults.searchEngine,
      },
    ],
    activePid: 'default',
    tabsByPid: { default: [], [workId]: [], [personalId]: [] },
    activeTid: { default: null, [workId]: null, [personalId]: null },
    sessionMeta: {},
  };
}

module.exports = {
  detectBrowsers,
  importFromBrowser,
  starterSessionsSeed,
  parseBookmarksFile,
};
