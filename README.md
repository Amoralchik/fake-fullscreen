# Fake Fullscreen – Theater Mode

A lightweight Firefox / **Zen Browser** WebExtension (Manifest V3) that puts
**any HTML5 `<video>`** into a "fake fullscreen" theater view covering the
whole tab — with **zero OS-level fullscreen**, zero frameworks, and minimal
permissions (`storage` only).

```
fake-fullscreen/
├── manifest.json      # MV3 manifest (Firefox/Zen flavor)
├── content.js         # detection + theater logic (runs in every frame)
├── content.css        # styles for the button, overlay and theater video
├── background.js      # routes toolbar click / shortcut to the right frame
├── options.html/.js   # settings (per-site on/off rules, button & overlay)
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
| Enter theater | Hover a video → **Theater** button · toolbar icon · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> (<kbd>⌃⇧F</kbd> on macOS) |
| Exit | The small icon (top-right of the video) · <kbd>Esc</kbd> · double-click the video · optional overlay click |
| Change shortcut | `about:addons` → ⚙ gear → **Manage Extension Shortcuts** |
| Settings | Toolbar icon right-click → *Manage extension* → *Preferences* |

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
- **Per-site on/off rules** — a default (run everywhere vs opt-in) plus an
  explicit domain list, each rule toggled On or Off (subdomains included)
- Show/hide the floating buttons; hover-only visibility
- Hide native controls while in theater
- Click-outside-to-exit toggle
- Backdrop darkness slider

Settings sync via Firefox Sync when available (`storage.sync`, falling back
to `storage.local`). Changes apply to open tabs immediately.

## How it works

1. **Detection** — each frame scans for `<video>` elements *recursively
   through open Shadow DOM roots*, then keeps watching with a
   `MutationObserver` (SPA navigations, lazy-loaded players) plus a cheap
   periodic sweep. Videos inside iframes get their own content-script
   instance (`all_frames: true`).
2. **One toggle per tab** — pressing the shortcut/toolbar makes
   `background.js` run a tiny probe round-trip: every frame privately reports
   its best candidate (visible area × playing/hover bonuses); background then
   sends a *targeted* `{frameId}` toggle so exactly one video flips, even when
   a page and an embed both contain players. A frame whose theater is already
   active always wins, guaranteeing clean off-toggles.
3. **Stacking-context rescue** — after activation, the script samples the
   video area with `elementFromPoint()`; if an ancestor stacking context
   (transform/filter/…) is burying it, the video is temporarily re-parented to
   `<html>` (playback survives DOM moves) and put back exactly where it was on
   exit.
4. **Cross-frame Escape** — if the focused frame has no local theater,
   `Esc` is forwarded through the background page so a theater inside another
   frame still closes.

### Known limitations

- **Closed** shadow roots are invisible to any content script — videos there
  can't be found (rare; most players use open roots).
- Players that render into `<canvas>`/WebGL instead of `<video>` aren't
  covered by design.
- In cross-origin iframes the video fills the **iframe's** viewport, not the
  whole tab (frames can't escape their own document).
- DRM videos (Netflix etc.) work visually like any other `<video>`, but those
  sites' UI layers may fight back; the reparenting rescue handles most cases.

## Customization cheat-sheet

| Want to change… | Look at |
| --- | --- |
| Button style / position offsets | `.ffs-btn` in `content.css`, `BTN_MARGIN_PX` / `HOVER_PAD_PX` in `content.js` |
| Theater geometry (e.g. fill vs letterbox) | `video.ffs-video--theater` in `content.css` |
| Default settings | `DEFAULTS` in `content.js` **and** `options.js` (keep in sync) |
| Keyboard shortcut | `commands` in `manifest.json`, or browser settings UI |
| Shortcut routing / badge | `background.js` |
| Icons | edit shapes in `tools/gen_icons.py`, then `python3 tools/gen_icons.py` |

## Packaging as a .zip

From inside the `fake-fullscreen/` folder:

```sh
zip -r ../fake-fullscreen-1.0.0.zip \
    manifest.json content.js content.css background.js \
    options.html options.js icons README.md
```

(or `web-ext build` if you use [`web-ext`](https://github.com/mozilla/web-ext),
which also gives you `web-ext lint` for AMO-readiness). The zip root must
contain `manifest.json` directly.

## Quick test checklist

- [ ] YouTube: hover player → Theater → Esc exits, controls still work.
- [ ] Page with header/nav overlapping: video still covers everything
      (auto-reparent rescue).
- [ ] Site with several videos: shortcut toggles the biggest/playing one;
      activating another switches cleanly.
- [ ] Embedded iframe player: toggles from within the frame; Esc works.
- [ ] Controls: in theater, <kbd>Space</kbd>/arrows drive the player; the
      exit control is just a subtle icon.
- [ ] Options: add a per-site rule (On/Off) → button/disabled state updates
      live on that site; darkness slider updates live.
- [ ] Git: `dist/` is ignored; `git status` shows source only.
