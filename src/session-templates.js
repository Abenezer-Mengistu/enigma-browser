'use strict';

/** Built-in session container templates — v2 core differentiator */
const SESSION_TEMPLATES = {
  work: {
    id: 'work',
    name: 'Work',
    icon: '💼',
    color: '#3b82f6',
    description: 'Strict HTTPS, tracker blocking, and fingerprint protection for work accounts.',
    defaults: {
      searchEngine: 'google',
      httpsOnly: true,
      blockTrackers: true,
      fingerprintProtection: true,
      webrtcProtection: true,
      doNotTrack: true,
      mixedContentBlock: true,
    },
  },
  shopping: {
    id: 'shopping',
    name: 'Shopping',
    icon: '🛒',
    color: '#f59e0b',
    description: 'Isolated cookies for stores — trackers blocked, checkout stays separate.',
    defaults: {
      searchEngine: 'duckduckgo',
      httpsOnly: true,
      blockTrackers: true,
      fingerprintProtection: false,
      webrtcProtection: true,
      doNotTrack: true,
      mixedContentBlock: false,
    },
  },
  banking: {
    id: 'banking',
    name: 'Banking',
    icon: '🏦',
    color: '#10b981',
    description: 'Maximum privacy for finance — HTTPS-only and aggressive blocking.',
    defaults: {
      searchEngine: 'duckduckgo',
      httpsOnly: true,
      blockTrackers: true,
      fingerprintProtection: true,
      webrtcProtection: true,
      doNotTrack: true,
      mixedContentBlock: true,
    },
  },
  research: {
    id: 'research',
    name: 'Research',
    icon: '🔬',
    color: '#8b5cf6',
    description: 'Private reading and exploration with balanced protection.',
    defaults: {
      searchEngine: 'duckduckgo',
      httpsOnly: false,
      blockTrackers: true,
      fingerprintProtection: true,
      webrtcProtection: true,
      doNotTrack: true,
      mixedContentBlock: false,
    },
  },
  custom: {
    id: 'custom',
    name: 'Custom',
    icon: '⚙️',
    color: null,
    description: 'Pick your own name, color, and privacy settings.',
    defaults: {},
  },
};

function listTemplates() {
  return Object.values(SESSION_TEMPLATES);
}

function getTemplate(id) {
  return SESSION_TEMPLATES[id] || SESSION_TEMPLATES.custom;
}

function applyTemplateToProfile(templateId, profile = {}) {
  const tpl = getTemplate(templateId);
  const privacy = { ...tpl.defaults };
  return {
    ...profile,
    templateId: tpl.id,
    color: profile.color || tpl.color || '#8b5cf6',
    name: profile.name || (tpl.id === 'custom' ? 'Session' : tpl.name),
    searchEngine: privacy.searchEngine || profile.searchEngine,
    privacy,
  };
}

module.exports = {
  SESSION_TEMPLATES,
  listTemplates,
  getTemplate,
  applyTemplateToProfile,
};
