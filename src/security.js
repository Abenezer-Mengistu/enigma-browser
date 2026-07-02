'use strict';

const BLOCKED_PROTOCOLS = new Set(['javascript:', 'data:', 'vbscript:', 'file:', 'chrome:', 'about:']);

const TRACKER_PATTERNS = [
  '*://*.doubleclick.net/*',
  '*://*.googlesyndication.com/*',
  '*://*.googletagmanager.com/*',
  '*://*.google-analytics.com/*',
  '*://*.googleadservices.com/*',
  '*://*.facebook.com/tr*',
  '*://*.fbcdn.net/tr*',
  '*://pagead2.googlesyndication.com/*',
  '*://*.adnxs.com/*',
  '*://*.amazon-adsystem.com/*',
  '*://*.taboola.com/*',
  '*://*.outbrain.com/*',
  '*://*.scorecardresearch.com/*',
  '*://*.hotjar.com/*',
  '*://*.mixpanel.com/*',
  '*://*.segment.io/*',
  '*://*.segment.com/*',
  '*://*.clarity.ms/*',
  '*://*.criteo.com/*',
  '*://*.adsrvr.org/*',
  '*://*.quantserve.com/*',
  '*://*.moatads.com/*',
  '*://*.pubmatic.com/*',
  '*://*.rubiconproject.com/*',
  '*://*.openx.net/*',
  '*://*.casalemedia.com/*',
  '*://*.bluekai.com/*',
  '*://*.demdex.net/*',
  '*://*.rlcdn.com/*',
  '*://*.chartbeat.com/*',
  '*://*.newrelic.com/*',
  '*://*.nr-data.net/*',
];

const ALLOWED_PERMISSIONS = new Set([
  'media',
  'geolocation',
  'notifications',
  'clipboard-read',
  'pointerLock',
  'fullscreen',
]);

const PROMPT_PERMISSIONS = new Set(['geolocation', 'notifications', 'media']);

function parseUrl(raw) {
  try { return new URL(raw); } catch { return null; }
}

function isSafeExternalUrl(url) {
  const u = parseUrl(url);
  if (!u) return false;
  if (BLOCKED_PROTOCOLS.has(u.protocol)) return false;
  return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:';
}

function isNavigableUrl(url) {
  const u = parseUrl(url);
  if (!u) return false;
  if (BLOCKED_PROTOCOLS.has(u.protocol)) return false;
  return ['https:', 'http:', 'view-source:', 'blob:'].includes(u.protocol);
}

function upgradeToHttps(url) {
  const u = parseUrl(url);
  if (!u || u.protocol !== 'http:') return url;
  if (/^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(u.hostname)) return url;
  u.protocol = 'https:';
  return u.toString();
}

function hardenSession(ses, getSettings, onPermissionDenied, onTrackerBlocked, onPermissionPrompt) {
  if (ses.__enigmaHardened) return;
  ses.__enigmaHardened = true;

  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (!ALLOWED_PERMISSIONS.has(permission)) {
      onPermissionDenied?.(permission, details?.requestingUrl);
      return callback(false);
    }
    if (PROMPT_PERMISSIONS.has(permission)) {
      Promise.resolve(onPermissionPrompt?.(permission, details?.requestingUrl, details))
        .then((allow) => {
          if (!allow) onPermissionDenied?.(permission, details?.requestingUrl);
          callback(!!allow);
        })
        .catch(() => callback(false));
      return;
    }
    callback(true);
  });

  ses.setPermissionCheckHandler((wc, permission) => {
    if (!ALLOWED_PERMISSIONS.has(permission)) return false;
    if (PROMPT_PERMISSIONS.has(permission)) return undefined;
    return true;
  });

  ses.webRequest.onBeforeRequest({ urls: TRACKER_PATTERNS }, (_, cb) => {
    const settings = getSettings();
    if (settings.blockTrackers !== false) {
      onTrackerBlocked?.();
      return cb({ cancel: true });
    }
    cb({});
  });

  ses.webRequest.onBeforeRequest({ urls: ['http://*/*'] }, (details, cb) => {
    const settings = getSettings();
    if (!settings.httpsOnly) return cb({});
    const upgraded = upgradeToHttps(details.url);
    cb(upgraded !== details.url ? { redirectURL: upgraded } : {});
  });

  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    const settings = getSettings();
    if (settings.doNotTrack === false) return cb({});
    cb({ requestHeaders: { ...details.requestHeaders, DNT: '1' } });
  });
}

module.exports = {
  TRACKER_PATTERNS,
  isSafeExternalUrl,
  isNavigableUrl,
  upgradeToHttps,
  hardenSession,
};
