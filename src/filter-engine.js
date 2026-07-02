'use strict';

const fs = require('fs');
const path = require('path');

/** Lightweight EasyList-style domain blocker */
class FilterEngine {
  constructor() {
    this.domainRules = new Set();
    this.urlPatterns = [];
    this.loaded = false;
  }

  clear() {
    this.domainRules.clear();
    this.urlPatterns = [];
    this.loaded = false;
  }

  addDomain(host) {
    const h = String(host || '').toLowerCase().replace(/^\*\./, '').replace(/^\./, '');
    if (h && h.includes('.')) this.domainRules.add(h);
  }

  parseRules(text) {
    for (const raw of String(text || '').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('!') || line.startsWith('[')) continue;
      if (line.includes('@@')) continue;

      const domainMatch = line.match(/\|\|([^*^|$]+)/);
      if (domainMatch) {
        this.addDomain(domainMatch[1]);
        continue;
      }
      if (line.startsWith('||') && line.endsWith('^')) {
        this.addDomain(line.slice(2, -1));
      }
    }
    this.loaded = true;
  }

  loadBundled() {
    const file = path.join(__dirname, '../assets/filters/default-rules.txt');
    try {
      this.parseRules(fs.readFileSync(file, 'utf8'));
    } catch {
      this.loaded = true;
    }
  }

  hostMatches(hostname) {
    const host = String(hostname || '').toLowerCase();
    if (!host) return false;
    if (this.domainRules.has(host)) return true;
    for (const rule of this.domainRules) {
      if (host === rule || host.endsWith('.' + rule)) return true;
    }
    return false;
  }

  shouldBlock(url, { siteExceptions = {}, blockTrackers = true, filterLists = true } = {}) {
    if (!blockTrackers) return false;
    let parsed;
    try { parsed = new URL(url); } catch { return false; }
    const host = parsed.hostname.toLowerCase();
    if (siteExceptions[host] === 'allow') return false;
    if (siteExceptions[host] === 'block') return true;
    if (filterLists && this.hostMatches(host)) return true;
    return false;
  }
}

const sharedEngine = new FilterEngine();
sharedEngine.loadBundled();

module.exports = { FilterEngine, sharedEngine };
