'use strict';

const DEFAULT_PRIVACY = {
  filterLists: true,
  fingerprintProtection: true,
  webrtcProtection: true,
  mixedContentBlock: false,
  siteExceptions: {},
};

function mergePrivacy(global = {}, session = {}) {
  return { ...DEFAULT_PRIVACY, ...global, ...session, siteExceptions: { ...global.siteExceptions, ...session.siteExceptions } };
}

function effectiveSettings(globalSettings, privacyDoc, sessionPrivacy = {}) {
  const privacy = mergePrivacy(privacyDoc, sessionPrivacy);
  return {
    ...globalSettings,
    blockTrackers: sessionPrivacy.blockTrackers ?? globalSettings.blockTrackers,
    httpsOnly: sessionPrivacy.httpsOnly ?? globalSettings.httpsOnly,
    doNotTrack: sessionPrivacy.doNotTrack ?? globalSettings.doNotTrack,
    filterLists: sessionPrivacy.filterLists ?? globalSettings.filterLists ?? privacy.filterLists !== false,
    fingerprintProtection: sessionPrivacy.fingerprintProtection ?? globalSettings.fingerprintProtection ?? privacy.fingerprintProtection !== false,
    webrtcProtection: sessionPrivacy.webrtcProtection ?? globalSettings.webrtcProtection ?? privacy.webrtcProtection !== false,
    mixedContentBlock: sessionPrivacy.mixedContentBlock ?? globalSettings.mixedContentBlock ?? !!privacy.mixedContentBlock,
    siteExceptions: privacy.siteExceptions || {},
  };
}

module.exports = {
  DEFAULT_PRIVACY,
  mergePrivacy,
  effectiveSettings,
};
