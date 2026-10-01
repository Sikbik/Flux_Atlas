// End-to-end smoke test: starts the Rust demo server (fast 3 s blocks) and `vite preview` of a test
// build (VITE_ATLAS_TEST=1 into dist-e2e, which exposes window.__atlasGlobeStats), loads the app in
// headless system Chromium (SwiftShader WebGL), and asserts the WebSocket goes live, a block arrives,
// the globe draws the network and plays a Beat, and the window manager follows the URL.
//
//   npm run e2e
//
// Env: ATLAS_DEMO_BIN (a prebuilt demo_server binary; default `cargo run --example demo_server`),
// CARGO_TARGET_DIR (respected by cargo), CHROMIUM (browser path), ATLAS_E2E_SKIP_BUILD=1 (reuse
// web/dist-e2e).
//
// ATLAS_E2E_SERVER=http://host:port targets an already running server (for example `atlas serve`
// against the real network) instead of starting the demo server: blocks then arrive every ~30 s,
// and the fixture-specific route test and the restart test are skipped. ATLAS_WEB_PORT pins the
// preview port.
import assert from 'node:assert/strict';
import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = resolve(webDir, '..');
const env = { ...process.env, PATH: `${join(homedir(), '.cargo', 'bin')}:${process.env.PATH}` };

function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

async function waitHttp(url, timeoutMs) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
      last = `HTTP ${r.status}`;
    } catch (e) {
      last = e.message;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${url}: ${last}`);
}

function start(cmd, args, opts) {
  const child = spawn(cmd, args, { ...opts, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = [];
  const keep = (d) => {
    log.push(d.toString());
    if (log.length > 200) log.shift();
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.log = log;
  return child;
}

function stop(child) {
  if (!child || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGINT');
  } catch {
    // Already gone.
  }
}

const external = process.env.ATLAS_E2E_SERVER?.replace(/\/+$/, '') || null;
const skipExternal = external
  ? 'targets an external server (fixture data and restarts only in demo mode)'
  : false;
// Real blocks are ~30 s apart; the demo server makes one every 3 s.
const blockWaitMs = external ? 120_000 : 30_000;

let demo;
let preview;
let browser;
let base;
let apiPort;
const pageErrors = [];

function startDemo() {
  const demoEnv = { ...env, ATLAS_DEMO_BLOCK_MS: '3000', ATLAS_LOG: 'warn' };
  return process.env.ATLAS_DEMO_BIN
    ? start(process.env.ATLAS_DEMO_BIN, [`127.0.0.1:${apiPort}`], { cwd: repoDir, env: demoEnv })
    : start(
        'cargo',
        ['run', '--quiet', '-p', 'atlas-server', '--example', 'demo_server', '--', `127.0.0.1:${apiPort}`],
        {
          cwd: repoDir,
          env: demoEnv,
        },
      );
}

before(async () => {
  if (!external) apiPort = await freePort();
  const apiUrl = external ?? `http://127.0.0.1:${apiPort}`;
  const webPort = Number(process.env.ATLAS_WEB_PORT) || (await freePort());
  if (!external) demo = startDemo();
  if (!process.env.ATLAS_E2E_SKIP_BUILD || !existsSync(join(webDir, 'dist-e2e', 'index.html'))) {
    execSync('npx vite build --outDir dist-e2e --emptyOutDir', {
      cwd: webDir,
      stdio: 'inherit',
      env: { ...env, VITE_ATLAS_TEST: '1' },
    });
  }
  preview = start(
    join(webDir, 'node_modules', '.bin', 'vite'),
    ['preview', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort', '--outDir', 'dist-e2e'],
    { cwd: webDir, env: { ...env, ATLAS_API_TARGET: apiUrl } },
  );
  base = `http://127.0.0.1:${webPort}`;
  try {
    // The first run compiles the demo server.
    await waitHttp(`${apiUrl}/healthz`, 600_000);
    await waitHttp(`${base}/`, 60_000);
  } catch (e) {
    console.error('demo server log:\n', demo?.log.join('') ?? '(external)');
    console.error('preview log:\n', preview.log.join(''));
    throw e;
  }
  const exe = process.env.CHROMIUM || ['/usr/bin/chromium', '/usr/bin/google-chrome-stable'].find(existsSync);
  browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
});

after(async () => {
  await browser?.close();
  stop(preview);
  stop(demo);
});

async function open(path) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', (e) => pageErrors.push(`${path}: ${e.message}`));
  await page.goto(`${base}${path}`, { waitUntil: 'load' });
  return page;
}

async function intOf(page, testId) {
  const t = await page.getByTestId(testId).textContent();
  return Number((t ?? '').replace(/[^0-9]/g, ''));
}

test('the WebSocket goes live and a block arrives', { timeout: blockWaitMs + 60_000 }, async () => {
  const page = await open('/dev/live');
  await page.waitForFunction(
    () => document.querySelector('[data-testid=conn-status]')?.textContent === 'live',
    null,
    {
      timeout: 30_000,
    },
  );
  // A mainnet-sized snapshot loaded from nodes.bin.
  assert.ok((await intOf(page, 'store-nodes')) >= 6_700, 'nodes.bin loaded');
  const before = await intOf(page, 'last-block-height');
  const seen = await intOf(page, 'live-blocks');
  await page.waitForFunction(
    (n) => Number(document.querySelector('[data-testid=live-blocks]')?.textContent ?? '0') > n,
    seen,
    { timeout: blockWaitMs },
  );
  assert.ok((await intOf(page, 'last-block-height')) > before, 'the tip advanced');
  // The status line reads live too, and the runtime received block messages over the socket.
  assert.equal(await page.getByTestId('live-status').first().getAttribute('data-status'), 'live');
  const blocks = await page.evaluate(() => globalThis.__atlas.live.metrics().byType.block ?? 0);
  assert.ok(blocks >= 1, 'block messages received');
  await page.close();
  assert.deepEqual(pageErrors, []);
});

test('every IA route renders, and unknown routes 404', { timeout: 90_000, skip: skipExternal }, async () => {
  const routes = [
    ['/', null],
    ['/node/1', 'Node 1'],
    ['/host/5.0.0.1', 'Host 5.0.0.1'],
    ['/app/kadenanode', 'App kadenanode'],
    ['/app/kadenanode/history/2', 'spec version 2'],
    ['/block/2996914', 'Block 2996914'],
    ['/mempool', 'Mempool'],
    ['/queue', 'Payment queue'],
    ['/queue/stratus', 'Payment queue, stratus'],
    ['/analytics/geography', 'Analytics, geography'],
    ['/time?speed=60', 'Time machine'],
    ['/weather', 'Network weather'],
    ['/terminal?cmd=help', 'Terminal'],
    ['/about', 'About Flux'],
    ['/settings', 'Settings'],
    ['/ambient', null],
    ['/queue/bogus', 'No such page'],
    ['/no/such/route', 'No such page'],
  ];
  for (const [path, heading] of routes) {
    const page = await open(path);
    if (heading) {
      await page.getByRole('heading', { name: heading }).first().waitFor({ timeout: 15_000 });
    } else {
      await page.waitForSelector('[data-globe]', { timeout: 15_000 });
    }
    await page.close();
  }
  assert.deepEqual(pageErrors, []);
});

const statusIs = (want) => document.querySelector('[data-testid=conn-status]')?.textContent === want;

test('a server restart is survived: reconnect, resync, live again', {
  timeout: 120_000,
  skip: skipExternal,
}, async () => {
  const page = await open('/dev/live');
  await page.waitForFunction(statusIs, 'live', { timeout: 30_000 });
  const resyncsBefore = await intOf(page, 'resyncs');
  // Graceful shutdown: the server closes sockets with 1001 and the client starts backing off.
  const exited = new Promise((r) => demo.once('exit', r));
  stop(demo);
  await page.waitForFunction(
    () =>
      ['reconnecting', 'connecting', 'syncing'].includes(
        document.querySelector('[data-testid=conn-status]')?.textContent ?? '',
      ),
    null,
    { timeout: 20_000 },
  );
  await exited;
  demo = startDemo();
  await waitHttp(`http://127.0.0.1:${apiPort}/healthz`, 120_000);
  // The new server has a new seq space: the client must refetch the snapshot, not replay.
  await page.waitForFunction(statusIs, 'live', { timeout: 60_000 });
  assert.ok((await intOf(page, 'resyncs')) > resyncsBefore, 'resynced after the restart');
  const blocks = await page.evaluate(() => globalThis.__atlas.live.metrics().byType.block ?? 0);
  await page.waitForFunction((n) => (globalThis.__atlas.live.metrics().byType.block ?? 0) > n, blocks, {
    timeout: 30_000,
  });
  await page.close();
  assert.deepEqual(pageErrors, []);
});

// ---- the globe ---------------------------------------------------------------------------------

const globeReady = () => window.__atlasGlobeStats?.ready === true && window.__atlasGlobeStats.nodes > 0;

test('the globe draws the live network (~6.7k nodes) from the store', { timeout: 120_000 }, async () => {
  const page = await open('/');
  await page.waitForFunction(globeReady, null, { timeout: 60_000 });
  await page.waitForFunction(() => globalThis.__atlas.store.loaded, null, { timeout: 30_000 });
  const { drawn, store } = await page.evaluate(() => ({
    drawn: window.__atlasGlobeStats.nodes,
    store: globalThis.__atlas.store.nodes.count,
  }));
  assert.ok(drawn >= 6_600 && drawn <= 7_000, `globe draws ${drawn} nodes`);
  assert.ok(Math.abs(drawn - store) <= 20, `globe (${drawn}) matches the store (${store})`);
  assert.equal(await page.locator('canvas.globe-canvas').count(), 1);
  await page.close();
  assert.deepEqual(pageErrors, []);
});

test('a Beat plays on the globe after a block lands', { timeout: 120_000 }, async () => {
  const page = await open('/');
  await page.waitForFunction(globeReady, null, { timeout: 60_000 });
  const before = await page.evaluate(() => ({
    beats: window.__atlasGlobeStats.beats,
    blocks: globalThis.__atlas.live.metrics().byType.block ?? 0,
  }));
  await page.waitForFunction(
    (n) => (globalThis.__atlas.live.metrics().byType.block ?? 0) > n,
    before.blocks,
    {
      timeout: 30_000,
    },
  );
  // The Beat fires at t = 0; the relay's beams leave the moon from 1020 ms and land by 2140 ms.
  await page.waitForFunction((n) => window.__atlasGlobeStats.beats > n, before.beats, { timeout: 10_000 });
  await page.waitForFunction(
    () => window.__atlasGlobeStats.downlinks > 0 && window.__atlasGlobeStats.payouts > 0,
    null,
    {
      timeout: 10_000,
    },
  );
  await page.close();
  assert.deepEqual(pageErrors, []);
});

test('the globe never remounts across routes; windows follow the URL', { timeout: 120_000 }, async () => {
  const page = await open('/');
  await page.waitForFunction(globeReady, null, { timeout: 60_000 });
  await page.evaluate(() => {
    window.__firstCanvas = document.querySelector('canvas.globe-canvas');
  });
  const key = await page.evaluate(() => globalThis.__atlas.store.nodes.endpoint(5));
  const go = (p) =>
    page.evaluate((path) => {
      history.pushState({}, '', path);
      dispatchEvent(new PopStateEvent('popstate'));
    }, p);
  await go(`/node/${encodeURIComponent(key)}`);
  await page.waitForSelector('[data-window-type=node][data-placement=docked]', { timeout: 15_000 });
  await go('/queue?w=about');
  await page.waitForSelector('[data-window-type=queue]', { timeout: 15_000 });
  await page.waitForSelector('[data-window-type=about]', { timeout: 15_000 });
  assert.equal(await page.locator('[data-window-type=node]').count(), 0, 'the node window closed');
  // Esc closes the topmost window through the URL.
  await page.keyboard.press('Escape');
  await page.waitForFunction(
    () => !location.pathname.startsWith('/queue') || !location.search.includes('w='),
    null,
    {
      timeout: 10_000,
    },
  );
  await go('/ambient');
  await go('/');
  const same = await page.evaluate(
    () => window.__firstCanvas === document.querySelector('canvas.globe-canvas'),
  );
  assert.ok(same, 'one canvas for the whole session');
  assert.equal(await page.evaluate(() => window.__atlasGlobeStats.generation), 0);
  await page.close();
  assert.deepEqual(pageErrors, []);
});

test('a page panel takes the left column: the Pulse and the aim strip step aside and come back', {
  timeout: 120_000,
}, async () => {
  const page = await open('/');
  await page.waitForFunction(globeReady, null, { timeout: 60_000 });
  const visible = (sel) =>
    page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && Number.parseFloat(cs.opacity) > 0.9;
    }, sel);
  // The Pulse is a lazy chunk: wait for it to be on screen before judging.
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.pulse');
      return (
        !!el &&
        getComputedStyle(el).visibility !== 'hidden' &&
        Number.parseFloat(getComputedStyle(el).opacity) > 0.9
      );
    },
    null,
    { timeout: 30_000 },
  );
  const go = (p) =>
    page.evaluate((path) => {
      history.pushState({}, '', path);
      dispatchEvent(new PopStateEvent('popstate'));
    }, p);
  assert.equal(await page.locator('.shell[data-page]').count(), 0, 'no page panel on the bare globe');
  const hadAim = (await visible('.aimstrip:not([data-inline])')) === true;

  await go('/dev/live');
  await page.waitForSelector('.shell[data-page] .shell-page:not(:empty)', { timeout: 20_000 });
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('.pulse')).visibility === 'hidden',
    null,
    { timeout: 5_000 },
  );
  assert.equal(await visible('.pulse'), false, 'the Pulse is away while a page panel is up');
  if (hadAim)
    assert.notEqual(await visible('.aimstrip:not([data-inline])'), true, 'the aim strip is away too');

  await go('/');
  await page.waitForFunction(() => !document.querySelector('.shell[data-page]'), null, { timeout: 10_000 });
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.pulse');
      return (
        !!el &&
        getComputedStyle(el).visibility !== 'hidden' &&
        Number.parseFloat(getComputedStyle(el).opacity) > 0.9
      );
    },
    null,
    { timeout: 10_000 },
  );
  await page.close();
  assert.deepEqual(pageErrors, []);
});

test('the Pulse and the rail step back while the time machine shows the archive', {
  timeout: 120_000,
}, async () => {
  const page = await open('/');
  await page.waitForFunction(globeReady, null, { timeout: 60_000 });
  await page.waitForSelector('.pulse .pulse-list', { timeout: 30_000 });
  const state = () =>
    page.evaluate(() => {
      const cs = (sel) => getComputedStyle(document.querySelector(sel));
      return {
        pulseHeight: Math.round(document.querySelector('.pulse').getBoundingClientRect().height),
        list: cs('.pulse-list').visibility,
        track: cs('.rail-track').visibility,
      };
    });
  const live = await state();
  assert.equal(live.list, 'visible');
  assert.equal(live.track, 'visible');
  assert.ok(live.pulseHeight > 150, `the Pulse is a full card (${live.pulseHeight} px)`);

  // The time machine's view sets this on the document element while its handle is in the past.
  await page.evaluate(() => {
    document.documentElement.dataset.archive = 'on';
  });
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('.rail-track')).visibility === 'hidden',
    null,
    { timeout: 5_000 },
  );
  const away = await state();
  assert.equal(away.list, 'hidden', 'the feed is out of the key and reading order');
  assert.ok(away.pulseHeight < 60, `the Pulse folds to its head (${away.pulseHeight} px)`);

  await page.evaluate(() => {
    delete document.documentElement.dataset.archive;
  });
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('.rail-track')).visibility === 'visible',
    null,
    { timeout: 5_000 },
  );
  await page.waitForFunction(
    () => document.querySelector('.pulse').getBoundingClientRect().height > 150,
    null,
    {
      timeout: 5_000,
    },
  );
  await page.close();
  assert.deepEqual(pageErrors, []);
});

test('the Beat reads t minus and the status bar the archived moment while the time machine shows one', {
  timeout: 120_000,
}, async () => {
  const page = await open('/');
  await page.waitForFunction(globeReady, null, { timeout: 60_000 });
  await page.waitForSelector('.topbar .beat-anim', { timeout: 30_000 });
  const beat = () =>
    page.evaluate(() => {
      const el = document.querySelector('.topbar .beat');
      const text = (sel) => document.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
      return {
        tag: el?.tagName,
        phase: el?.dataset.phase,
        tip: text('.topbar .beat-tip'),
        sub: text('.topbar .beat-sub'),
        ring: !!document.querySelector('.topbar .beat-anim'),
        light: !!document.querySelector('.topbar-light'),
        face: !!document.querySelector('.topbar .beat-hist'),
        statusTip: text('[data-testid="tip-chip"]'),
        statusTipState: document.querySelector('[data-testid="tip-chip"]')?.dataset.state ?? null,
        fill: !!document.querySelector('[data-testid="tip-chip"] .sb-prog'),
        nodes: text('[data-testid="nodes-total"] .sb-nodes'),
        tiers: !!document.querySelector('[data-testid="nodes-total"] .sb-tiers'),
      };
    });
  const live = await beat();
  assert.equal(live.tag, 'A', 'the live Beat is a link to the tip block');
  assert.ok(live.ring && live.light && !live.face, 'the live Beat runs its ring and the bar its light');
  assert.ok(live.fill, 'the status bar counts to the next block');

  // What the time machine's view writes to the document element while its handle is in the past
  // (features/chrome/archive.ts): the instant, and the tip and the node count it holds for it.
  // Four hours and half a minute ago, so the reading is four hours whatever second the clock is on.
  await page.evaluate(() => {
    const root = document.documentElement;
    root.setAttribute('data-archive-at', String(Date.now() - 4 * 3_600_000 - 30_000));
    root.setAttribute('data-archive-tip', '2998071');
    root.setAttribute('data-archive-nodes', '6726');
  });
  await page.waitForSelector('.topbar .beat[data-phase="archive"]', { timeout: 5_000 });
  const past = await beat();
  assert.equal(past.tag, 'SPAN', 'a readout, not a link: leaving for a block would end the archive view');
  assert.equal(past.tip, 'T\u22124 h 00 m');
  assert.equal(past.sub, 'block 2,998,071');
  assert.ok(past.face && !past.ring, 'a still ring with a clock face; nothing counts to a block');
  assert.ok(!past.light, "the bar's light rests");
  assert.equal(past.statusTipState, 'archive');
  assert.match(
    past.statusTip ?? '',
    /^tip\s*2,998,071\s*T\u22124 h 00 m$/,
    `the status bar's tip: ${past.statusTip}`,
  );
  assert.ok(!past.fill, 'no block timer in the status bar');
  assert.match(past.nodes ?? '', /^6,726 nodes/, `the node count: ${past.nodes}`);
  assert.ok(!past.tiers, 'the live tier split steps aside');
  const spoken = await page.locator('.topbar .beat .sr-only').textContent();
  assert.equal(spoken, 'Archive view, T minus 4 hours, block 2,998,071');

  // A recording that does not hold a reading says so; it never shows a zero.
  await page.evaluate(() => {
    document.documentElement.removeAttribute('data-archive-tip');
    document.documentElement.removeAttribute('data-archive-nodes');
  });
  await page.waitForFunction(
    () => document.querySelector('.topbar .beat-sub')?.textContent === 'block unknown',
    null,
    { timeout: 5_000 },
  );
  const unknown = await beat();
  assert.match(
    unknown.statusTip ?? '',
    /^tip\s*Unknown\s*T\u2212/,
    `the status bar's tip: ${unknown.statusTip}`,
  );
  assert.match(unknown.nodes ?? '', /^Unknown nodes/);

  // Return to live: the ring comes back, with one ping, and the status bar counts again.
  await page.evaluate(() => {
    for (const a of ['data-archive-at', 'data-archive-tip', 'data-archive-nodes'])
      document.documentElement.removeAttribute(a);
  });
  await page.waitForSelector('.topbar a.beat .beat-anim', { timeout: 5_000 });
  await page.waitForSelector('.topbar .beat-ping', { state: 'attached', timeout: 2_000 });
  const back = await beat();
  assert.equal(back.phase === 'archive', false);
  assert.ok(back.light && back.fill, 'the light and the fill are back');
  assert.equal(back.tiers, live.tiers, 'and the tier split with them');
  // The ring picks up where the block timer is, not where it stood when the archive began.
  const drift = await page.evaluate(() => {
    const clock = globalThis.__atlas.clock ?? null;
    const style = document.querySelector('.topbar .beat-anim')?.style.getPropertyValue('--since');
    const last = clock?.lastBlockInfo;
    return { style: Number(style), expect: last ? clock.now() - last.anchorMs : null };
  });
  if (drift.expect !== null)
    assert.ok(
      Math.abs(drift.style - drift.expect) < 1500,
      `the ring's offset ${drift.style} vs ${drift.expect}`,
    );
  await page.close();
  assert.deepEqual(pageErrors, []);
});

test('Off draws the block timer as steps: no animation runs, and the state moves once a second', {
  timeout: 120_000,
}, async () => {
  const page = await open('/');
  await page.waitForFunction(globeReady, null, { timeout: 60_000 });
  await page.waitForSelector('.topbar .beat-anim', { timeout: 30_000 });
  // The mode a page forces (the motion root takes it as the document's mode).
  await page.evaluate(() => document.documentElement.setAttribute('data-motion', 'off'));
  const timers = () =>
    page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === 'running')
        .map((a) => a.animationName ?? '')
        .filter((n) => /^(beat-(r|l|head|core)|topbar-light|sb-prog)$/.test(n)),
    );
  await page.waitForFunction(
    () =>
      document
        .getAnimations()
        .every((a) => !/^(beat-(r|l|head|core)|topbar-light|sb-prog)$/.test(a.animationName ?? '')),
    null,
    { timeout: 5_000 },
  );
  assert.deepEqual(await timers(), [], 'the ring, its head, the light and both fills run no animation');
  const drawn = () =>
    page.evaluate(() => {
      const turn = (sel) => {
        const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(document.querySelector(sel)).transform);
        if (!m) return null;
        const [a, b] = m[1].split(',').map(Number);
        return Math.round((Math.atan2(b, a) * 180) / Math.PI);
      };
      const scale = (sel) => {
        const m = /matrix\(([^)]+)\)/.exec(getComputedStyle(document.querySelector(sel)).transform);
        return m ? Math.round(Number(m[1].split(',')[0]) * 100) / 100 : null;
      };
      return {
        sec: Number(document.querySelector('.topbar .beat-anim').style.getPropertyValue('--sec')),
        head: turn('.topbar .beat-head'),
        fill: scale('[data-testid="tip-chip"] .sb-prog i'),
      };
    });
  // Sampled every 100 ms for 2.4 s, the drawn state takes only the values of whole seconds.
  const seen = [];
  for (let i = 0; i < 24; i++) {
    const s = await drawn();
    // A block can land mid-way and restart the interval: only compare within one.
    seen.push(s);
    await page.waitForTimeout(100);
  }
  for (const s of seen) {
    const headNow = ((s.sec * 12 + 180) % 360) - 180;
    assert.equal(s.head, headNow === -180 ? 180 : headNow, `the head stands at ${s.sec} s: ${s.head}`);
    assert.ok(
      Math.abs((s.fill ?? 0) - Math.min(30, s.sec) / 30) < 0.02,
      `the fill stands at ${s.sec} s: ${s.fill}`,
    );
  }
  const secs = new Set(seen.map((s) => s.sec));
  assert.ok(secs.size <= 4, `whole seconds only (${[...secs].join(', ')})`);
  await page.close();
  assert.deepEqual(pageErrors, []);
});

test("the moon parks in the phone header's Beat ring while a tall sheet covers its orbit", {
  timeout: 120_000,
}, async () => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(`phone: ${e.message}`));
  await page.goto(`${base}/settings?boot=off`, { waitUntil: 'load' });
  await page.waitForFunction(globeReady, null, { timeout: 60_000 });
  await page.waitForSelector('.wm-window[data-placement="sheet"]', { timeout: 20_000 });
  const read = () =>
    page.evaluate(() => {
      const m = window.__atlasGlobe.engine.moonState();
      const ring = document.querySelector('.phone-header .beat-ring').getBoundingClientRect();
      return {
        snap: document.querySelector('.wm-window[data-placement="sheet"]')?.dataset.snap,
        parked: document.querySelector('.phone-header').hasAttribute('data-parked'),
        door: document.querySelector('.ph-moon-door') !== null,
        proxy: document.querySelector('.globe-moon-proxy') !== null,
        away: Math.hypot(m.x - (ring.left + ring.width / 2), m.y - (ring.top + ring.height / 2)),
        size: m.s,
      };
    });

  // Half: the moon is on its orbit, the proxy is the moon's control, and there is no door.
  const half = await read();
  assert.equal(half.snap, 'half');
  assert.deepEqual([half.parked, half.door, half.proxy], [false, false, true]);
  assert.ok(half.away > 60, `the moon is out on its orbit (${half.away.toFixed(0)} px from the ring)`);

  // Tall: it glides into the ring as the 22 px symbol, and the door takes over from the proxy.
  await page.focus('.wm-grabber');
  await page.keyboard.press('ArrowUp');
  await page.waitForFunction(
    () => {
      const m = window.__atlasGlobe.engine.moonState();
      const r = document.querySelector('.phone-header .beat-ring').getBoundingClientRect();
      return Math.hypot(m.x - (r.left + r.width / 2), m.y - (r.top + r.height / 2)) < 1.5 && m.s < 23;
    },
    null,
    { timeout: 10_000 },
  );
  const tall = await read();
  assert.equal(tall.snap, 'tall');
  assert.deepEqual([tall.parked, tall.door, tall.proxy], [true, true, false]);

  // A tap on the moon opens About Flux in the sheet, and the sheet stays tall, so the moon stays put.
  await page.tap('.ph-moon-door');
  await page.waitForFunction(() => location.pathname === '/about', null, { timeout: 10_000 });
  // The sheet swaps Settings for About: wait until only About's is left before the keyboard goes to its grabber.
  await page.waitForFunction(
    () => {
      const sheets = document.querySelectorAll('.wm-window[data-placement="sheet"]');
      return sheets.length === 1 && /About Flux/.test(sheets[0].textContent ?? '');
    },
    null,
    { timeout: 10_000 },
  );
  assert.equal((await read()).parked, true);

  // Back to half: the moon leaves the ring for its orbit, and the proxy returns.
  await page.focus('.wm-grabber');
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(
    () => {
      const m = window.__atlasGlobe.engine.moonState();
      const r = document.querySelector('.phone-header .beat-ring').getBoundingClientRect();
      return Math.hypot(m.x - (r.left + r.width / 2), m.y - (r.top + r.height / 2)) > 60 && m.s > 30;
    },
    null,
    { timeout: 10_000 },
  );
  const back = await read();
  assert.equal(back.snap, 'half');
  assert.deepEqual([back.parked, back.door, back.proxy], [false, false, true]);
  await context.close();
  assert.deepEqual(pageErrors, []);
});

test('a lost WebGL context comes back with a fresh engine', { timeout: 120_000 }, async () => {
  const page = await open('/');
  await page.waitForFunction(globeReady, null, { timeout: 60_000 });
  assert.ok(await page.evaluate(() => window.__atlasGlobe.loseContext()), 'WEBGL_lose_context available');
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__atlasGlobe.restoreContext());
  await page.waitForFunction(
    () => window.__atlasGlobeStats?.generation === 1 && window.__atlasGlobeStats.ready,
    null,
    {
      timeout: 30_000,
    },
  );
  await page.waitForFunction(() => window.__atlasGlobeStats.nodes > 6_000, null, { timeout: 30_000 });
  assert.equal(await page.locator('canvas.globe-canvas').count(), 1);
  await page.close();
  assert.deepEqual(pageErrors, []);
});
