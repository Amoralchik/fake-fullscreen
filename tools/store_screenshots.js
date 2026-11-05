/**
 * Generates the store screenshots (1280×800) and the small promo tile
 * (440×280) into store/screenshots/, using the REAL extension loaded in a
 * headless Chromium browser (Brave / Edge) and a fictional demo video site
 * served locally. No real site or brand appears in the images.
 *
 * Run:
 *   npm i playwright-core --no-save
 *   node tools/store_screenshots.js [path-to-browser.exe]
 */
const { chromium } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'store', 'screenshots');
const exe = [
  process.argv[2],
  'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium',
].filter(Boolean).find((p) => fs.existsSync(p));
const W = 1280;
const H = 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iconData = `data:image/png;base64,${fs.readFileSync(path.join(ROOT, 'icons', 'icon-128.png')).toString('base64')}`;

/* ------------------------------------------------------------------
 * Fixture pages
 * ---------------------------------------------------------------- */

// Poster frame drawn on a canvas: a calm mountain landscape at dusk.
const POSTER_JS = `
function drawPoster(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#1d2b64'); sky.addColorStop(0.55, '#f8a978'); sky.addColorStop(1, '#f6d6a8');
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,236,200,.95)'; g.beginPath(); g.arc(w * .68, h * .52, h * .09, 0, 7); g.fill();
  const ridge = (base, amp, seed, color) => {
    g.fillStyle = color; g.beginPath(); g.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) {
      const y = base - amp * (Math.sin(x / (w * .11) + seed) * .5 + Math.sin(x / (w * .043) + seed * 2) * .25 + .6);
      g.lineTo(x, y);
    }
    g.lineTo(w, h); g.closePath(); g.fill();
  };
  ridge(h * .78, h * .22, 1, '#7b4f7a'); ridge(h * .86, h * .2, 4, '#4d3462'); ridge(h * .97, h * .16, 7, '#231a3a');
  return c.toDataURL('image/png');
}`;

const SITE = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Lumen — Dusk over the ridge</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.45 system-ui, "Segoe UI", sans-serif; background: #0f0f13; color: #e9e9ef; }
  header { position: sticky; top: 0; z-index: 5; height: 56px; display: flex; align-items: center; gap: 18px;
           padding: 0 24px; background: #15151c; border-bottom: 1px solid #23232d; }
  .logo { font-weight: 750; font-size: 19px; letter-spacing: -.02em; color: #ffb37a; }
  .search { flex: 1; max-width: 520px; height: 36px; border-radius: 18px; background: #1e1e27; border: 1px solid #2c2c38;
            color: #8a8a99; display: flex; align-items: center; padding: 0 16px; }
  .avatar { margin-left: auto; width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg,#7b4f7a,#f8a978); }
  main { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 24px; padding: 20px 24px; max-width: 1280px; }
  #player { position: relative; width: 100%; aspect-ratio: 16 / 9; background: #000; border-radius: 12px; overflow: hidden; }
  #player video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .ctl { position: absolute; left: 0; right: 0; bottom: 0; padding: 26px 16px 10px;
         background: linear-gradient(transparent, rgb(0 0 0 / .72)); }
  .seek { height: 4px; border-radius: 2px; background: rgb(255 255 255 / .3); position: relative; }
  .seek i { position: absolute; left: 0; top: 0; bottom: 0; width: 38%; background: #ff8a5c; border-radius: 2px; }
  .seek b { position: absolute; left: 38%; top: 50%; width: 12px; height: 12px; margin: -6px; border-radius: 50%; background: #ff8a5c; }
  .row { display: flex; align-items: center; gap: 16px; margin-top: 10px; font-size: 13px; color: #fff; }
  .row svg { width: 22px; height: 22px; fill: #fff; display: block; }
  .row .sp { flex: 1; }
  .row button { all: unset; cursor: pointer; display: flex; }
  h1 { font-size: 20px; margin: 14px 0 6px; }
  .meta { color: #9a9aac; font-size: 13px; }
  .desc { margin-top: 14px; padding: 12px 14px; background: #1a1a22; border-radius: 10px; color: #c4c4d2; }
  aside .card { display: flex; gap: 10px; margin-bottom: 12px; }
  aside .th { flex: none; width: 150px; aspect-ratio: 16/9; border-radius: 8px; }
  aside .t { font-weight: 600; font-size: 13.5px; }
  aside .s { color: #8a8a99; font-size: 12px; }
  .comments { margin-top: 22px; color: #c4c4d2; }
  .comments p { margin: 0 0 14px; }
  /* Narrow pane (split view): one column, like real video sites. */
  @media (max-width: 760px) { main { grid-template-columns: minmax(0, 1fr); padding: 14px; } }
</style></head><body>
<header><span class="logo">Lumen</span><div class="search">Search</div><div class="avatar"></div></header>
<main>
  <section>
    <div id="player">
      <video id="vid" preload="none"></video>
      <div class="ctl">
        <div class="seek" role="slider" aria-label="Seek"><i></i><b></b></div>
        <div class="row">
          <button aria-label="Pause"><svg viewBox="0 0 24 24"><path d="M7 5h3v14H7zM14 5h3v14h-3z"/></svg></button>
          <button aria-label="Volume"><svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4zM16 8.5a5 5 0 0 1 0 7l-1.2-1.2a3.4 3.4 0 0 0 0-4.6z"/></svg></button>
          <span>4:12 / 11:03</span><span class="sp"></span>
          <button aria-label="Settings"><svg viewBox="0 0 24 24"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm8.6 4.6-.1-2.2 2-1.6-2-3.4-2.4.9a8 8 0 0 0-1.9-1.1L15.8 3h-3.9l-.4 2.6a8 8 0 0 0-1.9 1.1l-2.4-.9-2 3.4 2 1.6a8 8 0 0 0 0 2.2l-2 1.6 2 3.4 2.4-.9a8 8 0 0 0 1.9 1.1l.4 2.6h3.9l.4-2.6a8 8 0 0 0 1.9-1.1l2.4.9 2-3.4z"/></svg></button>
          <button id="fs" aria-label="Fullscreen"><svg viewBox="0 0 24 24"><path d="M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v4h4v2H4zm14 0h2v6h-6v-2h4z"/></svg></button>
        </div>
      </div>
    </div>
    <h1>Dusk over the ridge — 4K slow travel</h1>
    <div class="meta">Wandering Frames · 412K views · 3 days ago</div>
    <div class="desc">Eleven quiet minutes of the light leaving the mountains. No music, no talking — just the ridge, the wind and a sky going orange.</div>
    <div class="comments"><p><b>Maya R.</b> · this is my study background now</p><p><b>tomas_k</b> · the color at 6:40 is unreal</p><p><b>Ines</b> · watching this in a corner of my screen while I work</p></div>
  </section>
  <aside id="side"></aside>
</main>
<script>
${POSTER_JS}
document.getElementById('vid').poster = drawPoster(1280, 720);
const side = document.getElementById('side');
const hues = [[24,60],[200,250],[140,190],[300,340],[40,10],[180,220]];
const titles = ['Rain on a tin roof, 3 hours','Night ferry across the fjord','Forest path after the storm','City lights from the 40th floor','Desert road at golden hour','Harbor fog, early morning'];
titles.forEach((t, i) => {
  const d = document.createElement('div'); d.className = 'card';
  d.innerHTML = '<div class="th" style="background:linear-gradient(135deg,hsl(' + hues[i][0] + ' 55% 45%),hsl(' + hues[i][1] + ' 50% 22%))"></div><div><div class="t">' + t + '</div><div class="s">Wandering Frames · ' + (90 + i * 37) + 'K views</div></div>';
  side.appendChild(d);
});
// Like big video sites: the player's fullscreen button fullscreens the document.
document.getElementById('fs').onclick = () => document.documentElement.requestFullscreen().catch(() => {});
if (location.search.includes('auto')) {
  // A real click's sequence: the extension only redirects a page-level
  // fullscreen when the gesture started inside the player.
  setTimeout(() => {
    const fs = document.getElementById('fs');
    fs.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    fs.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, 1400);
}
</script></body></html>`;

const DOCS = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body { margin: 0; font: 14px/1.6 system-ui, "Segoe UI", sans-serif; background: #fbfaf7; color: #26252b; }
  .wrap { padding: 26px 28px; }
  h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 22px 0 6px; }
  .muted { color: #7a7884; font-size: 12.5px; }
  pre { background: #f0eee8; border-radius: 8px; padding: 10px 12px; font: 12.5px/1.5 ui-monospace, Consolas, monospace; overflow: hidden; }
  li { margin: 4px 0; }
</style></head><body><div class="wrap">
  <h1>Quarterly report — draft</h1><div class="muted">Edited 2 minutes ago</div>
  <h2>Summary</h2>
  <p>Revenue grew 12% quarter over quarter, driven mostly by the new self-serve plan. Churn held steady at 2.1%.</p>
  <h2>Highlights</h2>
  <ul><li>Self-serve signups up 38%</li><li>Support response time down to 3h 10m</li><li>Two enterprise renewals closed early</li></ul>
  <h2>Next quarter</h2>
  <p>Focus on onboarding: shorten time-to-first-value from five days to two.</p>
  <pre>target_ttfv_days = 2
owner = "growth"
review = "2026-12-15"</pre>
</div></body></html>`;

const NOTES = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body { margin: 0; font: 14px/1.5 system-ui, "Segoe UI", sans-serif; background: #f3f5fb; color: #1f2333; }
  .wrap { padding: 18px 18px; display: flex; flex-direction: column; gap: 10px; }
  .h { font-weight: 700; font-size: 15px; padding: 4px 2px 8px; border-bottom: 1px solid #dfe3ef; }
  .m { max-width: 82%; padding: 9px 12px; border-radius: 14px; background: #fff; box-shadow: 0 1px 2px rgb(0 0 0 / .06); }
  .m.me { align-self: flex-end; background: #4f6bed; color: #fff; }
  .n { font-size: 11.5px; color: #7d8196; margin-bottom: 2px; }
</style></head><body><div class="wrap">
  <div class="h"># design-review</div>
  <div><div class="n">Priya · 10:41</div><div class="m">Pushed the new onboarding flow, screens 3–5 are ready</div></div>
  <div><div class="n">Leo · 10:43</div><div class="m">Looks great. Can we shorten the copy on step 4?</div></div>
  <div class="m me">On it — will send a revision after lunch</div>
  <div><div class="n">Priya · 10:47</div><div class="m">👍 also the empty state needs an illustration</div></div>
  <div class="m me">Adding it to the list</div>
</div></body></html>`;

const SPLIT = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; height: 100vh; display: flex; gap: 6px; padding: 6px; background: #2a2a33; }
  .pane { flex: 1; display: flex; flex-direction: column; border-radius: 10px; overflow: hidden; background: #fff; }
  .pane.wide { flex: 1.35; }
  .bar { height: 34px; flex: none; display: flex; align-items: center; gap: 8px; padding: 0 12px; background: #1f1f27;
         font: 12px system-ui, "Segoe UI", sans-serif; color: #b9b9c8; }
  .bar .url { flex: 1; height: 22px; border-radius: 11px; background: #2c2c37; display: flex; align-items: center; padding: 0 10px; }
  iframe { flex: 1; border: 0; width: 100%; }
</style></head><body>
  <div class="pane"><div class="bar"><span class="url">docs.example/report</span></div><iframe src="/docs"></iframe></div>
  <div class="pane"><div class="bar"><span class="url">chat.example/design-review</span></div><iframe src="/notes"></iframe></div>
  <div class="pane wide"><div class="bar"><span class="url">lumen.example/watch</span></div><iframe src="/site?auto=1"></iframe></div>
</body></html>`;

const PROMO = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body { margin: 0; width: 440px; height: 280px; overflow: hidden; font-family: system-ui, "Segoe UI", sans-serif;
         background: radial-gradient(120% 140% at 85% 0%, #3b2f6e 0%, #16151f 60%); color: #fff; }
  .frame { position: absolute; right: -30px; top: 70px; width: 250px; height: 150px; border-radius: 12px; overflow: hidden;
           box-shadow: 0 18px 40px rgb(0 0 0 / .5); border: 1px solid rgb(255 255 255 / .12); }
  .frame img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .txt { position: absolute; left: 28px; top: 34px; width: 210px; }
  .txt img { width: 44px; height: 44px; display: block; margin-bottom: 14px; }
  h1 { margin: 0; font-size: 25px; line-height: 1.1; letter-spacing: -.02em; }
  p { margin: 10px 0 0; font-size: 14.5px; line-height: 1.35; color: #cfcbe8; }
</style></head><body>
  <div class="frame"><img id="poster"></div>
  <div class="txt"><img src="${iconData}"><h1>Fake Fullscreen</h1><p>Just the video, filling the tab. Perfect for split view.</p></div>
<script>${POSTER_JS} document.getElementById('poster').src = drawPoster(500, 300);</script>
</body></html>`;

const ROUTES = { '/site': SITE, '/docs': DOCS, '/notes': NOTES, '/split': SPLIT, '/promo': PROMO };

/* ------------------------------------------------------------------ */

(async () => {
  if (!exe) { console.error('No Chromium-based browser found; pass its path.'); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });

  const server = http.createServer((req, res) => {
    const page = ROUTES[new URL(req.url, 'http://x').pathname];
    if (!page) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page);
  }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'ffs-shots-')), {
    executablePath: exe,
    headless: true,
    viewport: { width: W, height: H },
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`, '--headless=new', '--hide-scrollbars'],
  });
  const shot = async (page, name) => {
    await page.screenshot({ path: path.join(OUT, name) });
    console.log('wrote', path.join('store', 'screenshots', name));
  };

  try {
    const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
    const extId = new URL(sw.url()).host;
    // Demo rules for the settings screenshot.
    await sw.evaluate(() => chrome.storage.sync.set({
      siteRules: [{ domain: 'news.example', enabled: false }],
      siteHosts: [
        { domain: 'lumen.example', kind: 'video', selector: '#player' },
        { domain: 'youtube.com', kind: 'video', selector: '#movie_player' },
        { domain: 'youtube-nocookie.com', kind: 'video', selector: '#movie_player' },
      ],
    }));

    const page = await ctx.newPage();

    // 1. Split view — the right pane's player goes fake-fullscreen.
    await page.goto(`${base}/split`);
    await sleep(2600);
    await shot(page, '1-split-view.png');

    // 2. Theater — the video fills the tab, controls on top.
    await page.goto(`${base}/site?auto=1`);
    await sleep(2200);
    await page.mouse.move(640, 380);
    await page.mouse.move(660, 400);
    await sleep(250);
    await shot(page, '2-theater.png');
    const theaterPng = await page.screenshot();

    // 4. Hover button on a normal page.
    await page.goto(`${base}/site`);
    await sleep(900);
    await page.mouse.move(420, 300);
    await sleep(250);
    const btn = await page.evaluate(() => {
      const b = document.querySelector('.ffs-btn.ffs-btn--visible');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (btn) { await page.mouse.move(btn.x, btn.y); await sleep(350); }
    await shot(page, '4-hover-button.png');

    // 3. Toolbar panel over the theater (the real popup, rendered with the
    //    state it shows while a theater is live on the demo site).
    const popup = await ctx.newPage();
    await popup.setViewportSize({ width: 300, height: 760 });
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    await sleep(500);
    await popup.evaluate(() => {
      renderSiteCard({ hostname: 'lumen.example', active: true });
      document.getElementById('toggleTheater').disabled = false;
      document.getElementById('toggleTheater').textContent = 'Exit theater mode';
      document.getElementById('pickElement').disabled = false;
      renderLayer({ hostname: 'lumen.example', label: 'div#player', canUp: true, canDown: true, kind: 'video',
        rule: { domain: 'lumen.example', selector: '#player' } });
    });
    const h = await popup.evaluate(() => document.body.scrollHeight);
    await popup.setViewportSize({ width: 300, height: h });
    const popupPng = await popup.screenshot();
    await popup.close();
    const comp = await ctx.newPage();
    await comp.setViewportSize({ width: W, height: H });
    await comp.setContent(`<!DOCTYPE html><html><body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;position:relative;background:#000">
      <img src="data:image/png;base64,${theaterPng.toString('base64')}" style="position:absolute;inset:0;width:100%;height:100%;filter:brightness(.72)">
      <img src="data:image/png;base64,${popupPng.toString('base64')}" style="position:absolute;top:14px;right:22px;width:300px;border-radius:10px;box-shadow:0 18px 50px rgb(0 0 0 / .6),0 0 0 1px rgb(255 255 255 / .08)">
    </body></html>`);
    await sleep(300);
    await shot(comp, '3-panel.png');

    // 5. Settings — per-site rules + player containers.
    await comp.goto(`chrome-extension://${extId}/options.html`);
    await sleep(600);
    await comp.evaluate(() => {
      const f = document.getElementById('ruleList').closest('.field');
      window.scrollTo(0, f.getBoundingClientRect().top + window.scrollY - 150);
    });
    await sleep(200);
    await shot(comp, '5-settings.png');

    // Small promo tile.
    await comp.setViewportSize({ width: 440, height: 280 });
    await comp.goto(`${base}/promo`);
    await sleep(300);
    await shot(comp, 'promo-440x280.png');
  } finally {
    await ctx.close();
    server.close();
  }
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
