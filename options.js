/**
 * Fake Fullscreen / Theater Mode — options page logic
 * ================================================================
 * Plain DOM + ext.storage. DEFAULTS mirrors the copy in
 * content.js — keep both in sync.
 *
 * Settings model
 *   masterEnabled  global kill switch
 *   defaultEnabled run on sites that have no explicit rule
 *   siteRules      [{ domain, enabled }]  (first match wins)
 *   + the various UI toggles / dimLevel
 */

'use strict';

/** Cross-browser API handle: Firefox/Zen expose `browser`, Chromium
 *  (Chrome, Brave, Edge, …) exposes `chrome` — both promise-based in MV3. */
const ext = globalThis.browser || globalThis.chrome;

const DEFAULTS = {
  masterEnabled:     true,
  defaultEnabled:    true,
  siteRules:         [],
  preventNativeFullscreen: true,
  buttonEnabled:     true,
  buttonHoverOnly:   true,
  hideNativeControls: false,
  clickOutsideExits: true,
  dimLevel:          0.78,
  // Per-site player container rules — see content.js DEFAULTS.siteHosts.
  siteHosts: [
    { domain: 'youtube.com', kind: 'video', selector: '#movie_player' },
    { domain: 'youtube-nocookie.com', kind: 'video', selector: '#movie_player' },
  ],
};

const $ = (id) => document.getElementById(id);

const CHECKBOXES = [
  'masterEnabled',
  'defaultEnabled',
  'preventNativeFullscreen',
  'buttonEnabled',
  'buttonHoverOnly',
  'hideNativeControls',
  'clickOutsideExits',
];

/** The live settings object — mirrors exactly what we persist. */
// Deep copies: rule arrays are edited in place (push/splice), and must
// never alias the DEFAULTS arrays.
let state = structuredClone(DEFAULTS);

/* ------------------------------------------------------------------
 * Storage area: prefer sync (Firefox Sync), fall back to local.
 * ---------------------------------------------------------------- */

async function getStorageArea() {
  try {
    await ext.storage.sync.get({ __ffs_probe: null });
    return ext.storage.sync;
  } catch {
    return ext.storage.local;
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

/** Render the per-site player-container rules. */
function renderHosts() {
  const list = $('hostList');
  list.replaceChildren();
  state.siteHosts.forEach((rule, i) => {
    const li = document.createElement('li');
    li.className = 'rule';

    const domain = document.createElement('span');
    domain.className = 'domain';
    domain.textContent = rule.domain;

    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = rule.kind === 'video' ? 'Video' : rule.kind;

    const target = document.createElement('span');
    target.className = 'target';
    target.textContent = rule.selector
      ? rule.selector
      : `${rule.levels > 0 ? '+' : ''}${rule.levels} layer${Math.abs(rule.levels) === 1 ? '' : 's'}`;
    target.title = target.textContent;

    const remove = document.createElement('button');
    remove.className = 'remove';
    remove.type = 'button';
    remove.title = 'Remove rule (detect automatically)';
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      state.siteHosts.splice(i, 1);
      renderHosts();
      persist();
    });

    li.append(domain, kind, target, remove);
    list.appendChild(li);
  });
}

/** "+1" / "-2" → levels; anything else must be a valid CSS selector. */
function parseHostTarget(text) {
  const t = String(text || '').trim();
  if (!t) return { error: 'Enter a CSS selector or a layer offset like +1' };
  if (/^[+-]?\d+$/.test(t)) {
    const levels = parseInt(t, 10);
    if (!levels) return { error: '0 layers is the automatic choice — use + or − a number' };
    if (Math.abs(levels) > 10) return { error: 'Keep the offset within ±10 layers' };
    return { levels };
  }
  try { document.createDocumentFragment().querySelector(t); } catch {
    return { error: `“${t}” is not a valid CSS selector` };
  }
  return { selector: t };
}

function addHost() {
  const domain = normalizeDomain($('hostDomain').value);
  const kind = $('hostKind').value;
  if (!domain) { $('hostDomain').focus(); return; }
  const parsed = parseHostTarget($('hostTarget').value);
  $('hostError').textContent = parsed.error || '';
  if (parsed.error) { $('hostTarget').focus(); return; }

  const rule = { domain, kind, ...parsed };
  // Replace this site's existing rule; put it first so it beats broader ones.
  state.siteHosts = [rule, ...state.siteHosts.filter((r) => !(r.domain === domain && r.kind === kind))];
  $('hostDomain').value = '';
  $('hostTarget').value = '';
  renderHosts();
  persist();
  $('hostDomain').focus();
}

function loadIntoForm() {
  for (const key of CHECKBOXES) $(key).checked = !!state[key];
  $('dimLevel').value = state.dimLevel;
  $('ruleDomain').value = '';
  updateDimLabel();
  updateDefaultLabel();
  renderRules();
  renderHosts();
}

/* ------------------------------------------------------------------
 * Event wiring
 * ---------------------------------------------------------------- */

async function init() {
  const area = await getStorageArea();
  state = structuredClone({ ...DEFAULTS, ...(await area.get(DEFAULTS)) });

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

  $('addHost').addEventListener('click', addHost);
  for (const id of ['hostDomain', 'hostTarget']) {
    $(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addHost(); }
    });
  }

  $('save').addEventListener('click', () => persist());

  $('reset').addEventListener('click', async () => {
    const a = await getStorageArea();
    state = structuredClone(DEFAULTS);
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
