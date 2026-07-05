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

const { sharedEngine } = require('./filter-engine');

function parseUrl(raw) {
  try { return new URL(raw); } catch { return null; }
}

function isSafeExternalUrl(url) {
  const u = parseUrl(url);
  if (!u) return false;
  if (BLOCKED_PROTOCOLS.has(u.protocol)) return false;
  return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:';
}

function isLocalHostname(host) {
  return /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])$/i.test(String(host || ''));
}

function isResolvableHttpUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
    const h = u.hostname;
    return !!h && (h.includes('.') || isLocalHostname(h));
  } catch {
    return false;
  }
}

function isNavigableUrl(url) {
  const u = parseUrl(url);
  if (!u) return false;
  if (BLOCKED_PROTOCOLS.has(u.protocol)) return false;
  if (!['https:', 'http:', 'view-source:', 'blob:'].includes(u.protocol)) return false;
  if (u.protocol === 'https:' || u.protocol === 'http:') {
    const h = u.hostname;
    if (!h || (!h.includes('.') && !isLocalHostname(h))) return false;
  }
  return true;
}

function upgradeToHttps(url) {
  const u = parseUrl(url);
  if (!u || u.protocol !== 'http:') return url;
  if (/^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(u.hostname)) return url;
  u.protocol = 'https:';
  return u.toString();
}

function shouldBlockRequest(url, getEffectiveSettings) {
  const settings = getEffectiveSettings();
  if (settings.blockTrackers === false && !settings.filterLists) return false;
  if (sharedEngine.shouldBlock(url, {
    siteExceptions: settings.siteExceptions,
    blockTrackers: settings.blockTrackers !== false,
    filterLists: settings.filterLists !== false,
  })) return true;
  return false;
}

function hardenSession(ses, getEffectiveSettings, onPermissionDenied, onTrackerBlocked, onPermissionPrompt) {
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

  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, cb) => {
    const settings = getEffectiveSettings();
    if (details.resourceType === 'mainFrame') {
      if (settings.httpsOnly && details.url.startsWith('http://')) {
        const upgraded = upgradeToHttps(details.url);
        if (upgraded !== details.url) return cb({ redirectURL: upgraded });
      }
      return cb({});
    }

    if (settings.mixedContentBlock && details.url.startsWith('http://')) {
      const initiator = details.initiator || details.documentUrl || '';
      if (initiator.startsWith('https://')) {
        onTrackerBlocked?.();
        return cb({ cancel: true });
      }
    }

    if (shouldBlockRequest(details.url, getEffectiveSettings)) {
      onTrackerBlocked?.();
      return cb({ cancel: true });
    }

    if (TRACKER_PATTERNS.some(() => false)) { /* patterns handled via filter engine */ }

    cb({});
  });

  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    const settings = getEffectiveSettings();
    const requestHeaders = { ...details.requestHeaders };
    if (settings.doNotTrack !== false) requestHeaders.DNT = '1';
    // Never tell sites the browser prefers dark — Enigma theme is chrome-only.
    requestHeaders['Sec-CH-Prefers-Color-Scheme'] = 'light';
    requestHeaders['Sec-CH-Prefers-Color-Scheme-Reduced-Transparency'] = 'no-preference';
    cb({ requestHeaders });
  });
}

const FINGERPRINT_INJECT = `(function(){
  if(window.__enigmaFp)return;
  window.__enigmaFp=true;
  try{
    const noise=()=>(Math.random()*0.0001).toString(36).slice(2,4);
    const orig=HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL=function(){
      try{const c=this.getContext&&this.getContext('2d');if(c){c.fillStyle='rgba(0,0,0,0.003)';c.fillRect(0,0,1,1);}}catch(e){}
      return orig.apply(this,arguments);
    };
    if(window.RTCPeerConnection){
      const Orig=window.RTCPeerConnection;
      window.RTCPeerConnection=function(cfg){
        if(cfg&&cfg.iceServers)cfg.iceServers=[];
        return new Orig(cfg);
      };
      window.RTCPeerConnection.prototype=Orig.prototype;
    }
    Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>4});
    Object.defineProperty(navigator,'deviceMemory',{get:()=>8});
  }catch(e){}
})();`;

/** Injected before any page script — pages must not inherit Enigma/OS dark preference. */
const FORCE_LIGHT_PAGE = `(function(){
  if(window.__enigmaForceLight)return;
  window.__enigmaForceLight=1;
  try{
    var root=document.documentElement;
    if(root)root.style.colorScheme='light';
    if(!document.querySelector('meta[name="color-scheme"]')&&document.head){
      var meta=document.createElement('meta');
      meta.name='color-scheme';
      meta.content='light only';
      document.head.prepend(meta);
    }
    var orig=window.matchMedia.bind(window);
    window.matchMedia=function(q){
      var s=String(q||'');
      if(/prefers-color-scheme\\s*:\\s*dark/i.test(s)){
        var fake=orig('(max-width:0px)');
        try{Object.defineProperty(fake,'matches',{get:function(){return false}});}catch(e){}
        return fake;
      }
      if(/prefers-color-scheme\\s*:\\s*light/i.test(s)){
        var lite=orig('(min-width:0px)');
        try{Object.defineProperty(lite,'matches',{get:function(){return true}});}catch(e){}
        return lite;
      }
      return orig(q);
    };
  }catch(e){}
})();`;

module.exports = {
  TRACKER_PATTERNS,
  FINGERPRINT_INJECT,
  FORCE_LIGHT_PAGE,
  isSafeExternalUrl,
  isNavigableUrl,
  isLocalHostname,
  isResolvableHttpUrl,
  upgradeToHttps,
  hardenSession,
  shouldBlockRequest,
};
