# Contributing to Fake Fullscreen

Thanks for helping out! Bug reports, site-compatibility reports and pull
requests are all welcome. The extension is plain JavaScript with no
frameworks and no build step, so you can load the repo folder straight into
a browser.

- **Bugs and site issues:** [open an issue](https://github.com/Amoralchik/fake-fullscreen/issues)
  with the site URL, your browser and version, and what you expected.
- **How it works:** [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md).

## Project layout

```
fake-fullscreen/
├── manifest.json      # MV3 manifest; loads unpacked in Firefox/Zen AND Chromium
├── popup.html/.js     # toolbar control panel
├── content.js         # detection + theater logic (runs in every frame)
├── content.css        # styles for the button, overlay and theater video
├── injected.js        # MAIN-world patch: requestFullscreen → theater redirect
├── background.js      # shortcut / context-menu routing + cross-frame coordination
├── options.html/.js   # full settings (per-site rules, appearance)
├── icons/             # generated 16/32/48/128 PNGs
├── store/             # store listing copy and screenshots
└── tools/
    ├── build.py               # per-browser store packages → dist/
    ├── gen_icons.py           # regenerates the icons (pure stdlib Python)
    ├── test_picker.js         # jsdom unit tests (picker, theater)
    ├── test_e2e_chromium.js   # real Brave/Chromium run with the extension loaded
    └── test_e2e_firefox.js    # real Zen/Firefox run via web-ext
```

## Loading a development copy

### Chrome, Brave, Edge

1. Open `chrome://extensions` (Brave: `brave://extensions`, Edge:
   `edge://extensions`).
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and pick the repo folder (or `dist/chromium/`
   after `python3 tools/build.py`).

Chrome shows one harmless notice about `background.scripts`, which is the
Firefox half of the shared manifest. The `dist/chromium/` build has a
Chromium-only manifest without it.

### Firefox, Zen

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and select the repo's `manifest.json`.

Temporary add-ons are removed when the browser fully restarts. To test in
Private Windows: `about:addons` → *Extensions* → Fake Fullscreen →
**Run in Private Windows → Allow**.

## Where to change things

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

### Manual checklist

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
      theater); the theater stays open throughout.
- [ ] YouTube theater uses `#movie_player` (panel's Player layer card says
      so); ▼ Inner to the bare video breaks the controls, ▲ Outer fixes it.
- [ ] Player layer → *Save for site* on another site; reload → theater
      opens on the saved layer; *Automatic* forgets it.
- [ ] Right-click a video → *Fake fullscreen this video* toggles it.
- [ ] Control panel → *Theater mode for this tab's video* toggles.
- [ ] Same checks in Chrome/Brave and Firefox/Zen.
- [ ] Options: add a per-site rule (On/Off) → state updates live on that
      site; darkness slider updates live.

## Packaging

```sh
python3 tools/build.py
```

This writes `dist/firefox/` + `dist/fake-fullscreen-<ver>-firefox.zip` (for
AMO) and `dist/chromium/` + `dist/fake-fullscreen-<ver>-chromium.zip` (for
the Chrome Web Store / Edge Add-ons), each with a manifest tailored to that
store. The repo root itself stays loadable unpacked in both families.

## Releasing

1. Bump `"version"` in `manifest.json` (e.g. `1.6.0`) and merge to `main`.
2. Tag and push:

   ```sh
   git tag v1.6.0 && git push origin v1.6.0
   ```

[`.github/workflows/release.yml`](.github/workflows/release.yml) checks that
the tag matches the manifest version, runs the unit tests, builds both
packages, lints the Firefox one with AMO's rules, and attaches
`fake-fullscreen-<ver>-firefox.zip`, `…-chromium.zip` and `SHA256SUMS.txt`
to the [GitHub release](https://github.com/Amoralchik/fake-fullscreen/releases).
If you create the release (with hand-written notes) before pushing the tag,
the files are added to it; otherwise GitHub generates the notes.

Store listings are separate uploads: the Firefox zip goes to the
[AMO Developer Hub](https://addons.mozilla.org/developers/) (*Upload New
Version*), and the Chromium zip to the
[Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
Listing copy lives in [`store/`](store/).
