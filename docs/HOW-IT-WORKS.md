# How Fake Fullscreen works

A tour of the internals for contributors and the curious. For everyday use,
see the [README](../README.md).

## What theater mode does to the page

The theatered element becomes
`position: fixed; inset: 0 0 auto auto; width:100vw; height:100vh;
z-index:2147483647` (a bare video is letterboxed with `object-fit: contain`,
never stretched). The page behind dims to black, scrolling is locked (with
scrollbar-width compensation so nothing jumps), and your original inline
styles are restored on exit.

On enter and exit the extension also pulses a synthetic window `resize`.
Sites that cache their player layout in inline pixel styles (YouTube pins
its control-bar width and the video's size and offset that way) re-measure
for the fullscreen view, so the control bar spans the whole screen and the
video sits dead-center. They re-measure again for your page on exit.

Theater mode elevates the whole *player container*, not just the bare
`<video>`, so custom player UIs (YouTube's seek bar, Vimeo's controls, …)
stay visible and clickable. For bare videos, native controls are kept on by
default. The *Hide native controls* option can strip them, and a guard keeps
them stripped even if the site re-adds the attribute. The player is focused
on entry so its keyboard shortcuts work. Double-clicking the player's own
controls never exits; only a double-click on the picture does. <kbd>Esc</kbd>
closes an open player menu before it closes the theater.

## The moving parts

1. **Fullscreen interception.** `injected.js` is declared as a
   `"world": "MAIN"` content script (Chrome 111+, Firefox 128+), so it
   patches `Element.prototype.requestFullscreen` *in the page's own JS
   world* at `document_start`, before page scripts run, and page CSP
   (YouTube, …) can't block it. One code path covers every browser. When
   `data-ffs-prevent="1"` is set and the request is a video fullscreen, the
   call is swallowed and a bubbling `ffs:request-theater` event is
   dispatched instead; `content.js` toggles theater mode.

   A request counts as a video fullscreen when the target is a video or a
   container that is *mostly* video (≥45% of its area); that target is
   theatered as-is, controls included. It also counts when the target is
   the whole page (`<html>`, `<body>`, an app shell) **and** the user's
   click or key landed in a player, or the main video is playing or has
   been played. Then the best video's player container is theatered.
   Full-page fullscreen of a slideshow with a stray unplayed video is left
   alone. While a theater is live (`data-ffs-theater="1"`), the next
   fullscreen press exits. A `fullscreenchange` listener catches anything
   the patch misses and reroutes it.

2. **Detection.** Each frame scans for `<video>` elements *recursively
   through open Shadow DOM roots*, then keeps watching with a
   `MutationObserver` (SPA navigations, lazy-loaded players) plus a cheap
   periodic sweep. Videos inside iframes get their own content-script
   instance (`all_frames: true`).

3. **One toggle per tab.** Pressing the shortcut makes `background.js` run a
   tiny probe round-trip: every frame privately reports its best candidate
   (visible area × playing/hover bonuses). The background page then sends a
   *targeted* `{frameId}` toggle, so exactly one video flips even when a
   page and an embed both contain players. A frame whose theater is already
   active always wins, which guarantees clean off-toggles.

4. **Self-healing rescue ladder.** After activation, the script samples the
   theater host with `elementFromPoint()` every frame and escalates if it is
   buried (ancestor stacking contexts, fixed-containing-block traps):
   ① popover **top layer** (`showPopover()` escapes all stacking contexts
   *without* moving the element, so site CSS and JS keep working),
   ② re-parent to `<html>`, ③ downgrade to a bare-`<video>` theater,
   ④ clean abort. It also verifies the video itself isn't collapsed
   (black-host check).

5. **Player layer rules.** Per-site rules choose which element is elevated.
   A rule is stored as a CSS selector (e.g. `#movie_player`) when the
   element has a stable one, otherwise as a ±N layer offset from the
   automatic choice. Rules apply per site (subdomains included) and per
   content type (*Video* today). They beat the automatic choice on every
   entry path (button, shortcut, fullscreen redirect, right-click) and are
   never downgraded by the rescue ladder. YouTube and youtube-nocookie ship
   with a built-in `#movie_player` rule.

6. **Context menu.** Right-click → *Fake fullscreen this video* is routed by
   `background.js` to the exact frame the menu opened in, which resolves the
   video under the cursor (custom players' overlay layers included).

7. **Cross-frame Escape.** If the focused frame has no local theater,
   <kbd>Esc</kbd> is forwarded through the background page so a theater
   inside another frame still closes.

8. **Element picker.** *Select element…* in the popup asks the top frame to
   arm a crosshair picker (hover outline, click to confirm; the site never
   sees the picker's clicks). The picked element is authoritative:

   - video inside → container theater;
   - same-origin `<iframe>` → its video, inside the elevated frame;
   - a transparent overlay over a video → that video's usual container;
   - cross-origin iframe or closed shadow root → the element is elevated
     *without* a video ("videoless" mode). <kbd>Esc</kbd>, double-click or
     an overlay click still exit, and the rescue ladder only verifies
     painting, never downgrades.

   While a frame's `<iframe>` is theatered from the parent, `background.js`
   fans a suppression flag out to every frame so embeds stand down instead
   of opening a competing theater, and their <kbd>Esc</kbd> and fullscreen
   presses are forwarded as exit requests.

9. **Floating button.** It appears only while the cursor is actually on a
   video (something painted over the video, such as a menu or modal, hides
   it), fades after about 2 s of the mouse resting, and disappears the
   moment the cursor leaves the page, window or split-view pane. Muted
   looping clips (GIF-style backgrounds) and small videos never get one.

## Settings storage

Settings live in `storage.sync` (Firefox Sync / Chrome sync) and fall back to
`storage.local`. Changes apply to open tabs immediately.
