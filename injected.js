/**
 * Fake Fullscreen / Theater Mode — page-world script ("injected.js")
 * ================================================================
 * Declared in manifest.json as a content script with `"world": "MAIN"`
 * (Chrome 111+, Firefox 128+), so it runs in the PAGE's own JavaScript
 * world at document_start — before any page script can cache the
 * original method — and, unlike a <script> tag, it is NOT subject to
 * the page's Content-Security-Policy (YouTube's strict CSP used to
 * block the old script-tag injection). One code path for every
 * browser; it has no extension APIs and talks to content.js only
 * through the shared DOM.
 *
 * What it does
 *   Patches Element.prototype.requestFullscreen (and the legacy
 *   webkit variant). When the content script has flagged interception
 *   as enabled (data-ffs-prevent="1" on <html>) and the request is a
 *   VIDEO fullscreen, the real request is swallowed and a bubbling
 *   `ffs:request-theater` event is dispatched instead — content.js
 *   picks that up and opens theater mode.
 *
 *   A request counts as a video fullscreen when:
 *     a) the target is a <video>, or a container mostly covered by one
 *        (≥45% of its area) — the classic player-container case; or
 *     b) the target is page-level (<html>/<body>, or any element that
 *        covers the whole viewport, like YouTube's ytd-app) AND the page
 *        has a main video the user is clearly watching: the gesture
 *        that triggered the request landed inside that video's player,
 *        or the video is playing / has been played.
 *   Case (b) is the YouTube fix: YouTube fullscreens the DOCUMENT, so
 *   the old rule (a) let the real fullscreen through. Real fullscreen
 *   then flipped YouTube into its own fullscreen layout, the safety net
 *   backed out of it, and YouTube re-laid the player out a second time
 *   while our theater was being built — leaving its controls
 *   mis-sized or unresponsive. Intercepting up-front means YouTube
 *   never leaves its normal layout. Full-page fullscreen of a
 *   slideshow with a stray, never-played video is still left alone.
 *
 * The returned Promise resolves to mimic success — sites that listen
 * for fullscreen errors stay quiet. fullscreenchange never fires (no
 * real fullscreen happened), which players tolerate: their next
 * fullscreen click just re-triggers this path and the content script
 * TOGGLES theater mode, so e.g. YouTube's F key works as expected.
 */

(() => {
  'use strict';

  const proto = Element.prototype;
  if (proto.__ffsPatched) return;
  try {
    Object.defineProperty(proto, '__ffsPatched', { value: true });
  } catch { return; }

  const flag = (name) => {
    try { return document.documentElement.dataset[name] === '1'; } catch { return false; }
  };

  /* ---------------------------------------------------------------
   * Last user gesture — which element did the user click / key on
   * right before the fullscreen request? Lets page-level requests be
   * attributed to the player the user was actually using.
   * ------------------------------------------------------------- */
  let gesture = { target: null, at: 0 };
  const noteGesture = (e) => {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    gesture = { target: path[0] || e.target, at: Date.now() };
  };
  for (const type of ['pointerdown', 'mousedown', 'keydown', 'dblclick']) {
    window.addEventListener(type, noteGesture, { capture: true, passive: true });
  }
  const GESTURE_WINDOW_MS = 1500;

  const area = (r) => Math.max(0, r.width) * Math.max(0, r.height);

  function looksLikePlayer(el, video) {
    try {
      const vr = video.getBoundingClientRect();
      if (vr.width < 100 || vr.height < 60) return false;
      return area(vr) >= 0.45 * Math.max(1, area(el.getBoundingClientRect()));
    } catch {
      return true; // can't measure → trust that it is a player
    }
  }

  function isPageLevel(el) {
    if (el === document.documentElement || el === document.body) return true;
    try {
      const r = el.getBoundingClientRect();
      return r.width >= window.innerWidth * 0.95 && r.height >= window.innerHeight * 0.95;
    } catch { return false; }
  }

  /** Largest visible <video> in the document (≥15% of the viewport). */
  function mainVideo() {
    const vpArea = Math.max(1, window.innerWidth * window.innerHeight);
    let best = null;
    let bestArea = 0;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      const ix = Math.min(r.right, window.innerWidth) - Math.max(r.left, 0);
      const iy = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
      if (ix <= 0 || iy <= 0) continue;
      const a = ix * iy;
      if (a > bestArea) { bestArea = a; best = v; }
    }
    return best && bestArea >= 0.15 * vpArea ? best : null;
  }

  /** Did the latest gesture land inside this video's player box? */
  function gestureInsidePlayer(video) {
    const t = gesture.target;
    if (!t || Date.now() - gesture.at > GESTURE_WINDOW_MS) return false;
    if (t === video) return true;
    let node = video.parentElement;
    for (let i = 0; node && i < 10; i++, node = node.parentElement) {
      if (node === document.body || node === document.documentElement) break;
      if (!looksLikePlayer(node, video)) break; // reached page layout
      if (node.contains(t)) return true;
    }
    return false;
  }

  /** Is this fullscreen request really "make the video big"? */
  function isVideoFullscreen(el) {
    const video = el instanceof HTMLVideoElement
      ? el
      : (typeof el.querySelector === 'function' ? el.querySelector('video') : null);
    if (video && looksLikePlayer(el, video)) return true;
    if (!isPageLevel(el)) return false;
    const main = mainVideo();
    if (!main) return false;
    return gestureInsidePlayer(main) ||
      (!main.paused && !main.ended) ||
      main.currentTime > 0;
  }

  const requestTheater = (el) => {
    el.dispatchEvent(new CustomEvent('ffs:request-theater', {
      bubbles: true,
      composed: true, // cross open shadow boundaries on the way up
    }));
  };

  for (const name of ['requestFullscreen', 'webkitRequestFullscreen']) {
    const original = proto[name];
    if (typeof original !== 'function') continue;

    const patched = function requestFullscreen(options) {
      if (flag('ffsPrevent')) {
        // Theater already open → this press means "exit"; the content
        // script owns that decision.
        if (flag('ffsTheater') || isVideoFullscreen(this)) {
          requestTheater(this);
          return Promise.resolve(); // pretend fullscreen succeeded
        }
      }
      return Reflect.apply(original, this, arguments);
    };
    // Look native to sites that sniff Function.prototype.toString.
    try { Object.defineProperty(patched, 'name', { value: name }); } catch { /* ignore */ }
    try {
      Object.defineProperty(proto, name, {
        value: patched, writable: true, configurable: true, enumerable: true,
      });
    } catch {
      proto[name] = patched;
    }
  }
})();
