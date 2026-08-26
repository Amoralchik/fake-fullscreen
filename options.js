/**
 * Fake Fullscreen / Theater Mode — options page logic
 * ================================================================
 * Plain DOM + browser.storage. DEFAULTS mirrors the copy in
 * content.js — keep both in sync.
 *
 * Settings model
 *   masterEnabled  global kill switch
 *   defaultEnabled run on sites that have no explicit rule
 *   siteRules      [{ domain, enabled }]  (first match wins)
 *   + the various UI toggles / dimLevel
 */

'use strict';

const DEFAULTS = {
  masterEnabled:     true,
  defaultEnabled:    true,
  siteRules:         [],
  buttonEnabled:     true,
  buttonHoverOnly:   true,
  hideNativeControls: false,
  clickOutsideExits: true,
  dimLevel:          0.78,
};

const $ = (id) => document.getElementById(id);

const CHECKBOXES = [
  'masterEnabled',
  'defaultEnabled',
  'buttonEnabled',
  'buttonHoverOnly',
  'hideNativeControls',
  'clickOutsideExits',
];

/** The live settings object — mirrors exactly what we persist. */
let state = { ...DEFAULTS };

/* ------------------------------------------------------------------
 * Storage area: prefer sync (Firefox Sync), fall back to local.
 * ---------------------------------------------------------------- */

async function getStorageArea() {
  try {
    await browser.storage.sync.get({ __ffs_probe: null });
    return browser.storage.sync;
  } catch {
    return browser.storage.local;
  }
}

async function persist() {
  const area = await getStorageArea();
  await area.set(state);
  flashStatus();
}

/* ------------------------------------------------------------------
 * Domain parsing: accept hostnames, URLs, or pasted links.
 * "https://mail.Example.com/inbox" -> "mail.example.com"
 * ------------------------------------------------------------------ */

function normalizeDomain(text) {
  let d = String(text || '').trim().toLowerCase();
  if (!d) return '';
  if (!/^[a-z0-9.-]+$/.test(d)) {
    try { d = new URL(d.includes('://') ? d : 'https://' + d).hostname; }
    catch { return ''; }
  }
  return d.replace(/^\.+/, '').replace(/\.+$/, '');
}

/* ------------------------------------------------------------------
 * UI <-> state
 * ---------------------------------------------------------------- */

function updateDimLabel() {
  $('dimOut').textContent = `${Math.round($('dimLevel').value * 100)}% black behind the video`;
}

function updateDefaultLabel() {
  $('defaultEnabledLabel').textContent =
    state.defaultEnabled ? 'Run on all sites by default' : 'Off everywhere by default (opt-in below)';
}

/** Render the per-site rules list from state.siteRules. */
function renderRules() {
  const list = $('ruleList');
  list.innerHTML = '';

  for (let i = 0; i < state.siteRules.length; i++) {
    const rule = state.siteRules[i];

    const li = document.createElement('li');
    li.className = 'rule';

    const domain = document.createElement('span');
    domain.className = 'domain';
    domain.textContent = rule.domain;

    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = !!rule.enabled;
    enabled.title = 'Enabled on this site';
    enabled.addEventListener('change', () => {
      rule.enabled = enabled.checked;
      stateLabel.textContent = rule.enabled ? 'On' : 'Off';
      persist();
    });

    const stateLabel = document.createElement('span');
    stateLabel.className = 'state';
    stateLabel.textContent = rule.enabled ? 'On' : 'Off';

    const remove = document.createElement('button');
    remove.className = 'remove';
    remove.type = 'button';
    remove.title = 'Remove rule';
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      state.siteRules.splice(i, 1);
      renderRules();
      persist();
    });

    li.append(domain, enabled, stateLabel, remove);
    list.appendChild(li);
  }
}

function loadIntoForm() {
  for (const key of CHECKBOXES) $(key).checked = !!state[key];
  $('dimLevel').value = state.dimLevel;
  $('ruleDomain').value = '';
  updateDimLabel();
  updateDefaultLabel();
  renderRules();
}

/* ------------------------------------------------------------------
 * Event wiring
 * ---------------------------------------------------------------- */

async function init() {
  const area = await getStorageArea();
  state = { ...DEFAULTS, ...(await area.get(DEFAULTS)) };

  // Simple toggles write straight to state + persist.
  for (const key of CHECKBOXES) {
    $(key).addEventListener('change', () => {
      state[key] = $(key).checked;
      if (key === 'defaultEnabled') updateDefaultLabel();
      persist();
    });
  }

  $('dimLevel').addEventListener('input', updateDimLabel);
  $('dimLevel').addEventListener('change', () => {
    state.dimLevel = Number($('dimLevel').value);
    persist();
  });

  $('addRule').addEventListener('click', addRule);
  $('ruleDomain').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addRule(); }
  });

  $('save').addEventListener('click', () => persist());

  $('reset').addEventListener('click', async () => {
    const a = await getStorageArea();
    state = { ...DEFAULTS };
    await a.set(DEFAULTS);
    loadIntoForm();
    flashStatus();
  });

  loadIntoForm();
}

function addRule() {
  const domain = normalizeDomain($('ruleDomain').value);
  if (!domain) { $('ruleDomain').focus(); return; }

  // Update an existing rule instead of duplicating it.
  const existing = state.siteRules.find((r) => r.domain === domain);
  if (existing) existing.enabled = $('ruleState').value === 'on';
  else state.siteRules.push({ domain, enabled: $('ruleState').value === 'on' });

  $('ruleDomain').value = '';
  renderRules();
  persist();
  $('ruleDomain').focus();
}

function flashStatus() {
  const el = $('status');
  el.classList.add('show');
  clearTimeout(flashStatus.__t);
  flashStatus.__t = setTimeout(() => el.classList.remove('show'), 1600);
}

init().catch(console.error);
