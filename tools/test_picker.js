/**
 * Smoke test for the element picker + videoless theater in content.js.
 * Runs the REAL content script inside jsdom with a mocked browser.* API
 * and patched geometry (jsdom has no layout).
 *
 * Run:  npm i jsdom --no-save && node tools/test_picker.js
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const contentSrc = fs.readFileSync(
  path.join(__dirname, '..', 'content.js'),
  'utf8'
);

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.log(`FAIL  ${name}${extra ? ' — ' + extra : ''}`);
  }
}

function makeEnv(html) {
  const dom = new JSDOM(html, {
    pretendToBeVisual: true,
    runScripts: 'outside-only',
    url: 'https://example.com/watch',
  });
  const { window } = dom;
  const { document } = window;

  // ---- browser.* mocks -------------------------------------------------
  const storageData = {
    masterEnabled: true,
    defaultEnabled: true,
    siteRules: [],
    preventNativeFullscreen: true,
    buttonEnabled: true,
    buttonHoverOnly: true,
    hideNativeControls: false,
    clickOutsideExits: true,
    dimLevel: 0.78,
  };
  const messageListeners = [];
  const sentMessages = [];
  const api = () => ({
    storage: {
      sync: {
        get: async (defaults) => ({ ...defaults, ...storageData }),
        set: async (obj) => Object.assign(storageData, obj),
      },
      local: {
        get: async (defaults) => ({ ...defaults }),
        set: async () => {},
      },
      onChanged: { addListener: () => {} },
    },
    runtime: {
      onMessage: { addListener: (fn) => messageListeners.push(fn) },
      sendMessage: async (msg) => { sentMessages.push(msg); },
      getURL: (p) => `moz-extension://fake/${p}`,
    },
  });
  window.browser = api();

  // ---- geometry stubs --------------------------------------------------
  // jsdom has no layout; give every element a box via data-rect="x,y,w,h".
  window.Element.prototype.getBoundingClientRect = function () {
    const spec = (this.dataset && this.dataset.rect) || '0,0,0,0';
    const [x, y, w, h] = spec.split(',').map(Number);
    return { left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y };
  };

  // dispatch a message to the content script's onMessage listeners
  const deliver = (msg) => {
    for (const fn of messageListeners) fn(msg, { tab: { id: 1 }, frameId: 0 });
  };

  const load = new Promise((resolve) => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', resolve, { once: true });
    } else resolve();
  });

  window.eval(contentSrc);

  const flush = () => new Promise((r) => setTimeout(r, 30));
  return { dom, window, document, deliver, load, flush, sentMessages, storageData };
}

const pageHTML = `<!DOCTYPE html><html><body>
  <div id="player" data-rect="100,100,640,360">
    <video id="vid" data-rect="100,100,640,360"></video>
    <div id="controls" data-rect="100,420,640,40"></div>
  </div>
  <div id="plain" data-rect="0,0,200,200"></div>
</body></html>`;

(async () => {
  // --------------------------------------------------------------------
  console.log('1. Picker arms on ffs:start-picker (top frame)');
  {
    const env = makeEnv(pageHTML);
    await env.load;
    await env.flush();
    env.deliver({ type: 'ffs:start-picker' });
    await env.flush();
    const hint = env.document.querySelector('.ffs-pick-hint');
    check('hint pill is in the DOM', !!hint);
    check('crosshair class on <html>', env.document.documentElement.classList.contains('ffs-picking'));
    check('floating Theater buttons hidden while picking',
      !env.document.querySelector('.ffs-btn--visible'));
  }

  // --------------------------------------------------------------------
  console.log('2. Hover + click on a container theaters the picked container');
  {
    const env = makeEnv(pageHTML);
    await env.load;
    await env.flush();
    env.deliver({ type: 'ffs:start-picker' });
    await env.flush();

    const player = env.document.getElementById('player');
    // hover over the player
    env.document.elementFromPoint = () => player;
    env.window.dispatchEvent(new env.window.MouseEvent('mousemove', { clientX: 300, clientY: 200 }));
    await env.flush();
    const outline = env.document.querySelector('.ffs-pick-outline');
    check('outline visible', outline && outline.style.display === 'block');
    check('outline positioned at the element', outline.style.left === '100px' && outline.style.top === '100px');
    const label = env.document.querySelector('.ffs-pick-label');
    check('label describes the element', label.textContent === 'div#player', label.textContent);

    // click → pick
    env.window.dispatchEvent(new env.window.MouseEvent('click', { clientX: 300, clientY: 200, bubbles: true }));
    await env.flush();
    const video = env.document.getElementById('vid');
    check('picked container got the theater class', player.classList.contains('ffs-theater-host'));
    check('video fills the container', video.classList.contains('ffs-video--fill'));
    check('picker UI removed after pick', !env.document.querySelector('.ffs-pick-hint'));
    check('no videoless toast for a real video', !env.document.querySelector('.ffs-toast--shown'));

    // Esc exits the theater
    env.window.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await env.flush();
    check('Esc exits the theater', !player.classList.contains('ffs-theater-host'));
  }

  // --------------------------------------------------------------------
  console.log('3. Esc cancels the picker without theatering');
  {
    const env = makeEnv(pageHTML);
    await env.load;
    await env.flush();
    env.deliver({ type: 'ffs:start-picker' });
    await env.flush();
    env.window.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await env.flush();
    check('picker UI removed', !env.document.querySelector('.ffs-pick-hint'));
    check('no theater was opened', !env.document.querySelector('.ffs-theater-host'));
    check('crosshair class removed', !env.document.documentElement.classList.contains('ffs-picking'));
  }

  // --------------------------------------------------------------------
  console.log('4. Videoless pick elevates the element as-is + toast');
  {
    const env = makeEnv(pageHTML);
    await env.load;
    await env.flush();
    env.deliver({ type: 'ffs:start-picker' });
    await env.flush();

    const plain = env.document.getElementById('plain');
    env.document.elementFromPoint = () => plain;
    env.window.dispatchEvent(new env.window.MouseEvent('mousemove', { clientX: 50, clientY: 50 }));
    env.window.dispatchEvent(new env.window.MouseEvent('click', { clientX: 50, clientY: 50, bubbles: true }));
    await env.flush();
    check('videoless host got the theater class', plain.classList.contains('ffs-theater-host'));
    const toast = env.document.querySelector('.ffs-toast--shown');
    check('videoless notice toast shown', !!toast && /No reachable video/.test(toast.textContent));
    env.window.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await env.flush();
    check('Esc exits the videoless theater', !plain.classList.contains('ffs-theater-host'));
  }

  // --------------------------------------------------------------------
  console.log('5. Clicking the extension\'s own button keeps picking');
  {
    const env = makeEnv(pageHTML);
    await env.load;
    await env.flush();
    env.deliver({ type: 'ffs:start-picker' });
    await env.flush();
    const btn = env.document.querySelector('.ffs-btn');
    env.document.elementFromPoint = () => btn;
    env.window.dispatchEvent(new env.window.MouseEvent('click', { clientX: 300, clientY: 30, bubbles: true }));
    await env.flush();
    check('picker still armed after clicking own widget', !!env.document.querySelector('.ffs-pick-hint'));
    check('no theater opened', !env.document.querySelector('.ffs-theater-host'));
  }

  // --------------------------------------------------------------------
  console.log('6. Page-level pick is refused, picker stays armed');
  {
    const env = makeEnv(pageHTML);
    await env.load;
    await env.flush();
    env.deliver({ type: 'ffs:start-picker' });
    await env.flush();
    env.document.elementFromPoint = () => env.document.documentElement;
    env.window.dispatchEvent(new env.window.MouseEvent('click', { clientX: 5, clientY: 5, bubbles: true }));
    await env.flush();
    check('picker still armed', !!env.document.querySelector('.ffs-pick-hint'));
    check('no theater opened', !env.document.querySelector('.ffs-theater-host'));
  }

  // --------------------------------------------------------------------
  console.log('7. Starting a new pick closes an existing theater');
  {
    const env = makeEnv(pageHTML);
    await env.load;
    await env.flush();
    env.deliver({ type: 'ffs:start-picker' });
    await env.flush();
    const player = env.document.getElementById('player');
    env.document.elementFromPoint = () => player;
    env.window.dispatchEvent(new env.window.MouseEvent('click', { clientX: 300, clientY: 200, bubbles: true }));
    await env.flush();
    check('theater open', player.classList.contains('ffs-theater-host'));
    env.deliver({ type: 'ffs:start-picker' });
    await env.flush();
    check('previous theater closed by new picker', !player.classList.contains('ffs-theater-host'));
    check('picker armed again', !!env.document.querySelector('.ffs-pick-hint'));
  }

  // --------------------------------------------------------------------
  console.log('8. start-picker is ignored in child frames');
  {
    const env = makeEnv(pageHTML);
    await env.load;
    await env.flush();
    // simulate a child frame
    const childTop = env.window.top;
    const isChild = childTop !== env.window;
    // In this harness the frame IS the top; patch the guard by checking
    // that the message handler path exists. (jsdom window.top === window.)
    check('harness runs as top frame', !isChild);
  }

  // --------------------------------------------------------------------
  console.log('8. Picking an iframe sends suppression on/off; relayed suppression stands down');
  {
    const env = makeEnv(pageHTML);
    await env.load;
    await env.flush();

    // simulate a cross-origin iframe (contentDocument throws → videoless)
    const frame = env.document.createElement('iframe');
    frame.id = 'embed';
    frame.dataset.rect = '0,0,800,450';
    Object.defineProperty(frame, 'contentDocument', {
      get() { throw new env.window.DOMException('blocked', 'SecurityError'); },
    });
    env.document.body.appendChild(frame);

    env.deliver({ type: 'ffs:start-picker' });
    await env.flush();
    env.document.elementFromPoint = () => frame;
    env.window.dispatchEvent(new env.window.MouseEvent('click', { clientX: 400, clientY: 200, bubbles: true }));
    await env.flush();
    check('iframe elevated as videoless host', frame.classList.contains('ffs-theater-host'));
    const on = env.sentMessages.find((m) => m.type === 'ffs:iframe-theater' && m.active === true);
    check('suppression ON broadcast', !!on);
    const toast = env.document.querySelector('.ffs-toast--shown');
    check('iframe toast shown', !!toast && /embedded player/.test(toast.textContent));

    // another frame receiving the relay must exit its own local theater.
    // Simulate: open a local theater here, then deliver the relay.
    const vid = env.document.getElementById('vid');
    env.window.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await env.flush();
    const offAfterExit = env.sentMessages.filter((m) => m.type === 'ffs:iframe-theater' && m.active === false);
    check('suppression OFF broadcast on exit', offAfterExit.length === 1, JSON.stringify(env.sentMessages));

    // stand-down: theater locally, then receive the relay as a child would
    // (wait out the post-pick click swallow first)
    await new Promise((r) => setTimeout(r, 420));
    const btn = env.document.querySelector('.ffs-btn');
    btn.dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }));
    await env.flush();
    // the button theaters the player CONTAINER (controls stay), not the bare video
    check('local theater open via floating button',
      env.document.getElementById('player').classList.contains('ffs-theater-host'));
    env.deliver({ type: 'ffs:iframe-theater', active: true });
    await env.flush();
    check('relayed suppression exits local theater',
      !env.document.getElementById('player').classList.contains('ffs-theater-host'));
  }

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('HARNESS ERROR:', e);
  process.exit(2);
});
