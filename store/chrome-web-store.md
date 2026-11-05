# Chrome Web Store listing — copy & answers

Paste-ready text for the Chrome Web Store Developer Dashboard (also works
for Edge Add-ons). Package to upload: `fake-fullscreen-<ver>-chromium.zip`
from the GitHub release, or `python3 tools/build.py`.

---

## Store listing tab

**Name** (from the manifest): Fake Fullscreen – Theater Mode

**Summary** (from the manifest, ≤132 chars):
> Any video in a borderless theater view filling the whole tab, ideal for split view. Fullscreen buttons open it, not OS fullscreen.

**Category:** Tools

**Language:** English

**Description:**

```
Watch any web video in a clean, borderless view that fills the whole browser tab — without going OS fullscreen.

Made for split view: keep two or three pages side by side and let one of them be just the video. No masthead, comments, sidebar or "theater mode" chrome around it — while the player's own controls (seek bar, volume, settings) keep working.

HOW IT WORKS
• Press the player's own fullscreen button or F — the video fills the tab instead of the screen. Press it again to go back.
• Or: Ctrl+Shift+F, the toolbar panel's "Theater mode" button, or right-click a video → "Fake fullscreen this video".
• Esc, double-clicking the picture, or the small exit icon closes it.

FEATURES
• Works with YouTube and most HTML5 video players, including embedded ones.
• Player controls stay usable. If a site's controls don't respond, the toolbar panel's "Player layer" card lets you step to the right element and save it for that site.
• A quiet floating button: appears only while your cursor is on a video and fades when the mouse rests. Or switch it off completely.
• "Select element…" — pick anything on a page and give it the whole tab.
• Per-site on/off rules, backdrop darkness, optional hiding of native controls.
• No OS fullscreen, no page reload, nothing leaves your browser.

PRIVACY
No data collection, no analytics, no network requests. Settings are stored with your browser's own sync storage.

Open source: https://github.com/Amoralchik/fake-fullscreen
```

**Screenshots** (1280×800, in `store/screenshots/`, upload in this order):

1. `1-split-view.png`: three pages side by side, and the right one is just the video.
2. `2-theater.png`: the video fills the tab and the player controls stay usable.
3. `3-panel.png`: toolbar panel with the Player layer card.
4. `4-hover-button.png`: the floating button, only while hovering a video.
5. `5-settings.png`: per-site rules and player containers.

**Small promo tile** (440×280, optional): `store/screenshots/promo-440x280.png`

---

## Privacy practices tab

**Single purpose description:**
```
Shows a web page's video in a borderless view that fills the browser tab ("fake fullscreen" / theater mode), so it can be watched on its own — for example in one pane of a split-screen layout — without the browser entering OS-level fullscreen.
```

**Permission justification — storage:**
```
Saves the user's own settings: the on/off switches, per-site on/off rules, per-site player-container rules, and appearance options (backdrop darkness, floating button). Stored with chrome.storage.sync (falling back to chrome.storage.local). No browsing data, history or personal information is stored.
```

**Permission justification — contextMenus:**
```
Adds a single "Fake fullscreen this video" item to the right-click menu on <video> elements, so the user can open theater mode for that exact video. The item appears only on videos and only triggers the extension's local theater view.
```

**Host permission justification** (content scripts on `<all_urls>`):
```
The user can watch video on any website, so the extension's content scripts must run on the page where the video is in order to (1) find <video> elements and their player container, (2) redirect the player's own fullscreen request into the in-tab theater view instead of OS fullscreen, and (3) restyle that element to fill the tab. The scripts only inspect video/player elements and the page layout around them; they read no page text, form data or cookies, make no network requests, and send nothing off the device. The extension can be switched off globally or per site.
```

**Are you using remote code?** → **No, I am not using remote code.**

If a justification box still shows:
```
All JavaScript is included in the extension package. injected.js is a bundled file declared in manifest.json as a MAIN-world content script; nothing is downloaded or evaluated at runtime (no eval, no remote <script>, no WebAssembly).
```

**Data usage:** tick **none** of the data types (the extension collects no
personally identifiable info, health, financial, authentication, personal
communications, location, web history, user activity or website content).
Then check all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL** (optional when nothing is collected; adding one avoids review questions):
`https://github.com/Amoralchik/fake-fullscreen/blob/main/PRIVACY.md`

---

## Account settings (only you can do these)

- **Settings → Contact email**: enter it, then click the verification link
  Google emails you. Both are required before publishing.
