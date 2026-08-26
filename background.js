/**
 * Fake Fullscreen / Theater Mode — background event page (MV3)
 * ================================================================
 * Tiny router. It owns no UI and no logic beyond picking WHICH frame
 * of the active tab should toggle.
 *
 * Why a round-trip? A tab can contain several frames that each have
 * videos (top page + YouTube embed, say). `tabs.sendMessage` without a
 * frameId would toggle them ALL at once. Instead:
 *
 *   1. bg → all frames:  { ffs:probe, requestId }
 *   2. each frame with an eligible video answers privately:
 *        runtime.sendMessage({ ffs:report, requestId, score, active })
 *   3. after PROBE_WINDOW_MS bg picks the winner:
 *        - any frame whose theater is already active (to switch it off), else
 *        - the frame with the best score (visible area × playing bonus)
 *      and sends it a targeted { ffs:toggle } with { frameId }.
 */

'use strict';

/** How long to collect probe reports before deciding (ms). */
const PROBE_WINDOW_MS = 180;

/** requestId -> { tabId, entries: [{frameId, score, active}], timer } */
const pendingProbes = new Map();

/* ------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------- */

function makeId() {
  try { return crypto.randomUUID(); } catch {
    return 'probe-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  }
}

async function getActiveTabId() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    return tab ? tab.id : null;
  } catch {
    return null;
  }
}

function safeSend(tabId, message, options) {
  // "Could not establish connection" is normal when a frame has no
  // receiver — swallow it.
  try {
    const p = browser.tabs.sendMessage(tabId, message, options);
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch { /* ignore */ }
}

/* ------------------------------------------------------------------
 * Probe / decide / dispatch
 * ---------------------------------------------------------------- */

function beginProbe(tabId) {
  if (tabId == null) return;
  const id = makeId();
  const probe = { tabId, entries: [], timer: 0 };
  pendingProbes.set(id, probe);

  probe.timer = setTimeout(() => resolveProbe(id), PROBE_WINDOW_MS);

  // Broadcast to every frame; replies arrive as separate ffs:report
  // runtime messages from each interested frame.
  safeSend(tabId, { type: 'ffs:probe', requestId: id });
}

function resolveProbe(id) {
  const probe = pendingProbes.get(id);
  if (!probe) return;
  pendingProbes.delete(id);
  clearTimeout(probe.timer);

  const winner = probe.entries
    .filter((e) => e.active || e.score > 0)
    .sort((a, b) => (Number(b.active) - Number(a.active)) || (b.score - a.score))[0];

  if (winner) {
    safeSend(probe.tabId, { type: 'ffs:toggle' }, { frameId: winner.frameId });
  }
}

/* ------------------------------------------------------------------
 * Wiring
 * ---------------------------------------------------------------- */

browser.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || typeof msg !== 'object') return;

  switch (msg.type) {
    case 'ffs:report': {
      const probe = pendingProbes.get(msg.requestId);
      if (
        probe &&
        sender.tab &&
        sender.tab.id === probe.tabId &&
        sender.frameId != null
      ) {
        const exists = probe.entries.some((e) => e.frameId === sender.frameId);
        if (!exists) {
          probe.entries.push({
            frameId: sender.frameId,
            score: Number(msg.score) || 0,
            active: !!msg.active,
          });
        }
      }
      break;
    }

    // Escape pressed somewhere with no local theater — fan a force-exit
    // out to every frame of that tab so cross-frame theaters close too.
    case 'ffs:esc-request': {
      if (sender.tab) safeSend(sender.tab.id, { type: 'ffs:force-exit' });
      break;
    }

    // Per-tab badge feedback while a theater is up in this frame.
    case 'ffs:state': {
      const tabId = sender.tab ? sender.tab.id : null;
      if (tabId != null) setBadge(tabId, !!msg.active);
      break;
    }
  }
});

function setBadge(tabId, on) {
  try {
    browser.action.setBadgeText({ tabId, text: on ? 'ON' : '' });
    if (on) browser.action.setBadgeBackgroundColor({ tabId, color: '#e5484d' });
  } catch { /* older runtimes without tab-scoped badges */ }
}

// Keyboard shortcut (commands."toggle-fake-fullscreen")
browser.commands.onCommand.addListener((command) => {
  if (command === 'toggle-fake-fullscreen') {
    getActiveTabId().then(beginProbe);
  }
});

// Toolbar button click does the same thing as the shortcut.
browser.action.onClicked.addListener(() => {
  getActiveTabId().then(beginProbe);
});
