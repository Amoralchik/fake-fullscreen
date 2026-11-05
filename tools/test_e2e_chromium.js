/**
 * End-to-end test in a REAL Chromium browser (Brave / Edge / Chromium)
 * with the unpacked extension loaded. Serves a local page with a
 * YouTube-like custom player (container + <video> + its own control
 * bar, and a fullscreen button that calls
 * document.documentElement.requestFullscreen() — like YouTube does).
 *
 * Run:
 *   npm i playwright-core --no-save
 *   node tools/test_e2e_chromium.js [path-to-browser.exe]
 *   (FFS_HEADED=1 shows the window — keep your mouse off it)
 *
 * Default browser: Brave, then Edge (Google Chrome stable no longer
 * honours --load-extension, so it can't be used here).
 */
const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXT = process.env.FFS_EXT_DIR ? path.resolve(process.env.FFS_EXT_DIR) : path.resolve(__dirname, '..');
const CANDIDATES = [
  process.argv[2],
  'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
].filter(Boolean);
const exe = CANDIDATES.find((p) => fs.existsSync(p));

const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>player</title>
<style>
  body { margin: 0; font: 14px sans-serif; background: #f4f4f4; }
  header { position: sticky; top: 0; height: 56px; background: #fff; z-index: 10; }
  #player { position: relative; width: 640px; height: 360px; margin: 20px; background: #000; }
  #player video { position: absolute; left: 0; top: 0; width: 640px; height: 360px; background: #123; }
  #bar { position: absolute; left: 0; right: 0; bottom: 0; height: 44px; display: flex; gap: 6px;
         align-items: center; background: rgb(0 0 0 / .5); }
  #seek { flex: 1; height: 8px; background: #c00; }
  #cover { position: absolute; left: 20px; top: 500px; width: 300px; height: 100px; }
  #gif { width: 320px; height: 180px; display: block; margin: 20px; }
</style></head><body>
<header>masthead</header>
<div id="player">
  <video id="vid"></video>
  <div id="bar">
    <button id="play">play</button>
    <div id="seek" role="slider" aria-label="Seek"></div>
    <button id="fs">fullscreen</button>
  </div>
</div>
<video id="gif" muted loop></video>
<p style="height:1500px">filler</p>
<script>
  window.clicks = 0; window.seeks = 0;
  document.getElementById('play').onclick = () => { window.clicks++; };
  document.getElementById('seek').onclick = () => { window.seeks++; };
  // YouTube-style: fullscreen the WHOLE DOCUMENT from the player button.
  document.getElementById('fs').onclick = () => {
    document.documentElement.requestFullscreen().then(() => { window.fsResolved = true; })
      .catch((e) => { window.fsError = String(e); });
  };
</script></body></html>`;

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.log(`FAIL  ${name}${extra !== undefined ? ' — ' + JSON.stringify(extra) : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!exe) { console.error('No Chromium-based browser found; pass its path.'); process.exit(2); }
  console.log('Browser:', exe);

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE);
  }).listen(0);
  const url = `http://127.0.0.1:${server.address().port}/`;

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ffs-e2e-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath: exe,
    // Headless (new mode supports extensions): a headed window would sit
    // under the real OS cursor, whose mouse events race the scripted ones.
    headless: process.env.FFS_HEADED !== '1',
    viewport: { width: 1200, height: 800 },
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--no-first-run',
      ...(process.env.FFS_HEADED === '1' ? [] : ['--headless=new']),
    ],
  });

  try {
    console.log('1. Extension loads in Chromium (MV3 service worker)');
    let sw = ctx.serviceWorkers()[0];
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10000 });
    check('service worker running', !!sw && /background\.js$/.test(sw.url()), sw && sw.url());

    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(url);
    await sleep(600);

    const patched = await page.evaluate(() => !!Element.prototype.__ffsPatched);
    check('MAIN-world patch installed despite no Xray (injected.js)', patched);
    const prevent = await page.evaluate(() => document.documentElement.dataset.ffsPrevent);
    check('content script set data-ffs-prevent="1"', prevent === '1', prevent);

    console.log('2. Floating button: hover-only, hit-tested, idle-hide');
    const btnVisible = () => page.evaluate(() =>
      [...document.querySelectorAll('.ffs-btn')].filter((b) => b.classList.contains('ffs-btn--visible')).length);
    check('no button before hovering', (await btnVisible()) === 0);
    await page.mouse.move(300, 200);
    await sleep(150);
    check('button shows while the cursor is on the video', (await btnVisible()) === 1);
    await page.mouse.move(1100, 700);
    await sleep(150);
    check('button hides when the cursor moves off the video', (await btnVisible()) === 0);
    await page.mouse.move(300, 210);
    await sleep(150);
    check('button back on hover', (await btnVisible()) === 1);
    await sleep(2600);
    check('button fades after the cursor rests', (await btnVisible()) === 0);
    // cursor leaves the document (to browser UI / another split pane)
    await page.mouse.move(310, 220);
    await sleep(120);
    await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: null })));
    await sleep(120);
    check('button hides when the cursor leaves the page', (await btnVisible()) === 0);
    // occlusion: something painted over the video
    await page.evaluate(() => {
      const d = document.createElement('div');
      d.id = 'modal';
      d.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:600px;background:rgb(255 255 255/.9);z-index:50';
      document.body.appendChild(d);
    });
    await page.mouse.move(320, 230);
    await sleep(150);
    check('no button when a modal covers the video', (await btnVisible()) === 0);
    await page.evaluate(() => document.getElementById('modal').remove());
    // decorative muted+loop clip never gets a button
    await page.evaluate(() => document.getElementById('gif').scrollIntoView({ block: 'center' }));
    const gifBox = await page.locator('#gif').boundingBox();
    await page.mouse.move(gifBox.x + 100, gifBox.y + 80);
    await sleep(150);
    check('no button on a muted looping clip', (await btnVisible()) === 0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(100);

    console.log('3. YouTube-style document fullscreen → theater (no real fullscreen)');
    await page.click('#fs');
    await sleep(400);
    const st = await page.evaluate(() => ({
      host: document.querySelector('.ffs-theater-host')?.id,
      fs: !!document.fullscreenElement,
      resolved: !!window.fsResolved,
      err: window.fsError || null,
      flag: document.documentElement.dataset.ffsTheater,
    }));
    check('player container is the theater host', st.host === 'player', st);
    check('no real fullscreen happened', !st.fs, st);
    check('site saw requestFullscreen() succeed', st.resolved && !st.err, st);

    const box = await page.locator('#player').boundingBox();
    check('player fills the viewport', box && box.width >= 1180 && box.height >= 780, box);

    console.log('4. Player input inside theater');
    await page.click('#play');
    check('control-bar button receives clicks', (await page.evaluate(() => window.clicks)) === 1);
    const seek = await page.locator('#seek').boundingBox();
    await page.mouse.dblclick(seek.x + seek.width / 2, seek.y + seek.height / 2);
    await sleep(150);
    check('double-click on the seek bar does NOT exit theater',
      await page.evaluate(() => !!document.querySelector('.ffs-theater-host')));
    check('seek bar got both clicks', (await page.evaluate(() => window.seeks)) === 2);
    await page.mouse.move(600, 300);
    await sleep(120);
    check('exit icon shows on mouse movement', (await btnVisible()) === 1);
    await sleep(2600);
    check('exit icon fades when the mouse rests', (await btnVisible()) === 0);
    await page.mouse.dblclick(600, 300);
    await sleep(200);
    check('double-click on the picture exits',
      await page.evaluate(() => !document.querySelector('.ffs-theater-host')));

    console.log('5. Fullscreen button toggles; shortcut path via background probe');
    await page.click('#fs');
    await sleep(300);
    await page.click('#fs');
    await sleep(300);
    check('second fullscreen press exits', await page.evaluate(() => !document.querySelector('.ffs-theater-host')));
    await sw.evaluate(() => getActiveTabId().then(beginProbe));
    await sleep(600);
    check('shortcut/popup probe opens the theater',
      await page.evaluate(() => document.querySelector('.ffs-theater-host')?.id === 'player'));
    await page.keyboard.press('Escape');
    await sleep(200);
    check('Esc exits', await page.evaluate(() => !document.querySelector('.ffs-theater-host')));

    console.log('6. Control panel loads in Chromium');
    const extId = new URL(sw.url()).host;
    const popup = await ctx.newPage();
    const popupErrors = [];
    popup.on('pageerror', (e) => popupErrors.push(String(e)));
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    await sleep(400);
    check('popup renders its switches', await popup.locator('#masterEnabled').count() === 1);
    check('popup has no script errors', popupErrors.length === 0, popupErrors);
    await popup.goto(`chrome-extension://${extId}/options.html`);
    await sleep(400);
    check('options page has no script errors', popupErrors.length === 0, popupErrors);
    await popup.close();

    check('test page had no script errors', errors.length === 0, errors);
  } finally {
    await ctx.close();
    server.close();
  }
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
