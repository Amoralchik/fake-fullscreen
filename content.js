/**
 * Fake Fullscreen / Theater Mode — content script
 * ================================================================
 * Runs in EVERY frame of every tab (manifest: all_frames: true), so
 * videos inside same-origin AND cross-origin iframes are covered:
 * each frame manages its own <video> elements.
 *
 * Responsibilities
 *   1. Discover <video> elements — including inside open Shadow DOM.
 *   2. Attach a floating "Theater" button to each one.
 *   3. Enter/exit fake fullscreen (fixed + max z-index + dark overlay
 *      + scroll lock). Never touches the real Fullscreen API.
 *   4. Answer "probe" messages from background.js so the keyboard
 *      shortcut / toolbar button toggle exactly ONE video per tab,
 *      even when page + iframes all contain players.
 *
 * Everything tunable lives in DEFAULTS / CLS below and content.css.
 */

(() => {
  'use strict';

  // Re-injection guard (e.g. extension reload while the tab is open).
  if (window.__ffsContentLoaded) return;
  Object.defineProperty(window, '__ffsContentLoaded', { value: true });

  /* ================================================================
   * Configuration
   * ================================================================ */

  /** CSS class names (see content.css). */
  const CLS = {
    videoActive:  'ffs-video--theater',
    btn:          'ffs-btn',
    btnVisible:   'ffs-btn--visible',
    btnActive:    'ffs-btn--active',
    overlay:      'ffs-overlay',
    overlayShown: 'ffs-overlay--shown',
    locked:       'ffs-scroll-locked',
  };

  const ICON_EXPAND =
    '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">' +
    '<path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4" fill="none" ' +
    'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const ICON_COLLAPSE =
    '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">' +
    '<path d="M2 6h4V2M14 6h-4V2M2 10h4v4M14 10h-4v4" fill="none" ' +
    'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /**
   * Default settings. Mirrored by options.js — keep both in sync.
   * Stored in browser.storage.sync (falls back to local).
   *
   * Per-site control is a flat rules list + a default:
   *   - masterEnabled  global kill switch
   *   - defaultEnabled run on sites that have no explicit rule
   *   - siteRules      [{ domain, enabled }] — most specific wins (first match)
   */
  const DEFAULTS = {
    masterEnabled:     true,   // global kill switch
    defaultEnabled:    true,   // sites with no rule are on/off by default
    siteRules:         [],     // [{ domain: 'example.com', enabled: true }]
    buttonEnabled:     true,   // show floating buttons on videos
    buttonHoverOnly:   true,   // only show them near the cursor
    hideNativeControls: false, // strip video.controls while in theater
    clickOutsideExits: true,   // clicking the dark overlay exits
    dimLevel:          0.78,   // backdrop darkness, 0–1
  };

  let settings = { ...DEFAULTS };

  /* ================================================================
   * State
   * ================================================================ */

  /** video element -> { button, lastActive } */
  const tracked = new Map();

  /** Active theater session or null. */
  let theater = null; // { video, saved:{cssText, hadStyleAttr, controls, parent, next}, reparented }

  let overlay = null;
  let scrollSave = null;
  const mouse = { x: -1, y: -1 };

  /* ================================================================
   * Small helpers
   * ================================================================ */

  const noopCatch = () => {};

  function currentHostname() {
    try { return (location.hostname || '').toLowerCase(); } catch { return ''; }
  }

  /** Does the current site opt in to the extension? */
  function domainMatches(pattern, host) {
    pattern = String(pattern || '').trim().toLowerCase();
    if (!pattern) return false;
    return host === pattern || host.endsWith('.' + pattern);
  }

  /** True when the extension should be active on the current host. */
  function extensionActiveHere() {
    if (!settings.masterEnabled) return false;
    const host = currentHostname();
    if (!host) return true; // about:blank / data: etc. — leave enabled
    for (const rule of (settings.siteRules || [])) {
      if (domainMatches(rule.domain, host)) return !!rule.enabled;
    }
    return settings.defaultEnabled;
  }

  function pointNearRect(px, py, r, pad) {
    return px >= r.left - pad && px <= r.right + pad &&
           py >= r.top - pad && py <= r.bottom + pad;
  }

  /* ----------------------------------------------------------------
   * Settings storage (sync with local fallback, e.g. private mode)
   * -------------------------------------------------------------- */

  async function getStorageArea() {
    try {
      await browser.storage.sync.get({ __ffs_probe: null });
      return browser.storage.sync;
    } catch {
      return browser.storage.local;
    }
  }

  async function loadSettings() {
    try {
      const area = await getStorageArea();
      const stored = await area.get(DEFAULTS);
      settings = { ...DEFAULTS, ...stored };
    } catch {
      /* keep defaults */
    }
    applyDimLevel();
  }

  function applyDimLevel() {
    if (overlay) overlay.style.setProperty('--ffs-dim', String(settings.dimLevel));
  }

  browser.storage.onChanged.addListener((_changes, _area) => {
    loadSettings().then(() => {
      if (!extensionActiveHere() && theater) exitTheater();
      schedulePositionUpdate();
    }).catch(noopCatch);
  });

  /* ================================================================
   * Video discovery (recursive through OPEN shadow roots)
   *
   * Closed shadow roots are invisible to any extension script —
   * nothing can be done about those; everything else is found here.
   * ================================================================ */

  /**
   * Rescan for videos; prune entries whose elements left the DOM.
   * @param {boolean} deep also descend into open shadow roots
   *   (deep scans are triggered by mutations; shallow by the interval)
   */
  function scan(deep) {
    // Prune disconnected videos (SPA navigations remove players).
    for (const video of [...tracked.keys()]) {
      if (!video.isConnected && !(theater && theater.video === video)) untrack(video);
    }
    // If the active video was ripped out mid-theater → exit gracefully.
    if (theater && !theater.video.isConnected) exitTheater();

    const found = deep
      ? videosDeep(document)
      : document.querySelectorAll('video'); // cheap shallow sweep

    for (const el of found) {
      if (el instanceof HTMLVideoElement && !tracked.has(el)) track(el);
    }
    schedulePositionUpdate();
  }

  /** All <video> elements reachable through OPEN shadow roots. */
  function videosDeep(root) {
    const out = [];
    const queue = [root];
    const seen = new Set();
    while (queue.length) {
      const node = queue.pop();
      if (!node || seen.has(node)) continue;
      seen.add(node);
      let videos;
      try { videos = node.querySelectorAll('video'); } catch { continue; }
      out.push(...videos);
      // Only shadow hosts need queueing — that's where hidden trees live.
      const all = node.querySelectorAll('*');
      for (const el of all) {
        if (el.shadowRoot) queue.push(el.shadowRoot);
      }
    }
    return out;
  }

  /* ================================================================
   * Per-video floating button
   * ================================================================ */

  function track(video) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = CLS.btn;
    button.innerHTML = ICON_EXPAND + '<span>Theater</span>';
    button.title = 'Fake Fullscreen — theater mode';
    button.setAttribute('aria-label', 'Toggle theater mode for this video');

    // Toggle on click…
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleTheater(video);
    });
    // …and make sure the site never sees interactions with our widget
    // (avoids closing menus / pausing / focus hijinks underneath).
    for (const type of ['mousedown', 'mouseup', 'pointerdown', 'touchstart']) {
      button.addEventListener(type, (e) => e.stopPropagation());
    }

    // documentElement (not body): immune to body display/overflow games.
    (document.documentElement || document.body).appendChild(button);
    tracked.set(video, { button, lastActive: false });
  }

  function untrack(video) {
    const ui = tracked.get(video);
    if (ui) {
      ui.button.remove();
      tracked.delete(video);
    }
  }

  /** Position/visibility pass for every button (rAF-coalesced). */
  let posScheduled = false;
  function schedulePositionUpdate() {
    if (posScheduled) return;
    posScheduled = true;
    requestAnimationFrame(() => {
      posScheduled = false;
      updatePositions();
    });
  }

  const HOVER_PAD_PX = 36;   // how close the cursor must be to reveal a button
  const BTN_MARGIN_PX = 12;  // offset from the video's corner

  function updatePositions() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    for (const [video, ui] of tracked) {
      const { button } = ui;
      const rect = video.getBoundingClientRect();

      const bigEnough = rect.width >= 120 && rect.height >= 70;
      const intersectsViewport =
        rect.bottom > 0 && rect.top < vh && rect.right > 0 && rect.left < vw;
      const isActive = !!(theater && theater.video === video);

      let show = false;
      if (isActive) {
        show = true;
      } else if (
        extensionActiveHere() &&
        settings.buttonEnabled &&
        bigEnough &&
        intersectsViewport &&
        video.isConnected
      ) {
        show = settings.buttonHoverOnly
          ? pointNearRect(mouse.x, mouse.y, rect, HOVER_PAD_PX)
          : true;
      }

      // Anchor at the video's top-right corner, clamped into the viewport.
      const bw = button.offsetWidth || 90;
      const bh = button.offsetHeight || 30;
      const x = Math.min(
        Math.max(rect.right - bw - BTN_MARGIN_PX, BTN_MARGIN_PX),
        Math.max(BTN_MARGIN_PX, vw - bw - BTN_MARGIN_PX)
      );
      const y = Math.min(
        Math.max(rect.top + BTN_MARGIN_PX, BTN_MARGIN_PX),
        Math.max(BTN_MARGIN_PX, vh - bh - BTN_MARGIN_PX)
      );

      button.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      button.classList.toggle(CLS.btnVisible, show);
      button.classList.toggle(CLS.btnActive, isActive);

      // Only touch the DOM when the state actually changed.
      if (ui.lastActive !== isActive) {
        ui.lastActive = isActive;
        // Inactive → label + icon.  Active → icon only, muted (see CSS).
        button.innerHTML = isActive ? ICON_COLLAPSE : ICON_EXPAND + '<span>Theater</span>';
        button.title = isActive ? 'Exit fake fullscreen' : 'Fake Fullscreen — theater mode';
        button.setAttribute('aria-label', isActive ? 'Exit theater mode' : 'Toggle theater mode for this video');
      }
    }
  }

  /* ================================================================
   * Theater mode — enter / exit
   * ================================================================ */

  function toggleTheater(video) {
    if (theater && theater.video === video) exitTheater();
    else enterTheater(video);
  }

  function enterTheater(video) {
    if (!video || !video.isConnected) return;
    if (theater) exitTheater(); // switching videos restores the old one first

    const saved = {
      cssText:       video.style.cssText,      // snapshot of inline styles
      hadStyleAttr:  video.hasAttribute('style'),
      controls:      video.controls,
      tabindex:      video.getAttribute('tabindex'),
      parent:        video.parentNode,
      nextSibling:   video.nextSibling,
    };

    theater = { video, saved, reparented: false };

    // The class does the heavy lifting (see content.css).
    video.classList.add(CLS.videoActive);
    if (settings.hideNativeControls) {
      try { video.controls = false; } catch { /* some players guard it */ }
    }

    // Let the user drive the player with the keyboard (space / arrows / etc.)
    // while it's the focus of the theater view.
    try {
      video.setAttribute('tabindex', '-1');
      video.focus({ preventScroll: true });
    } catch { /* some players disallow programmatic focus */ }

    if (overlay) overlay.classList.add(CLS.overlayShown);
    lockScroll();

    // Ancestor stacking contexts (transform/filter/…) can bury a fixed
    // element — verify next frame and reparent if needed.
    requestAnimationFrame(() => ensurePaintedOnTop(0));

    notifyActive(true);
    updatePositions();
  }

  function exitTheater() {
    if (!theater) return;
    const { video, saved, reparented } = theater;
    theater = null;

    video.classList.remove(CLS.videoActive);

    try { video.controls = saved.controls; } catch { /* ignore */ }

    // Restore the tabindex we may have set for keyboard control.
    try {
      if (saved.tabindex === null) video.removeAttribute('tabindex');
      else video.setAttribute('tabindex', saved.tabindex);
    } catch { /* ignore */ }

    // Restore exactly what was there before (inline styles only — we
    // never touch stylesheets, so author CSS is untouched).
    try {
      if (saved.hadStyleAttr) video.style.cssText = saved.cssText;
      else { video.style.cssText = ''; video.removeAttribute('style'); }
    } catch { /* ignore */ }

    if (reparented) {
      if (saved.parent && saved.parent.isConnected) {
        try { saved.parent.insertBefore(video, saved.nextSibling); } catch { /* detached */ }
      } else if (!video.isConnected) {
        video.remove(); // orphaned by an SPA navigation — drop it quietly
      }
    }

    if (overlay) overlay.classList.remove(CLS.overlayShown);
    unlockScroll();
    notifyActive(false);
    schedulePositionUpdate();
  }

  /**
   * Sample the central region of the active video with
   * elementFromPoint(); if something else paints above it, the video is
   * trapped inside an ancestor stacking context → reparent it to
   * <html>, which escapes ALL ancestor contexts. Playback continues
   * across DOM moves; the original position is restored on exit.
   */
  function ensurePaintedOnTop(attempt) {
    if (!theater || !theater.video.isConnected) return;

    if (paintsAbovePage(theater.video)) return;

    if (attempt === 0) {
      // Ancestors may still be animating into place — check once more.
      requestAnimationFrame(() => ensurePaintedOnTop(1));
      return;
    }

    try {
      document.documentElement.appendChild(theater.video);
      theater.reparented = true;
      // Equal z-index → later DOM order paints on top, so re-append our
      // widgets to stay above the video.
      if (overlay) document.documentElement.appendChild(overlay);
      for (const [, ui] of tracked) document.documentElement.appendChild(ui.button);
    } catch { /* extremely unlikely; theater still works, maybe under a header */ }
  }

  function paintsAbovePage(video) {
    const r = video.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const fractions = [0.3, 0.5, 0.7];
    let hits = 0;
    let total = 0;
    for (const fx of fractions) {
      for (const fy of fractions) {
        total++;
        const el = document.elementFromPoint(
          r.left + r.width * fx,
          r.top + r.height * fy
        );
        if (el && (el === video || video.contains(el))) hits++;
      }
    }
    return hits >= Math.ceil(total * 0.75); // tolerate letterbox overlays etc.
  }

  /* ----------------------------------------------------------------
   * Scroll lock (with scrollbar-width compensation so the page does
   * not jump when its scrollbar disappears)
   * -------------------------------------------------------------- */

  function lockScroll() {
    const html = document.documentElement;
    const scrollbarWidth = window.innerWidth - html.clientWidth;
    scrollSave = {
      htmlOverflow: html.style.overflow,
      htmlPaddingRight: html.style.paddingRight,
      bodyOverflow: document.body ? document.body.style.overflow : '',
    };
    html.style.overflow = 'hidden';
    html.classList.add(CLS.locked);
    if (document.body) document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) html.style.paddingRight = `${scrollbarWidth}px`;
  }

  function unlockScroll() {
    if (!scrollSave) return;
    const html = document.documentElement;
    html.style.overflow = scrollSave.htmlOverflow;
    html.style.paddingRight = scrollSave.htmlPaddingRight;
    html.classList.remove(CLS.locked);
    if (document.body) document.body.style.overflow = scrollSave.bodyOverflow;
    scrollSave = null;
  }

  /* ================================================================
   * Global listeners
   * ================================================================ */

  window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    schedulePositionUpdate();
  }, { passive: true });

  // capture → catches scrolls of inner containers too
  window.addEventListener('scroll', schedulePositionUpdate, { capture: true, passive: true });
  window.addEventListener('resize', schedulePositionUpdate);

  // Escape exits locally; from the top frame it also asks background to
  // fan out a force-exit so a theater inside another frame closes too.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (theater) {
      e.preventDefault();
      e.stopPropagation();
      exitTheater();
      return;
    }
    if (window.top === window) {
      try { browser.runtime.sendMessage({ type: 'ffs:esc-request' }).catch(noopCatch); } catch { /* noop */ }
    }
  }, true);

  // Double-click on the theater video exits (like native players).
  document.addEventListener('dblclick', (e) => {
    if (!theater) return;
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
    if (path.includes(theater.video)) {
      e.preventDefault();
      e.stopPropagation();
      exitTheater();
    }
  }, true);

  /* ================================================================
   * Messaging protocol with background.js
   *
   *   ffs:probe       bg → frames   "report your best video"
   *   ffs:report      frame → bg    { requestId, score, active }
   *   ffs:toggle      bg → frame    "toggle your best video"
   *   ffs:force-exit  bg → frames   used for cross-frame Escape
   *   ffs:state / esc-request           frame → bg
   * ================================================================ */

  /** Score = visible viewport share, boosted while playing / hovered. */
  function candidateScore(video) {
    if (!video.isConnected) return 0;
    const r = video.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const ix = Math.min(r.right, vw) - Math.max(r.left, 0);
    const iy = Math.min(r.bottom, vh) - Math.max(r.top, 0);
    if (ix <= 0 || iy <= 0) return 0;
    let score = ((ix * iy) / (vw * vh)) * 100;
    if (!video.paused && !video.ended && video.readyState >= 2) score *= 3;
    if (pointNearRect(mouse.x, mouse.y, r, 24)) score *= 1.25;
    return score;
  }

  function bestCandidate() {
    let best = null;
    let bestScore = 0;
    for (const video of tracked.keys()) {
      const s = candidateScore(video);
      if (s > bestScore) { bestScore = s; best = video; }
    }
    return bestScore > 0 ? best : null;
  }

  function toggleBestVideoInThisFrame() {
    if (theater) { exitTheater(); return; }
    const video = bestCandidate();
    if (video) enterTheater(video);
  }

  browser.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case 'ffs:probe': {
        const best = bestCandidate();
        const payload = {
          type: 'ffs:report',
          requestId: msg.requestId,
          // A frame that already owns the theater always wins the round-trip.
          score: theater ? Number.MAX_SAFE_INTEGER : (best ? candidateScore(best) : 0),
          active: !!theater,
        };
        Promise.resolve().then(() => {
          try { browser.runtime.sendMessage(payload).catch(noopCatch); } catch { /* noop */ }
        });
        break;
      }

      case 'ffs:toggle':
        toggleBestVideoInThisFrame();
        break;

      case 'ffs:force-exit':
        if (theater) exitTheater();
        break;
    }
  });

  function notifyActive(active) {
    try { browser.runtime.sendMessage({ type: 'ffs:state', active }).catch(noopCatch); } catch { /* noop */ }
  }

  /* ================================================================
   * Boot
   * ================================================================ */

  // Cheap periodic sweep (shallow) between mutation-driven deep scans.
  setInterval(() => scan(false), 2500);

  function boot() {
    buildOverlayAndListeners();
  }

  function buildOverlayAndListeners() {
    overlay = document.createElement('div');
    overlay.className = CLS.overlay;
    overlay.addEventListener('click', () => {
      if (settings.clickOutsideExits) exitTheater();
    });
    (document.documentElement || document.body).appendChild(overlay);
    applyDimLevel();

    // React to dynamically inserted players (SPA navigations, lazy players).
    const mo = new MutationObserver(() => {
      clearTimeout(boot.__scanTimer);
      boot.__scanTimer = setTimeout(() => scan(true), 150);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });

    scan(true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
