'use strict';

/** Injected into guest pages via webview to capture login submits and apply autofill. */
(function () {
  if (window.__enigmaPwBridge) return;
  window.__enigmaPwBridge = true;
  const PENDING_KEY = '__enigma_pw_pending';

  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    const pass = form.querySelector('input[type="password"]');
    if (!pass || !pass.value) return;
    const user = form.querySelector(
      'input[type="email"],input[autocomplete="username"],input[name="username"],input[name="user"],input[id="username"],input[type="text"]',
    );
    if (!user || !user.value) return;
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({
        h: location.hostname,
        u: user.value,
        p: pass.value,
        t: Date.now(),
      }));
    } catch { /* ignore */ }
  }, true);

  window.__enigmaApplyFill = function (username, password) {
    const pass = document.querySelector('input[type="password"]:not([readonly])');
    if (!pass || pass.value) return false;
    const user = document.querySelector(
      'input[type="email"],input[autocomplete="username"],input[name="username"],input[name="user"],input[id="username"],input[type="text"]',
    );
    if (!user || user.value) return false;
    user.value = username;
    user.dispatchEvent(new Event('input', { bubbles: true }));
    pass.value = password;
    pass.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  };

  window.__enigmaPeekPending = function () {
    try {
      const raw = sessionStorage.getItem(PENDING_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || Date.now() - (data.t || 0) > 120000) {
        sessionStorage.removeItem(PENDING_KEY);
        return null;
      }
      return data;
    } catch {
      return null;
    }
  };

  window.__enigmaClearPending = function () {
    try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
  };
})();
