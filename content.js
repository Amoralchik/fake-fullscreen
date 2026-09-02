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
    videoActive:  'ffs-video--theater',  // theater on the bare <video> itself
    hostActive:   'ffs-theater-host',    // theater on a player CONTAINER
    videoFill:    'ffs-video--fill',     // <video> inside a container host
    btn:          'ffs-btn',
    btnVisible:   'ffs-btn--visible',
    btnActive:    'ffs-btn--active',
    overlay:      'ffs-overlay',
    overlayShown: 'ffs-overlay--shown',
    locked:       'ffs-scroll-locked',
  };

  const PATH_EXPAND = 'M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4';
  const PATH_COLLAPSE = 'M2 6h4V2M14 6h-4V2M2 10h4v4M14 10h-4v4';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /** Build the expand/collapse SVG icon safely (no innerHTML — AMO linter). */
  function makeIcon(pathD) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '13');
    svg.setAttribute('height', '13');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', pathD);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.7');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    return svg;
  }

  /** Rebuild a theater button's content: active → icon only; inactive → icon + label. */
  function renderButtonContent(button, isActive) {
    button.replaceChildren();
    button.appendChild(makeIcon(isActive ? PATH_COLLAPSE : PATH_EXPAND));
    if (!isActive) {
      const label = document.createElement('span');
      label.textContent = 'Theater';
      button.appendChild(label);
    }
  }

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
    preventNativeFullscreen: true, // redirect requestFullscreen → theater mode
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
  let controlsGuard = null; // MutationObserver keeping native controls stripped
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

  /* ----------------------------------------------------------------
   * Native-fullscreen interception
   *
   * The patch must run in the PAGE's JavaScript world. Two routes:
   *
   *   1. PRIMARY — Firefox Xray waivers: content scripts can modify the
   *      page's own objects via window.wrappedJSObject + exportFunction.
   *      No <script> tag, so strict Content-Security-Policy (YouTube!)
   *      cannot block it. That CSP block was the root cause of bug #1:
   *      the patch never installed, so F presses hit real fullscreen.
   *
   *   2. FALLBACK — classic <script src="…/injected.js"> injection for
   *      runtimes without the waiver APIs (kept in injected.js).
   *
   * Either way the patch reads two plain DOM attributes on <html> (the
   * DOM is shared between worlds):
   *   data-ffs-prevent="1"  → interception is enabled (settings + site)
   *   data-ffs-theater="1"  → a theater session is live → press = EXIT
   * -------------------------------------------------------------- */

  function installInterception() {
    if (!patchViaXray()) injectPageScript();
  }

  function pageFlag(name) {
    try { return document.documentElement.dataset[name] === '1'; } catch { return false; }
  }

  function dispatchTheaterEvent(el) {
    el.dispatchEvent(new CustomEvent('ffs:request-theater', { bubbles: true, composed: true }));
  }

  /** "Looks like a player": video ≥45% of the fullscreen target's area. */
  function looksLikePlayer(el, video) {
    try {
      const vr = video.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      if (vr.width < 100 || vr.height < 60) return false;
      return (vr.width * vr.height) >= 0.45 * Math.max(1, er.width * er.height);
    } catch { return true; }
  }

  /**
   * Page-level elements must never become the theater host. YouTube
   * fullscreens <html> (yes, the document element — its own fullscreen
   * button calls documentElement.requestFullscreen()), and theatering
   * html/body "works" in a nightmare way: the dark overlay is a CHILD of
   * html, so it paints above the buried video, while every
   * elementFromPoint sample still "hits" the host — the rescue ladder
   * sees a perfectly painted theater and never promotes anything. The
   * user gets a dimmed page and no video. Redirects from such targets
   * fall back to findPlayerHost() instead (bug #5).
   */
  function isPageLevel(el) {
    return el === document.documentElement || el === document.body;
  }

  function patchViaXray() {
    try {
      const pageWin = window.wrappedJSObject;
      if (!pageWin || typeof exportFunction !== 'function') return false;
      const proto = pageWin.Element && pageWin.Element.prototype;
      if (!proto) return false;
      if (proto.ffsPatched) return true; // already patched in this frame

      const okPromise = () => pageWin.Promise.resolve();

      const makePatched = (original) => exportFunction(function patchedRequestFullscreen(options) {
        // Body executes with content-script scope; `this` is the page element.
        if (pageFlag('ffsPrevent')) {
          // Theater already open → this press means "exit"; the content
          // script owns that decision.
          if (pageFlag('ffsTheater')) {
            dispatchTheaterEvent(this);
            return okPromise();
          }
          const video = this.tagName === 'VIDEO'
            ? this
            : (typeof this.querySelector === 'function' ? this.querySelector('video') : null);
          if (video && looksLikePlayer(this, video)) {
            dispatchTheaterEvent(this);
            return okPromise();
          }
        }
        return Reflect.apply(original, this, [options]);
      }, pageWin);

      if (typeof proto.requestFullscreen === 'function') {
        proto.requestFullscreen = makePatched(proto.requestFullscreen);
      }
      if (typeof proto.webkitRequestFullscreen === 'function') {
        proto.webkitRequestFullscreen = makePatched(proto.webkitRequestFullscreen);
      }
      proto.ffsPatched = true;
      return true;
    } catch {
      return false;
    }
  }

  /** Fallback: inject the page-world patch file (blocked by strict CSP). */
  function injectPageScript() {
    try {
      const s = document.createElement('script');
      s.src = browser.runtime.getURL('injected.js');
      s.onload = () => s.remove(); // patch is installed; tag not needed anymore
      (document.head || document.documentElement).appendChild(s);
    } catch { /* fullscreenchange safety net still applies */ }
  }

  /** Reflect the current effective setting onto <html data-ffs-prevent>. */
  function syncPreventFlag() {
    try {
      document.documentElement.dataset.ffsPrevent =
        settings.preventNativeFullscreen && extensionActiveHere() ? '1' : '0';
    } catch { /* documentElement not ready yet — retried on next change */ }
  }

  browser.storage.onChanged.addListener((_changes, _area) => {
    loadSettings().then(() => {
      syncPreventFlag();
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
    // If the active video/host was ripped out mid-theater → exit gracefully.
    if (theater && (!theater.host.isConnected || !theater.video.isConnected)) exitTheater();

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
    renderButtonContent(button, false);
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
        // The floating-button toggle also hides the exit icon (bug #3) —
        // Esc / double-click / overlay click / fullscreen-key remain.
        show = settings.buttonEnabled;
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
        renderButtonContent(button, isActive);
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

  /**
   * Does el carry the site's own player chrome (control bar, title
   * gradient, …) as direct children outside the video's subtree?
   * That element IS the player root — the right thing to theater.
   */
  function hasPlayerChrome(el, video) {
    for (const child of el.children) {
      if (child === video || child.contains(video)) continue;
      const r = child.getBoundingClientRect();
      if (r.width >= 24 && r.height >= 8) return true;
    }
    return false;
  }

  /**
   * Climb from the <video> through same-size wrappers to the outermost
   * "player" container. Custom players (YouTube, Vimeo, …) keep their
   * control bars INSIDE that container — theatering the container keeps
   * the site's own UI visible and clickable in theater mode (bug #2).
   * We stop climbing as soon as an ancestor is meaningfully bigger:
   * that's page layout, not the player — or as soon as an ancestor
   * carries the site's own player chrome (that's the player root).
   *
   * Empty boxes are climbed THROUGH, not stopped at: players that
   * absolutely position their <video> leave the direct wrapper with a
   * zero box (YouTube's .html5-video-container is position:relative
   * with height 0 because the video inside is out of flow). Stopping
   * there used to strand the control bar on the dimmed page (bug #4).
   */
  function findPlayerHost(video) {
    let host = video;
    let el = video.parentElement;
    let realSteps = 0;
    let emptySteps = 0;
    while (
      el && realSteps < 8 && emptySteps < 8 &&
      el !== document.body && el !== document.documentElement
    ) {
      const er = el.getBoundingClientRect();
      // display:contents / hidden / empty shells have no box to theater.
      if (er.width === 0 || er.height === 0) {
        emptySteps++;
        el = el.parentElement;
        continue;
      }
      realSteps++;
      const hr = host.getBoundingClientRect();
      if (er.width > Math.max(hr.width * 1.3, hr.width + 80)) break;
      if (er.height > Math.max(hr.height * 1.45, hr.height + 140)) break;
      host = el;
      if (hasPlayerChrome(el, video)) break;
      el = el.parentElement;
    }
    return host;
  }

  /**
   * Companion to findPlayerHost: percentage sizing on the <video>
   * resolves against its containing block, which is often one of those
   * zero-sized shells. Inside a theatered container the video would
   * collapse to height 0 (YouTube again — its inline width/height are
   * overridden by .ffs-video--fill, and 100% of a 0-height shell is 0).
   * Give every empty wrapper between video and host a 100% box;
   * exitTheater undoes this exactly. Callers pass an array to collect
   * the touched elements for restoration.
   */
  function stretchEmptyWrappers(video, host, out) {
    let node = video.parentElement;
    let guard = 0;
    while (node && node !== host && guard++ < 8) {
      const r = node.getBoundingClientRect();
      const needW = r.width === 0;
      const needH = r.height === 0;
      if (needW || needH) {
        out.push({
          el: node,
          hadStyleAttr: node.hasAttribute('style'),
          cssText: node.style.cssText,
        });
        if (needW) node.style.setProperty('width', '100%', 'important');
        if (needH) node.style.setProperty('height', '100%', 'important');
      }
      node = node.parentElement;
    }
  }

  /**
   * @param {HTMLVideoElement} video  the video to theater
   * @param {Element} [host]  element to elevate — the fullscreen request
   *   target when redirected (authoritative), else the climb-up heuristic
   */
  function enterTheater(video, host) {
    if (!video || !video.isConnected) return;
    if (theater) exitTheater(); // switching videos restores the old one first

    if (!(host instanceof Element) || !host.contains(video)) host = findPlayerHost(video);

    const saved = {
      cssText:      host.style.cssText,        // snapshot of inline styles
      hadStyleAttr: host.hasAttribute('style'),
      tabindex:     host.getAttribute('tabindex'),
      popoverAttr:  host.getAttribute('popover'),
      parent:       host.parentNode,
      nextSibling:  host.nextSibling,
      controls:     video.controls,
    };

    theater = { video, host, saved, reparented: false, usedPopover: false, buttonPopover: false, stretched: [] };

    // A bare video theaters itself; a container keeps its own controls.
    if (host === video) video.classList.add(CLS.videoActive);
    else {
      host.classList.add(CLS.hostActive);
      video.classList.add(CLS.videoFill);
      // The video must fill the elevated host — stretch any zero-sized
      // shell it is wrapped in (percentage sizing resolves against it).
      stretchEmptyWrappers(video, host, theater.stretched);
    }

    // Tell the page-world patch a theater session is live in this frame —
    // a second fullscreen press must find us and EXIT (bug #1).
    try { document.documentElement.dataset.ffsTheater = '1'; } catch { /* ignore */ }

    if (settings.hideNativeControls) {
      try { video.controls = false; } catch { /* some players guard it */ }
      // Many players re-add the `controls` attribute on play / hover /
      // loadedmetadata — keep it stripped for the whole session.
      controlsGuard = new MutationObserver(() => {
        if (video.controls) { try { video.controls = false; } catch { /* ignore */ } }
      });
      controlsGuard.observe(video, { attributes: true, attributeFilter: ['controls'] });
    }

    // Let the user drive the player with the keyboard (space / arrows / etc.)
    // while it's the focus of the theater view.
    try {
      host.setAttribute('tabindex', '-1');
      host.focus({ preventScroll: true });
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
    const { video, host, saved, reparented, usedPopover, buttonPopover, stretched } = theater;
    theater = null;

    // Undo the top-layer popover first (if the rescue ladder used it).
    if (usedPopover) {
      try { if (host.matches(':popover-open')) host.hidePopover(); } catch { /* ignore */ }
      try {
        if (saved.popoverAttr === null) host.removeAttribute('popover');
        else host.setAttribute('popover', saved.popoverAttr);
      } catch { /* ignore */ }
    }
    if (buttonPopover) {
      const ui = tracked.get(video);
      if (ui) {
        try { if (ui.button.matches(':popover-open')) ui.button.hidePopover(); } catch { /* ignore */ }
        ui.button.removeAttribute('popover');
      }
    }

    host.classList.remove(CLS.hostActive);
    video.classList.remove(CLS.videoActive, CLS.videoFill);

    try { delete document.documentElement.dataset.ffsTheater; } catch { /* ignore */ }

    if (controlsGuard) { controlsGuard.disconnect(); controlsGuard = null; }
    try { video.controls = saved.controls; } catch { /* ignore */ }

    // Restore the tabindex we may have set for keyboard control.
    try {
      if (saved.tabindex === null) host.removeAttribute('tabindex');
      else host.setAttribute('tabindex', saved.tabindex);
    } catch { /* ignore */ }

    // Restore exactly what was there before (inline styles only — we
    // never touch stylesheets, so author CSS is untouched).
    try {
      if (saved.hadStyleAttr) host.style.cssText = saved.cssText;
      else { host.style.cssText = ''; host.removeAttribute('style'); }
    } catch { /* ignore */ }

    // Undo the empty-wrapper stretch (see stretchEmptyWrappers).
    for (const st of stretched || []) {
      try {
        if (st.hadStyleAttr) st.el.style.cssText = st.cssText;
        else { st.el.style.cssText = ''; st.el.removeAttribute('style'); }
      } catch { /* ignore */ }
    }

    if (reparented) {
      if (saved.parent && saved.parent.isConnected) {
        try { saved.parent.insertBefore(host, saved.nextSibling); } catch { /* detached */ }
      } else if (!host.isConnected) {
        host.remove(); // orphaned by an SPA navigation — drop it quietly
      }
    }

    if (overlay) overlay.classList.remove(CLS.overlayShown);
    unlockScroll();
    notifyActive(false);
    schedulePositionUpdate();
  }

  /**
   * Self-healing rescue ladder. Ancestor stacking contexts / fixed
   * containing blocks (transform, filter, …) can bury or displace the
   * theater host. Each animation frame we verify and escalate:
   *
   *   0  settle, recheck
   *   1  popover "top layer" — escapes ALL stacking contexts WITHOUT
   *      moving the element, so site CSS/JS keep working (least damage)
   *   2  reparent the host to <html> (escapes ancestor traps by moving)
   *   3  host-container mode still not rendering → downgrade to
   *      bare-video theater (the classic mode)
   *   4  even that failed → restore the page instead of trapping it dark
   */
  function ensurePaintedOnTop(attempt) {
    if (!theater) return;
    const { host, video } = theater;
    if (!host.isConnected || !video.isConnected) return;

    if (looksGood(host, video)) return;

    if (attempt === 0) {
      requestAnimationFrame(() => ensurePaintedOnTop(1));
      return;
    }

    if (attempt === 1 && !theater.usedPopover && typeof host.showPopover === 'function') {
      try {
        if (!host.hasAttribute('popover')) host.popover = 'manual';
        host.showPopover();
        theater.usedPopover = true;
        // The exit button must beat the host's top layer too.
        const ui = tracked.get(video);
        if (ui && !ui.button.hasAttribute('popover')) {
          ui.button.popover = 'manual';
          ui.button.showPopover();
          theater.buttonPopover = true;
        }
      } catch { /* fall through to the reparent stage */ }
      requestAnimationFrame(() => ensurePaintedOnTop(2));
      return;
    }

    if (attempt <= 2 && !theater.reparented) {
      try {
        document.documentElement.appendChild(host);
        theater.reparented = true;
        // Equal z-index → later DOM order paints on top, so re-append our
        // widgets to stay above the host.
        if (overlay) document.documentElement.appendChild(overlay);
        for (const [, ui] of tracked) document.documentElement.appendChild(ui.button);
      } catch { /* fall through */ }
      requestAnimationFrame(() => ensurePaintedOnTop(3));
      return;
    }

    if (host !== video) {
      const v = video;
      exitTheater();
      enterTheater(v, v); // bare-video mode; its own ladder starts fresh
      return;
    }

    exitTheater(); // last resort: leave the page as we found it
  }

  /** Host actually visible AND (in container mode) the video not collapsed. */
  function looksGood(host, video) {
    if (!paintsAbovePage(host)) return false;
    if (host !== video) {
      const vr = video.getBoundingClientRect();
      if (vr.width < 40 || vr.height < 40) return false; // black host, dead video
    }
    return true;
  }

  function paintsAbovePage(host) {
    const r = host.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    // 5×5 grid across the whole host, and EVERY sample must land inside
    // it. A fixed z-max element has nothing legitimate painting above it
    // — partial occlusion (site masthead, sidebar column, cookie bars…)
    // is exactly the burial this ladder exists to escape. Tolerating a
    // few misses used to leave e.g. YouTube's header visible on top of
    // the theater while the check still reported "good".
    const fractions = [0.1, 0.3, 0.5, 0.7, 0.9];
    for (const fx of fractions) {
      for (const fy of fractions) {
        const el = document.elementFromPoint(
          r.left + r.width * fx,
          r.top + r.height * fy
        );
        if (!(el && (el === host || host.contains(el)))) return false;
      }
    }
    return true;
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

  // Double-click on the theater host exits (like native players).
  document.addEventListener('dblclick', (e) => {
    if (!theater) return;
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
    if (path.includes(theater.host)) {
      e.preventDefault();
      e.stopPropagation();
      exitTheater();
    }
  }, true);

  /* ----------------------------------------------------------------
   * Native fullscreen → theater redirect
   *
   * Primary path: injected.js (page world) swallows the
   * requestFullscreen call and dispatches this bubbling DOM event.
   * e.target is the element fullscreen was requested on (a <video> or
   * its player container). We TOGGLE so a second fullscreen press
   * (e.g. YouTube's F key) exits cleanly.
   * -------------------------------------------------------------- */
  document.addEventListener('ffs:request-theater', (e) => {
    if (!settings.preventNativeFullscreen || !extensionActiveHere()) return;
    // A fullscreen press while theater is open means "exit" (bug #1) —
    // works even if the host was re-parented out of its original place.
    if (theater) { exitTheater(); return; }

    // e.target is the element fullscreen was requested on — the player
    // CONTAINER for custom players (its own controls stay usable), or
    // the <video> itself for native ones. That target is authoritative
    // — except when it is page-level (html/body): YouTube fullscreens
    // <html>, which must not be theatered (see isPageLevel). Then the
    // climb-up heuristic picks the real player container instead.
    const target = e.target instanceof Element ? e.target : null;
    let video = null;
    let host = null;
    if (target instanceof HTMLVideoElement) {
      video = host = target;
    } else if (target && !isPageLevel(target)) {
      video = target.querySelector('video');
      if (video) host = target;
    }
    // Page-level target (or no video inside): score every tracked video
    // and let the best one host the theater.
    if (!video) video = bestCandidate();
    if (video) enterTheater(video, host);
  }, true);

  /**
   * Safety net: if real fullscreen still slipped through (page cached
   * the original method, CSP blocked injection, …), back out of it.
   * A fullscreen press while theater is open means "exit"; otherwise
   * reroute into theater mode.
   */
  document.addEventListener('fullscreenchange', () => {
    if (!settings.preventNativeFullscreen || !extensionActiveHere()) return;
    const el = document.fullscreenElement;
    if (!el) return;

    const video = el instanceof HTMLVideoElement
      ? el
      : (typeof el.querySelector === 'function' ? el.querySelector('video') : null);
    if (!video && !theater) return; // full-page fullscreen of something else — not ours

    try { document.exitFullscreen(); } catch { /* ignore */ }
    if (theater) exitTheater();
    // The fullscreen target doubles as the theater host (player container)
    // — unless it is page-level (YouTube fullscreens <html>): then the
    // climb-up heuristic picks the real player container instead.
    else if (video) {
      enterTheater(
        video,
        el instanceof Element && !isPageLevel(el) && !(el instanceof HTMLVideoElement) ? el : null
      );
    }
  }, true);

  /* ================================================================
   * Messaging protocol with background.js
   *
   *   ffs:probe       bg → frames   "report your best video"
   *   ffs:report      frame → bg    { requestId, score, active }
   *   ffs:toggle      bg → frame    "toggle your best video"
   *   ffs:force-exit  bg → frames   used for cross-frame Escape
   *   ffs:state / esc-request       frame → bg
   *   ffs:site-info   popup → frame "what host is this page?" (top frame answers)
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

      // The popup asks the TOP frame which site this is and whether the
      // extension is active here. Other frames stay silent so the popup
      // always describes the page's own host.
      case 'ffs:site-info': {
        if (window.top !== window) return undefined;
        return Promise.resolve({
          hostname: currentHostname(),
          active: extensionActiveHere(),
          theaterActive: !!theater,
        });
      }
    }
  });

  function notifyActive(active) {
    try { browser.runtime.sendMessage({ type: 'ffs:state', active }).catch(noopCatch); } catch { /* noop */ }
  }

  /* ================================================================
   * Boot
   * ================================================================ */

  // 1. Page-world patch must exist before any page script caches the
  //    original requestFullscreen — install immediately (document_start).
  installInterception();

  // 2. Load settings, then flag interception on <html data-ffs-prevent>.
  loadSettings().then(syncPreventFlag).catch(noopCatch);

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
