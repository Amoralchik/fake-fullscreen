/**
 * Fake Fullscreen / Theater Mode — page-world script ("injected.js")
 * ================================================================
 * Runs in the PAGE's JavaScript world (injected as a <script src> by
 * content.js, declared in web_accessible_resources). It needs to live
 * here because content scripts run in an isolated world and therefore
 * cannot patch the page's own Element.prototype methods.
 *
 * What it does
 *   Patches Element.prototype.requestFullscreen (and the legacy
 *   webkit variant). When the content script has flagged interception
 *   as enabled (data-ffs-prevent="1" on <html>) and the request target
 *   looks like a video player, the real fullscreen request is
 *   swallowed and a bubbling `ffs:request-theater` event is dispatched
 *   instead — content.js picks that up and opens theater mode.
 *
 *   "Looks like a player": the target is a <video> itself, or a
 *   container whose area is mostly covered by a <video> (≥45%). This
 *   keeps full-page fullscreen (slideshows, editors, …) untouched even
 *   when a stray <video> exists somewhere on the page.
 *
 * The returned Promise resolves to mimic success — sites that listen
 * for fullscreen errors stay quiet. fullscreenchange never fires (no
 * real fullscreen happened), which most players tolerate: their next
 * fullscreen click just re-triggers this path, and the content script
 * TOGGLES theater mode, so e.g. YouTube's F key works as expected.
 */

(() => {
  'use strict';

  if (window.__ffsInjected) return;
  try {
    Object.defineProperty(window, '__ffsInjected', { value: true, configurable: true });
  } catch { return; }

  /** Content script flips this attribute to "1"/"0" based on settings. */
  function interceptionEnabled() {
    try {
      return document.documentElement.dataset.ffsPrevent === '1';
    } catch {
      return false;
    }
  }

  /**
   * Set by content.js while a theater session is live in this frame.
   * Needed because the theater video may be RE-PARENTED out of its
   * player container — then a second fullscreen press finds no <video>
   * inside the container and would otherwise slip into real fullscreen.
   */
  function theaterActive() {
    try {
      return document.documentElement.dataset.ffsTheater === '1';
    } catch {
      return false;
    }
  }

  function findVideoIn(el) {
    if (el instanceof HTMLVideoElement) return el;
    if (el && typeof el.querySelector === 'function') {
      return el.querySelector('video');
    }
    return null;
  }

  function looksLikePlayer(el, video) {
    try {
      const vr = video.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      if (vr.width < 100 || vr.height < 60) return false;
      const targetArea = Math.max(1, er.width * er.height);
      return (vr.width * vr.height) >= 0.45 * targetArea;
    } catch {
      return true; // can't measure → trust that it is a player
    }
  }

  function hijack(el) {
    const video = findVideoIn(el);
    if (!video || !looksLikePlayer(el, video)) return false;
    dispatchTheaterRequest(el);
    return true;
  }

  const proto = Element.prototype;

  const dispatchTheaterRequest = (el) => {
    el.dispatchEvent(
      new CustomEvent('ffs:request-theater', {
        bubbles: true,
        composed: true, // cross open shadow boundaries on the way up
      })
    );
  };

  for (const name of ['requestFullscreen', 'webkitRequestFullscreen']) {
    const original = proto[name];
    if (typeof original !== 'function') continue;

    proto[name] = function patchedRequestFullscreen(options) {
      if (interceptionEnabled()) {
        // Theater already open → this press means "exit"; let the
        // content script handle it (it owns the theater state).
        if (theaterActive()) {
          dispatchTheaterRequest(this);
          return Promise.resolve();
        }
        if (hijack(this)) {
          return Promise.resolve(); // pretend fullscreen succeeded
        }
      }
      return original.call(this, options);
    };
    try { proto[name].__ffsWrapped = true; } catch { /* ignore */ }
  }
})();
