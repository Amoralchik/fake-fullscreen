/**
 * Smoke test in a REAL Firefox-family browser (Firefox, Zen, …) with
 * the extension loaded via `web-ext run`. Firefox can't be driven like
 * Chromium here, so the test page checks itself and POSTs its results
 * back to this script's local server.
 *
 * Run:
 *   npm i web-ext --no-save
 *   node tools/test_e2e_firefox.js ["C:/Program Files/Zen Browser/zen.exe"]
 */
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const EXT = process.env.FFS_EXT_DIR ? path.resolve(process.env.FFS_EXT_DIR) : path.resolve(__dirname, '..');
const BIN = [
  process.argv[2],
  'C:/Program Files/Zen Browser/zen.exe',
  'C:/Program Files/Mozilla Firefox/firefox.exe',
  '/usr/bin/firefox',
].filter(Boolean).find((p) => fs.existsSync(p));

const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>ffs firefox</title>
<style>
  body { margin: 0; }
  #player { position: relative; width: 640px; height: 360px; margin: 40px; background: #000; }
  #player video { position: absolute; inset: 0; width: 640px; height: 360px; background: #123; }
  #bar { position: absolute; left: 0; right: 0; bottom: 0; height: 44px; display: flex; }
  #seek { flex: 1; background: #c00; }
</style></head><body>
<div id="player"><video id="vid"></video>
  <div id="bar"><div id="seek" role="slider"></div><button id="fs">fs</button></div></div>
<script>
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const host = () => document.querySelector('.ffs-theater-host')?.id || null;
(async () => {
  const r = {};
  await sleep(2500);
  r.patched = !!Element.prototype.__ffsPatched;
  r.prevent = document.documentElement.dataset.ffsPrevent;

  // a) container fullscreen
  let ok = false;
  await document.getElementById('player').requestFullscreen().then(() => ok = true, () => {});
  await sleep(300);
  r.containerHost = host(); r.containerResolved = ok; r.realFs = !!document.fullscreenElement;

  // dblclick on the seek bar must not exit; on the picture it must
  document.getElementById('seek').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));
  await sleep(100);
  r.afterSeekDbl = host();
  document.getElementById('vid').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));
  await sleep(200);
  r.afterVideoDbl = host();

  // b) YouTube-style: player button → document.documentElement fullscreen
  document.getElementById('fs').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
  await document.documentElement.requestFullscreen().catch(() => {});
  await sleep(400);
  r.docHost = host(); r.docRealFs = !!document.fullscreenElement;
  await document.documentElement.requestFullscreen().catch(() => {});
  await sleep(300);
  r.docToggledOff = host();

  await fetch('/result', { method: 'POST', body: JSON.stringify(r) });
})();
</script></body></html>`;

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.log(`FAIL  ${name}${extra !== undefined ? ' — ' + JSON.stringify(extra) : ''}`); }
}

if (!BIN) { console.error('No Firefox-family browser found; pass its path.'); process.exit(2); }
console.log('Browser:', BIN);

let child;
const timeout = setTimeout(() => { console.error('TIMEOUT waiting for results'); finish(2); }, 90000);
function finish(code) {
  clearTimeout(timeout);
  // Kill the whole tree: web-ext's browser outlives a plain child.kill()
  // on Windows.
  try {
    if (child && process.platform === 'win32') {
      require('child_process').spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else if (child) child.kill();
  } catch { /* ignore */ }
  server.close();
  process.exit(code);
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/result') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.end('ok');
      const r = JSON.parse(body);
      check('MAIN-world patch installed (injected.js via world:"MAIN")', r.patched, r);
      check('content script set data-ffs-prevent="1"', r.prevent === '1', r);
      check('container fullscreen → theater on the container', r.containerHost === 'player', r);
      check('site saw requestFullscreen() succeed', r.containerResolved, r);
      check('no real fullscreen', !r.realFs && !r.docRealFs, r);
      check('dblclick on seek bar keeps theater', r.afterSeekDbl === 'player', r);
      check('dblclick on the picture exits', r.afterVideoDbl === null, r);
      check('document fullscreen from the player → theater', r.docHost === 'player', r);
      check('second document fullscreen press exits', r.docToggledOff === null, r);
      console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
      finish(failures === 0 ? 0 : 1);
    });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(PAGE);
}).listen(0, () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  // web-ext's package "exports" hide bin/ from require.resolve — look
  // for it on the normal module search path (plus NODE_PATH) instead.
  const dirs = [...module.paths, ...(process.env.NODE_PATH || '').split(path.delimiter)].filter(Boolean);
  const webExt = dirs.map((d) => path.join(d, 'web-ext', 'bin', 'web-ext.js')).find((p) => fs.existsSync(p));
  if (!webExt) { console.error('web-ext not installed (npm i web-ext --no-save)'); finish(2); }
  child = spawn(process.execPath, [webExt, 'run', '--source-dir', EXT, '--firefox', BIN,
    '--start-url', url, '--no-reload', '--no-input'], { stdio: 'ignore' });
});
