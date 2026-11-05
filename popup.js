/**
 * Fake Fullscreen / Theater Mode — control panel (popup) logic
 * ================================================================
 * Dark Reader-style panel. Reads/writes the same storage as
 * content.js / options.js; content scripts pick changes up live via
 * storage.onChanged, so the popup never needs to message tabs for
 * *applying* settings — only for asking "which host is this tab?"
 * (tabs.sendMessage reaches the content script with no extra
 * permissions).
 */

'use strict';

/** Cross-browser API handle: Firefox/Zen expose `browser`, Chromium
 *  (Chrome, Brave, Edge, …) exposes `chrome` — both promise-based in MV3. */
const ext = globalThis.browser || globalThis.chrome;

const $ = (id) => document.getElementById(id);

/** Keys this panel touches. Full defaults live in content.js. */
const PANEL_DEFAULTS = {
  masterEnabled: true,
  preventNativeFullscreen: true,
  buttonEnabled: true,
  defaultEnabled: true,
  siteRules: [],
};

let state = { ...PANEL_DEFAULTS };
let siteHost = ''; // hostname of the active tab, '' when unavailable

/* ------------------------------------------------------------------
 * Storage (same sync-with-local-fallback strategy as the other pages)
 * ---------------------------------------------------------------- */

async function getStorageArea() {
  try {
    await ext.storage.sync.get({ __ffs_probe: null });
    return ext.storage.sync;
  } catch {
    return ext.storage.local;
  }
}

async function setKey(key, value) {
  const area = await getStorageArea();
  await area.set({ [key]: value });
}

/* ------------------------------------------------------------------
 * Active-tab site info (ask the top-frame content script)
 * ---------------------------------------------------------------- */

async function detectActiveSite() {
  try {
    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id == null) return null;
    // Only the top frame answers 'ffs:site-info' (see content.js).
    return await ext.tabs.sendMessage(tab.id, { type: 'ffs:site-info' });
  } catch {
    return null; // about:, addons.mozilla.org, PDF viewer, … no content script
  }
}

/* ------------------------------------------------------------------
 * UI
 * ---------------------------------------------------------------- */

function renderSiteCard(info) {
  const section = $('siteSection');
  const hostEl = $('siteHost');
  const toggle = $('siteEnabled');

  if (!info || !info.hostname) {
    section.classList.add('unavailable');
    hostEl.textContent = 'Not available on this page';
    $('siteHint').textContent = 'No extension access here';
    toggle.checked = false;
    toggle.disabled = true;
    return;
  }

  siteHost = info.hostname;
  section.classList.remove('unavailable');
  hostEl.textContent = siteHost;
  hostEl.title = siteHost;

  // Effective state = explicit rule if present, else the global default.
  const rule = state.siteRules.find((r) => r.domain === siteHost);
  toggle.checked = rule ? !!rule.enabled : state.defaultEnabled;
  $('siteHint').textContent = rule ? 'Custom rule on this site' : 'Using the default on this site';
}

function updateMasterHint() {
  $('masterHint').textContent = $('masterEnabled').checked
    ? 'Intercept & restyle fullscreen'
    : 'Paused everywhere';
}

/* ------------------------------------------------------------------
 * Wiring
 * ---------------------------------------------------------------- */

async function init() {
  const area = await getStorageArea();
  state = { ...PANEL_DEFAULTS, ...(await area.get(PANEL_DEFAULTS)) };

  // Master switch
  const master = $('masterEnabled');
  master.checked = state.masterEnabled;
  updateMasterHint();
  master.addEventListener('change', () => {
    state.masterEnabled = master.checked;
    updateMasterHint();
    setKey('masterEnabled', master.checked);
  });

  // Simple behavior toggles
  for (const key of ['preventNativeFullscreen', 'buttonEnabled']) {
    const el = $(key);
    el.checked = state[key];
    el.addEventListener('change', () => {
      state[key] = el.checked;
      setKey(key, el.checked);
    });
  }

  // Site card
  const info = await detectActiveSite();
  renderSiteCard(info);

  // Action buttons — need a page our content script can reach, with
  // the extension active there.
  const usable = !!(info && info.hostname && info.active);

  // "Theater mode for this tab's video": same probe as the shortcut
  // (background picks the best video across all frames, or exits).
  const toggleBtn = $('toggleTheater');
  toggleBtn.disabled = !usable;
  if (info && info.theaterActive) toggleBtn.textContent = 'Exit theater mode';
  toggleBtn.addEventListener('click', async () => {
    try { await ext.runtime.sendMessage({ type: 'ffs:toggle-active-tab' }); } catch { /* ignore */ }
    window.close();
  });

  const pickBtn = $('pickElement');
  pickBtn.disabled = !usable;
  pickBtn.addEventListener('click', async () => {
    try {
      const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id != null) {
        await ext.tabs.sendMessage(tab.id, { type: 'ffs:start-picker' });
      }
    } catch {
      /* page without our content script (about:, addons.mozilla.org, …) */
    }
    window.close();
  });

  $('siteEnabled').addEventListener('change', async (e) => {
    if (!siteHost) return;
    const desired = e.target.checked;
    const rules = state.siteRules.filter((r) => r.domain !== siteHost);
    // A rule equal to the default adds nothing — drop it to keep the
    // list clean; only store genuine exceptions.
    if (desired !== state.defaultEnabled) {
      rules.push({ domain: siteHost, enabled: desired });
    }
    state.siteRules = rules;
    $('siteHint').textContent =
      desired !== state.defaultEnabled ? 'Custom rule on this site' : 'Using the default on this site';
    await setKey('siteRules', rules);
  });

  // Footer
  $('openOptions').addEventListener('click', () => {
    ext.runtime.openOptionsPage();
    window.close();
  });
}

init().catch(console.error);
