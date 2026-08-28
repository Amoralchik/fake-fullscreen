# Fake Fullscreen – Theater Mode

A lightweight Firefox / **Zen Browser** WebExtension (Manifest V3) that puts
**any HTML5 `<video>`** into a "fake fullscreen" theater view covering the
whole tab — with **zero OS-level fullscreen**, zero frameworks, and minimal
permissions (`storage` only).

```
fake-fullscreen/
├── manifest.json      # MV3 manifest (Firefox/Zen flavor)
├── popup.html/.js     # toolbar control panel (Dark Reader-style switches)
├── content.js         # detection + theater logic (runs in every frame)
├── content.css        # styles for the button, overlay and theater video
├── injected.js        # page-world patch: requestFullscreen → theater redirect
├── background.js      # shortcut routing + cross-frame coordination
├── options.html/.js   # full settings (per-site on/off rules, appearance)
├── icons/             # generated 16/32/48/128 PNGs
└── tools/gen_icons.py # regenerates the icons (pure stdlib Python)
```

---

## Install (temporary load) in Zen or Firefox

1. Open **`about:debugging#/runtime/this-firefox`** in the address bar.
2. Click **“Load Temporary Add-on…”**
3. Select this folder's **`manifest.json`**.
4. Done — open any site with a video (YouTube, Vimeo, direct `.mp4`, …),
   hover the video and hit the **Theater** pill button.

Notes:

- Temporary add-ons are **removed when the browser fully restarts** — reload
  them the same way. This is the standard unsigned-extension workflow; Zen
  behaves exactly like Firefox here.
- To use it in Private Windows: `about:addons` → *Extensions* → Fake
  Fullscreen → **Run in Private Windows → Allow**.

## Using it

| Action | How |
| --- | --- |
| Control panel | Click the **toolbar icon** — master switch, fullscreen redirect, per-site toggle |
| Enter theater | Hover a video → **Theater** button · player’s own fullscreen button (redirected) · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> (<kbd>⌃⇧F</kbd> on macOS) |
| Exit | The small icon (top-right of the video) · <kbd>Esc</kbd> · double-click the video · player’s fullscreen button again |
| Change shortcut | `about:addons` → ⚙ gear → **Manage Extension Shortcuts** |
| Full settings | Control panel → *Settings…*, or `about:addons` → extension → *Preferences* |

**Headline behavior:** with *Redirect fullscreen* on (default), any player
that tries to enter native fullscreen — YouTube’s fullscreen button, the
<kbd>F</kbd> key, custom players calling `requestFullscreen()` — is silently
rerouted into theater mode. No OS fullscreen ever happens. Turn it off from
the control panel when you want the real thing back.

What you get in theater mode: the video becomes
`position: fixed; inset: 0 0 auto auto; width:100vw; height:100vh;
z-index:2147483647` (letterboxed with `object-fit: contain`, never stretched),
the page behind dims to black, scrolling is locked (with scrollbar-width
compensation so nothing jumps), and your original inline styles are restored
on exit.

**Player controls stay in your hands.** Native video controls are kept on by
default (the *“Hide native controls”* option can turn them off), and on
entering theater the video is focused so keyboard shortcuts work too —
<kbd>Space</kbd> play/pause, <kbd>←</kbd>/<kbd>→</kbd> seek, <kbd>↑</kbd>/<kbd>↓</kbd>
volume. The exit control is intentionally a small, low-contrast icon (no red
beacon, no text) so it stays out of the way.

## Options

- Master on/off switch
- **Redirect native fullscreen to theater mode** (on by default)
- **Per-site on/off rules** — a default (run everywhere vs opt-in) plus an
  explicit domain list, each rule toggled On or Off (subdomains included)
- Show/hide the floating buttons; hover-only visibility
- Hide native controls while in theater
- Click-outside-to-exit toggle
- Backdrop darkness slider

Settings sync via Firefox Sync when available (`storage.sync`, falling back
to `storage.local`). Changes apply to open tabs immediately.

## How it works

1. **Fullscreen interception** — `injected.js` runs in the *page's* JS world
   (content scripts can't patch page prototypes) and wraps
   `Element.prototype.requestFullscreen`. When the content script has set
   `<html data-ffs-prevent="1">` and the request target is a video — or a
   container that is *mostly* video (≥45% area, so full-page fullscreen of
   slideshows etc. is left alone) — the call is swallowed and a bubbling
   `ffs:request-theater` event is dispatched instead; `content.js` toggles
   theater mode. A `fullscreenchange` listener catches anything the patch
   misses and reroutes it.
2. **Detection** — each frame scans for `<video>` elements *recursively
   through open Shadow DOM roots*, then keeps watching with a
   `MutationObserver` (SPA navigations, lazy-loaded players) plus a cheap
   periodic sweep. Videos inside iframes get their own content-script
   instance (`all_frames: true`).
3. **One toggle per tab** — pressing the shortcut makes `background.js` run a
   tiny probe round-trip: every frame privately reports its best candidate
   (visible area × playing/hover bonuses); background then sends a *targeted*
   `{frameId}` toggle so exactly one video flips, even when a page and an
   embed both contain players. A frame whose theater is already active
   always wins, guaranteeing clean off-toggles.
4. **Stacking-context rescue** — after activation, the script samples the
   video area with `elementFromPoint()`; if an ancestor stacking context
   (transform/filter/…) is burying it, the video is temporarily re-parented to
   `<html>` (playback survives DOM moves) and put back exactly where it was on
   exit.
5. **Cross-frame Escape** — if the focused frame has no local theater,
   `Esc` is forwarded through the background page so a theater inside another
   frame still closes.

### Known limitations

- **Closed** shadow roots are invisible to any content script — videos there
  can't be found (rare; most players use open roots).
- Players that render into `<canvas>`/WebGL instead of `<video>` aren't
  covered by design.
- In cross-origin iframes the video fills the **iframe's** viewport, not the
  whole tab (frames can't escape their own document).
- A site that caches `Element.prototype.requestFullscreen` before our patch
  loads bypasses the redirect (the `fullscreenchange` safety net usually
  still catches it). Pages with a strict CSP that blocks extension script
  injection fall back to the safety net too.
- <kbd>F11</kbd> (browser window fullscreen) is browser UI, not the
  Fullscreen API — intentionally untouched.
- DRM videos (Netflix etc.) work visually like any other `<video>`, but those
  sites' UI layers may fight back; the reparenting rescue handles most cases.

## Customization cheat-sheet

| Want to change… | Look at |
| --- | --- |
| Control panel layout / switches | `popup.html` (styles inline), `popup.js` |
| Fullscreen-intercept heuristic | `looksLikePlayer()` in `injected.js` (45% area rule) |
| Button style / position offsets | `.ffs-btn` in `content.css`, `BTN_MARGIN_PX` / `HOVER_PAD_PX` in `content.js` |
| Theater geometry (e.g. fill vs letterbox) | `video.ffs-video--theater` in `content.css` |
| Default settings | `DEFAULTS` in `content.js` **and** `options.js` (keep in sync) |
| Keyboard shortcut | `commands` in `manifest.json`, or browser settings UI |
| Shortcut routing / badge | `background.js` |
| Icons | edit shapes in `tools/gen_icons.py`, then `python3 tools/gen_icons.py` |

## Packaging as a .zip

From inside the `fake-fullscreen/` folder:

```sh
zip -r ../fake-fullscreen-1.1.0.zip \
    manifest.json popup.html popup.js injected.js \
    content.js content.css background.js \
    options.html options.js icons README.md
```

(or `web-ext build` if you use [`web-ext`](https://github.com/mozilla/web-ext),
which also gives you `web-ext lint` for AMO-readiness). The zip root must
contain `manifest.json` directly.

## Quick test checklist

- [ ] Control panel: toolbar icon → master switch pauses/resumes everywhere;
      site chip shows the current host and its effective On/Off.
- [ ] YouTube: press <kbd>F</kbd> / click fullscreen → theater mode opens,
      no OS fullscreen; press again → exits.
- [ ] Redirect off in panel → native fullscreen works normally again.
- [ ] Full-page fullscreen (e.g. a presentation site) is NOT hijacked even
      with a stray video on the page.
- [ ] Page with header/nav overlapping: video still covers everything
      (auto-reparent rescue).
- [ ] Site with several videos: shortcut toggles the biggest/playing one.
- [ ] Embedded iframe player: toggles from within the frame; Esc works.
- [ ] Controls: in theater, <kbd>Space</kbd>/arrows drive the player; the
      exit control is just a subtle icon.
- [ ] Floating button OFF in the panel → no buttons at all (exit via
      <kbd>Esc</kbd> / double-click / fullscreen key).
- [ ] Options: add a per-site rule (On/Off) → state updates live on that
      site; darkness slider updates live.
