# Fake Fullscreen – Theater Mode

A lightweight cross-browser WebExtension (Manifest V3) for **Firefox / Zen**
and **Chromium browsers (Chrome, Brave, Edge, …)** that puts **any HTML5
`<video>`** into a "fake fullscreen" theater view covering the whole tab —
with **zero OS-level fullscreen**, zero frameworks, and minimal permissions
(`storage`, `contextMenus`).

**Why:** split-view browsing. Keep two or three pages side by side and
let one of them be *just the video* — no masthead, comments, sidebar or
theater-mode chrome around it, while the player's own controls (seek bar,
volume, settings) keep working. Real fullscreen would take over the whole
screen; YouTube's theater mode still leaves most of its interface around
the picture.

```
fake-fullscreen/
├── manifest.json      # MV3 manifest — loads unpacked in Firefox/Zen AND Chromium
├── popup.html/.js     # toolbar control panel (Dark Reader-style switches)
├── content.js         # detection + theater logic (runs in every frame)
├── content.css        # styles for the button, overlay and theater video
├── injected.js        # MAIN-world patch: requestFullscreen → theater redirect
├── background.js      # shortcut / context-menu routing + cross-frame coordination
├── options.html/.js   # full settings (per-site on/off rules, appearance)
├── icons/             # generated 16/32/48/128 PNGs
└── tools/
    ├── build.py               # per-browser store packages → dist/
    ├── gen_icons.py           # regenerates the icons (pure stdlib Python)
    ├── test_picker.js         # jsdom unit tests (picker, theater)
    ├── test_e2e_chromium.js   # real Brave/Chromium run with the extension loaded
    └── test_e2e_firefox.js    # real Zen/Firefox run via web-ext
```

---

## Install

**From the official store (recommended):** the extension is signed and
published on [Mozilla Add-ons (AMO)](https://addons.mozilla.org/en-US/firefox/addon/fake-fullscreen-theater-mode/)
— works in **Firefox** and **Zen Browser**. Click *Add to Firefox* and
updates arrive automatically.

### Chrome, Brave, Edge (unpacked)

1. Open **`chrome://extensions`** (Brave: `brave://extensions`, Edge:
   `edge://extensions`).
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and pick this folder (or `dist/chromium/` after
   `python3 tools/build.py`).

The extension stays installed across restarts. Chrome shows one harmless
notice about `background.scripts`, which is the Firefox half of the shared
manifest; the `dist/chromium/` build has a Chromium-only manifest without it.

### Firefox / Zen — temporary load for development

1. Open **`about:debugging#/runtime/this-firefox`** in the address bar.
2. Click **“Load Temporary Add-on…”**
3. Select this folder's **`manifest.json`**.
4. Done — open any site with a video (YouTube, Vimeo, direct `.mp4`, …),
   hover the video and hit the **Theater** pill button.

Notes:

- Temporary add-ons are **removed when the browser fully restarts** — reload
  them the same way. This is the standard unsigned-extension workflow; Zen
  behaves exactly like Firefox here. For everyday use, install the signed
  build from [Mozilla Add-ons](https://addons.mozilla.org/en-US/firefox/addon/fake-fullscreen-theater-mode/)
  instead.
- To use it in Private Windows: `about:addons` → *Extensions* → Fake
  Fullscreen → **Run in Private Windows → Allow**.

## Using it

| Action | How |
| --- | --- |
| Control panel | Click the **toolbar icon** — master switch, fullscreen redirect, per-site toggle, **Theater mode for this tab's video** |
| Enter theater | Player’s own fullscreen button / <kbd>F</kbd> (redirected) · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> (<kbd>⌃⇧F</kbd> on macOS) · right-click a video → **Fake fullscreen this video** · hover a video → the small floating button |
| Pick any element | Control panel → **Select element…** → hover the page → click the element (<kbd>Esc</kbd> / right-click cancels) |
| Exit | <kbd>Esc</kbd> · double-click the picture · player’s fullscreen button again · the small exit icon (shows while you move the mouse) |
| Change shortcut | Firefox/Zen: `about:addons` → ⚙ gear → **Manage Extension Shortcuts** · Chromium: `chrome://extensions/shortcuts` |
| Full settings | Control panel → *Settings…* |

**The floating button stays out of your way.** It appears only while the
cursor is actually on a video (something painted over the video — a menu,
a modal — hides it), fades after ~2 s of the mouse resting, and disappears
the moment the cursor leaves the page, window or split-view pane. Muted
looping clips (GIF-style, backgrounds) and small videos never get one. At
rest it is just an icon; the “Theater” label slides out on hover. Don't want
it at all? Switch it off in the panel — the fullscreen redirect, shortcut,
panel button and right-click menu all still work.

**Headline behavior:** with *Redirect fullscreen* on (default), any player
that tries to enter native fullscreen — YouTube’s fullscreen button, the
<kbd>F</kbd> key, custom players calling `requestFullscreen()` — is silently
rerouted into theater mode. No OS fullscreen ever happens, not even for a
frame: sites that fullscreen the whole *document* from their player
(YouTube does) are recognized up front, so the site never flips into its own
fullscreen layout. Turn it off from the control panel when you want the real
thing back.

What you get in theater mode: the video becomes
`position: fixed; inset: 0 0 auto auto; width:100vw; height:100vh;
z-index:2147483647` (letterboxed with `object-fit: contain`, never stretched),
the page behind dims to black, scrolling is locked (with scrollbar-width
compensation so nothing jumps), and your original inline styles are restored
on exit. On enter and exit the extension also pulses a synthetic window
`resize`: sites that cache their player layout in inline pixel styles
(YouTube pins its control-bar width and the video's size/offset that way)
re-measure for the fullscreen view — so the control bar spans the whole
screen and the video sits dead-center — and re-measure again for your page
on exit.

**Player controls stay in your hands.** Theater mode elevates the whole
*player container* — not just the bare `<video>` — so custom player UIs
(YouTube's seek bar, Vimeo's controls, …) stay visible and clickable. For
bare videos, native controls are kept on by default (the *“Hide native
controls”* option can strip them, and a guard keeps them stripped even if
the site re-adds the attribute). The player is focused on entry so keyboard
shortcuts work too — <kbd>Space</kbd> play/pause, <kbd>←</kbd>/<kbd>→</kbd>
seek, <kbd>↑</kbd>/<kbd>↓</kbd> volume. Double-clicking the player's own
controls (scrubbing the seek bar, volume, skip buttons) never exits — only a
double-click on the picture does — and <kbd>Esc</kbd> closes an open player
menu before it closes the theater. The exit control is a small, low-contrast
icon that fades with the mouse, like the player's own controls.

**Player controls not responding? Pick the right layer.** Theater mode
elevates one element. If that is the bare `<video>`, the player's control
layers stay behind and clicks or keys never reach them. On YouTube the right
element is `div#movie_player`, not `video.html5-main-video`, and that rule
ships built in. For any other site, open theater mode, then in the toolbar
panel's **Player layer** card use **▲ Outer / ▼ Inner** to step to the
element that holds the controls, and **Save for site**. The rule is stored
as a CSS selector (e.g. `#movie_player`) when the element has a stable one,
otherwise as a ±N layer offset from the automatic choice. Rules apply per
site (subdomains included) and per content type (*Video* today), beat the
automatic choice on every entry path (button, shortcut, fullscreen redirect,
right-click), and are never downgraded by the rescue ladder.
**Automatic** in the card, or × in Settings → *Player container per site*,
forgets a rule.

**Pick anything, not just detected videos.** The control panel's
*Select element…* button arms an element picker: hover the page and
whatever is under the cursor gets outlined (with a `tag#id.class` label) —
click it and it goes to theater mode. Your click target is authoritative:
a container with a video inside theaters as a container (its player UI
stays), a bare video theaters itself, a transparent overlay over a video
falls through to that video's usual player container, and an element with
no reachable video (a cross-origin `<iframe>` embed, a closed-shadow-root
player) is elevated as-is. While an iframe embed is theatered that way,
the embed's own fullscreen button toggles the theater too.

## Options

- Master on/off switch
- **Redirect native fullscreen to theater mode** (on by default)
- **Per-site on/off rules** — a default (run everywhere vs opt-in) plus an
  explicit domain list, each rule toggled On or Off (subdomains included)
- **Per-site player container** — domain + type (*Video*) + CSS selector or
  ±N layers; YouTube / youtube-nocookie → `#movie_player` preset
- Show/hide the floating buttons; hover-only visibility
- Hide native controls while in theater
- Click-outside-to-exit toggle
- Backdrop darkness slider

Settings sync with your browser account when available (`storage.sync` —
Firefox Sync / Chrome sync — falling back to `storage.local`). Changes apply
to open tabs immediately.

## How it works

1. **Fullscreen interception** — `injected.js` is declared as a
   `"world": "MAIN"` content script (Chrome 111+, Firefox 128+), so it
   patches `Element.prototype.requestFullscreen` *in the page's own JS
   world* at `document_start`, before page scripts run, and page CSP
   (YouTube, …) can't block it. One code path for every browser. When
   `data-ffs-prevent="1"` is set and the request is a video fullscreen, the
   call is swallowed and a bubbling `ffs:request-theater` event is
   dispatched instead; `content.js` toggles theater mode. A request is a
   video fullscreen when the target is a video or a container that is
   *mostly* video (≥45% area) — theatered as-is, controls included — or
   when the target is the whole page (`<html>`, `<body>`, an app shell)
   **and** the user's click/key landed in a player or the main video is
   playing / has been played (then the best video's player container is
   theatered). Full-page fullscreen of a slideshow with a stray unplayed
   video is left alone. While a theater is live (`data-ffs-theater="1"`),
   the next fullscreen press exits. A `fullscreenchange` listener catches
   anything the patch misses and reroutes it.
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
4. **Self-healing rescue ladder** — after activation, the script samples the
   theater host with `elementFromPoint()` every frame and escalates if it's
   buried (ancestor stacking contexts / fixed-containing-block traps):
   ① popover **top layer** (`showPopover()`, escapes all stacking contexts
   *without* moving the element — site CSS/JS keep working), ② re-parent to
   `<html>`, ③ downgrade to bare-`<video>` theater, ④ clean abort. It also
   verifies the video itself isn't collapsed (black-host check).
5. **Context menu** — right-click → *Fake fullscreen this video* is routed
   by `background.js` to the exact frame the menu opened in, which resolves
   the video under the cursor (custom players' overlay layers included).
6. **Cross-frame Escape** — if the focused frame has no local theater,
   `Esc` is forwarded through the background page so a theater inside another
   frame still closes.
7. **Element picker** — *Select element…* in the popup asks the top frame to
   arm a crosshair picker (hover outline + click to confirm; the site never
   sees the picker's clicks). The picked element is authoritative: video
   inside → container theater; same-origin `<iframe>` → its video inside the
   elevated frame; cross-origin iframe or closed shadow root → the element is
   elevated *without* a video ("videoless" mode — <kbd>Esc</kbd>,
   double-click or overlay click still exit, and the rescue ladder only
   verifies painting, never downgrades). While a frame's `<iframe>` is
   theatered from the parent, `background.js` fans a suppression flag out to
   every frame so embeds stand down instead of opening a competing theater,
   and their Esc / fullscreen presses are forwarded as exit requests.

### Known limitations

- **Closed** shadow roots are invisible to any content script — videos there
  can't be found (rare; most players use open roots).
- Players that render into `<canvas>`/WebGL instead of `<video>` aren't
  covered by design.
- In cross-origin iframes the video fills the **iframe's** viewport, not the
  whole tab (frames can't escape their own document).
- A site that keeps its own reference to the original `requestFullscreen`
  bypasses the redirect; the `fullscreenchange` safety net still catches it,
  but then real fullscreen flashes briefly before the theater opens.
- Right-click on YouTube opens YouTube's own menu; right-click a second time
  (or <kbd>Shift</kbd>+right-click in Firefox) for the browser menu with
  *Fake fullscreen this video*.
- <kbd>F11</kbd> (browser window fullscreen) is browser UI, not the
  Fullscreen API — intentionally untouched.
- DRM videos (Netflix etc.) work visually like any other `<video>`, but those
  sites' UI layers may fight back; the reparenting rescue handles most cases.

## Customization cheat-sheet

| Want to change… | Look at |
| --- | --- |
| Control panel layout / switches | `popup.html` (styles inline), `popup.js` |
| Element-picker behavior / look | `startPicker()` / `resolvePick()` in `content.js`, `.ffs-pick-*` in `content.css` |
| Fullscreen-intercept heuristic | `isVideoFullscreen()` in `injected.js` (45% area rule + page-level rule) |
| Button style / position offsets | `.ffs-btn` in `content.css`, `BTN_MARGIN_PX` in `content.js` |
| Button idle fade / minimum video size | `IDLE_HIDE_MS`, `MIN_W` / `MIN_H`, `isDecorative()` in `content.js` |
| Theater geometry (e.g. fill vs letterbox) | `video.ffs-video--theater` in `content.css` |
| Default settings (incl. built-in container rules) | `DEFAULTS` in `content.js` **and** `options.js` (keep in sync) |
| Container rules / layer stepping | `hostRuleFor()` / `hostFromRule()` / `stepLayer()` / `selectorFor()` in `content.js` |
| Keyboard shortcut | `commands` in `manifest.json`, or browser settings UI |
| Shortcut / context-menu routing, badge | `background.js` |
| Icons | edit shapes in `tools/gen_icons.py`, then `python3 tools/gen_icons.py` |

## Packaging

```sh
python3 tools/build.py
```

writes `dist/firefox/` + `dist/fake-fullscreen-<ver>-firefox.zip` (for AMO)
and `dist/chromium/` + `dist/fake-fullscreen-<ver>-chromium.zip` (for the
Chrome Web Store / Edge Add-ons), each with a manifest tailored to that
store. The repo root itself stays loadable unpacked in both families.

## Releases

Downloads for both browser families live on
[GitHub Releases](https://github.com/Amoralchik/fake-fullscreen/releases).
To cut a new one:

1. Bump `"version"` in `manifest.json` (e.g. `1.6.0`) and merge to `main`.
2. Tag and push:

   ```sh
   git tag v1.6.0 && git push origin v1.6.0
   ```

[`.github/workflows/release.yml`](.github/workflows/release.yml) checks that
the tag matches the manifest version, runs the unit tests, builds both
packages, lints the Firefox one with AMO's rules, and attaches
`fake-fullscreen-<ver>-firefox.zip`, `…-chromium.zip` and `SHA256SUMS.txt`
to the release. If you create the release (with hand-written notes) before
pushing the tag, the files are added to it; otherwise GitHub generates the
notes.

Store listings are separate uploads: the Firefox zip goes to the
[AMO Developer Hub](https://addons.mozilla.org/developers/) (*Upload New
Version*), and the Chromium zip to the Chrome Web Store / Edge Add-ons
dashboards.

## Tests

```sh
npm i jsdom playwright-core web-ext --no-save
node tools/test_picker.js          # jsdom unit tests
node tools/test_e2e_chromium.js    # real Brave/Edge/Chromium (headless) with the extension
node tools/test_e2e_firefox.js     # real Zen/Firefox via web-ext run
```

Google Chrome stable ignores `--load-extension`, so the Chromium test uses
Brave or Edge (or any path you pass). `FFS_EXT_DIR=dist/chromium` (or
`dist/firefox`) tests a built package instead of the repo root.

## Quick test checklist

- [ ] Control panel: toolbar icon → master switch pauses/resumes everywhere;
      site chip shows the current host and its effective On/Off.
- [ ] YouTube: press <kbd>F</kbd> / click fullscreen → theater opens with the
      seek bar & controls still usable; press <kbd>F</kbd> again → exits
      (never real OS fullscreen).
- [ ] Redirect off in panel → native fullscreen works normally again.
- [ ] Full-page fullscreen (e.g. a presentation site) is NOT hijacked even
      with a stray video on the page.
- [ ] Page with header/nav overlapping: video still covers everything
      (auto-reparent rescue).
- [ ] Site with several videos: shortcut toggles the biggest/playing one.
- [ ] Embedded iframe player: toggles from within the frame; Esc works.
- [ ] Picker: *Select element…* → hover outlines elements, click theaters
      the picked container with its controls; Esc cancels the picker.
- [ ] Picker on a cross-origin embed (iframe): the whole frame goes
      theater; Esc inside and outside both exit; the embed's own
      fullscreen button toggles the theater; no double-dimming.
- [ ] Picker on an element without video: element is elevated as-is,
      with a notice; Esc exits.
- [ ] Controls: in theater, <kbd>Space</kbd>/arrows drive the player; the
      exit control is just a subtle icon.
- [ ] Floating button OFF in the panel → no buttons at all (exit via
      <kbd>Esc</kbd> / double-click / fullscreen key).
- [ ] Floating button ON: appears only with the cursor on a video, fades
      after ~2 s at rest, and is gone when the cursor leaves the pane /
      window (split view!); no button on GIF-style looping clips.
- [ ] YouTube in theater: drag the seek bar / double-click it, change volume,
      open ⚙ settings and press <kbd>Esc</kbd> (closes the menu, not the
      theater) — the theater stays open throughout.
- [ ] YouTube theater uses `#movie_player` (panel's Player layer card says
      so); ▼ Inner to the bare video breaks the controls, ▲ Outer fixes it.
- [ ] Player layer → *Save for site* on another site; reload → theater
      opens on the saved layer; *Automatic* forgets it.
- [ ] Right-click a video → *Fake fullscreen this video* toggles it.
- [ ] Control panel → *Theater mode for this tab's video* toggles.
- [ ] Same checks in Chrome/Brave (unpacked) and Firefox/Zen.
- [ ] Options: add a per-site rule (On/Off) → state updates live on that
      site; darkness slider updates live.
