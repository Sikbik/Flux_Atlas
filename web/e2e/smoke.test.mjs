// End-to-end smoke test: starts the Rust demo server (fast 3 s blocks) and `vite preview`, loads
// the app in headless system Chromium, and asserts the WebSocket goes live and a block arrives.
//
//   npm run e2e
//
// Env: ATLAS_DEMO_BIN (a prebuilt demo_server binary; default `cargo run --example demo_server`),
// CARGO_TARGET_DIR (respected by cargo), CHROMIUM (browser path). Builds web/dist if missing.
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
  apiPort = await freePort();
  const webPort = await freePort();
  demo = startDemo();
  if (!existsSync(join(webDir, 'dist', 'index.html'))) {
    execSync('npm run build', { cwd: webDir, stdio: 'inherit', env });
  }
  preview = start(
    join(webDir, 'node_modules', '.bin', 'vite'),
    ['preview', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'],
    { cwd: webDir, env: { ...env, ATLAS_API_TARGET: `http://127.0.0.1:${apiPort}` } },
  );
  base = `http://127.0.0.1:${webPort}`;
  try {
    // The first run compiles the demo server.
    await waitHttp(`http://127.0.0.1:${apiPort}/healthz`, 600_000);
    await waitHttp(`${base}/`, 60_000);
  } catch (e) {
    console.error('demo server log:\n', demo.log.join(''));
    console.error('preview log:\n', preview.log.join(''));
    throw e;
  }
  const exe = process.env.CHROMIUM || ['/usr/bin/chromium', '/usr/bin/google-chrome-stable'].find(existsSync);
  browser = await chromium.launch({ executablePath: exe, headless: true });
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

test('the WebSocket goes live and a block arrives', { timeout: 90_000 }, async () => {
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
  await page.waitForFunction(
    () => Number(document.querySelector('[data-testid=live-blocks]')?.textContent ?? '0') >= 1,
    null,
    { timeout: 30_000 },
  );
  assert.ok((await intOf(page, 'last-block-height')) > before, 'the tip advanced');
  // The status line reads live too, and the runtime received block messages over the socket.
  assert.equal(await page.getByTestId('live-status').getAttribute('data-status'), 'live');
  const blocks = await page.evaluate(() => globalThis.__atlas.live.metrics().byType.block ?? 0);
  assert.ok(blocks >= 1, 'block messages received');
  await page.close();
  assert.deepEqual(pageErrors, []);
});

test('every IA route renders, and unknown routes 404', { timeout: 90_000 }, async () => {
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

test('a server restart is survived: reconnect, resync, live again', { timeout: 120_000 }, async () => {
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
