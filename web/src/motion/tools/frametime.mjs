#!/usr/bin/env node
// Real-time frame time with the globe running: at rest, then with effects firing for a while, then at rest again.
//
//   default  /dev/motion: presses, switches, window opens and closes, simulated blocks.
//   --app    the live app at `/`: windows opened from the dock and closed again, toasts, blocks landing on the
//            rail (a block is injected into the store), the command palette opening and closing, and presses
//            and switches in the Settings window. Run it beside the real globe and the real feed.
//
// The page's requestAnimationFrame cadence is the measure: a steady 60 fps shows as a mean near
// 16.7 ms and nothing over 25 ms. Every frame over 25 ms is also attributed, from the browser's
// long-animation-frame entries, to the script that held it: `socket` is the app's live WebSocket
// handler (`onmessage`: the globe's mesh update, which freezes the page for 1 to 2 s about every 12 s
// whatever the page is doing), `other` is any other script, `unattributed` is a frame over 25 ms with no
// script behind it (the compositor or the GPU). Effects are clean when `other` and `unattributed`
// stay at 0. It reports; it does not judge.
//
// usage: node src/motion/tools/frametime.mjs [--app] [--base http://127.0.0.1:5380] [--dpr 1] [--seconds 8]
//          [--no-gpu] [--detail]
//
// --detail lists every long frame that is not the socket's, with the scripts that ran in it (the file and function,
// how long, how much forced style and layout), so a frame over 50 ms can be given to the code that held it.
//
// Needs a server on --base (the dev server, or `vite preview` on a production build: the toast step is skipped
// there, because it imports an app module), playwright-core and a system Chromium.

// biome-ignore-all lint/suspicious/noConsole: a command line tool reports on stdout

import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const base = String(opt('base', 'http://127.0.0.1:5380'));
const dpr = Number(opt('dpr', 1));
const seconds = Number(opt('seconds', 8));
const gpu = !argv.includes('--no-gpu');
const app = argv.includes('--app');

const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  headless: true,
  args: gpu
    ? ['--enable-gpu', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist']
    : [],
});
const page = await (
  await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: dpr })
).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
if (app) {
  await page.goto(`${base}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__atlas?.store?.loaded === true, null, { timeout: 60000 });
  await page.waitForTimeout(5000);
  // The app's modules are importable on the dev server only; a production build runs with the system preference.
  await page
    .evaluate(async () => {
      const { useUi } = await import('/src/store/ui.ts');
      useUi.getState().setMotion('full');
    })
    .catch(() => console.log('(a production build: the motion preference is left as it is)'));
} else {
  await page.goto(`${base}/dev/motion`, { waitUntil: 'load' });
  await page.waitForSelector('[data-testid="motion-gallery"]');
  await page.waitForTimeout(4000);
  await page.click('[data-testid="mode-full"]');
}
await page.waitForTimeout(500);

await page.evaluate(() => {
  window.__ft = [];
  window.__long = { socket: 0, other: 0 };
  window.__longOther = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const socket = (e.scripts ?? []).some((s) => /onmessage/i.test(s.invoker ?? ''));
        window.__long[socket ? 'socket' : 'other']++;
        if (!socket) {
          // what held the frame: the scripts that ran in it, longest first, and how much of it was style and layout
          window.__longOther.push({
            ms: Math.round(e.duration),
            render: Math.round(e.startTime + e.duration - (e.renderStart || e.startTime + e.duration)),
            style: Math.round(e.startTime + e.duration - (e.styleAndLayoutStart || e.startTime + e.duration)),
            scripts: (e.scripts ?? [])
              .map((s) => ({
                ms: Math.round(s.duration),
                invoker: (s.invoker ?? '').slice(0, 60),
                file: (s.sourceURL ?? '').replace(/^.*\/(src|node_modules)\//, '$1/').slice(0, 70),
                fn: s.sourceFunctionName ?? '',
                forced: Math.round(s.forcedStyleAndLayoutDuration ?? 0),
              }))
              .sort((a, b) => b.ms - a.ms)
              .slice(0, 3),
          });
        }
      }
    }).observe({ entryTypes: ['long-animation-frame'] });
  } catch {
    // a browser without the long-animation-frame API: every long frame then counts as unattributed
  }
  let last = performance.now();
  const loop = (t) => {
    window.__ft.push(t - last);
    last = t;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});

const summarize = async (label) => {
  const r = await page.evaluate(() => {
    const a = window.__ft.slice(5).sort((x, y) => x - y);
    const q = (p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
    const mean = a.reduce((s, v) => s + v, 0) / a.length;
    const over25 = a.filter((v) => v > 25).length;
    const { socket, other } = window.__long;
    const out = {
      frames: a.length,
      mean: +mean.toFixed(2),
      p50: +q(0.5).toFixed(2),
      p95: +q(0.95).toFixed(2),
      p99: +q(0.99).toFixed(2),
      max: +a[a.length - 1].toFixed(2),
      over25,
      socket,
      other,
      unattributed: Math.max(0, over25 - socket - other),
    };
    window.__ft = [];
    window.__long = { socket: 0, other: 0 };
    out.detail = window.__longOther;
    window.__longOther = [];
    return out;
  });
  const { detail, ...numbers } = r;
  console.log(label.padEnd(8), JSON.stringify(numbers));
  if (argv.includes('--detail')) {
    for (const d of detail)
      console.log(
        `  long frame ${d.ms} ms (after render ${d.render}, style ${d.style}): ${JSON.stringify(d.scripts)}`,
      );
  }
};

console.log(
  `${app ? 'live app' : '/dev/motion'}, dpr ${dpr}, ${seconds} s of activity, GPU ${gpu ? 'on' : 'off'}`,
);
await page.waitForTimeout(4000);
await summarize('idle');

// ---- what happens while it is active ---------------------------------------------------------------------------

/** One step of the live app's mix: a person and the network, together. */
const appSteps = [
  (n) => page.click('[data-launcher="explorer"]').then(() => n),
  () => page.click('.wm-window .wm-btn-close').catch(() => {}),
  () =>
    page
      .evaluate(async () => {
        const { toast } = await import('/src/app/toasts.ts');
        toast({ kind: 'info', title: 'A toast', body: 'Something the network did.' });
      })
      .catch(() => {}), // no toast on a production build: its module cannot be imported
  () =>
    page.evaluate(() => {
      const s = window.__atlas.store;
      const tip = s.blocks.newest();
      const height = (tip?.height ?? 2_998_000) + 1;
      const hex = (n) => n.toString(16).padStart(64, '0');
      s.apply({
        t: 'block',
        seq: (s.seq ?? 0) + 1,
        observed_ms: Date.now(),
        height,
        hash: hex(height ^ 0x3c3c3c),
        prev_hash: tip?.hash ?? hex(height - 1),
        time_ms: Date.now(),
        size: 3100,
        tx_count: 12,
        producer: null,
        payouts: [],
        heartbeats: [],
        confirms: [],
        starts: [],
        updates: [],
        transfers_over_threshold: [],
        reward: '14.00000000',
        fees: '0.00010000',
        dev_fund: '0.50010000',
        app_payments: [],
        collateral_spent: [],
      });
    }),
  async () => {
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(260);
    await page.keyboard.press('Escape');
  },
  async () => {
    await page.click('[data-launcher="settings"]');
    await page.waitForTimeout(300);
    await page.locator('.wm-window .ui-switch').first().click({ delay: 40 });
    // not 'Try ambient mode' (data-fx="off"): it would hide the chrome the next steps click
    await page
      .locator('.wm-window .ui-button:not([data-fx="off"])')
      .first()
      .click({ delay: 40, timeout: 1500 })
      .catch(() => {}); // Allow: gone once the permission was asked
  },
  () => page.click('.wm-window .wm-btn-close').catch(() => {}),
];

const started = Date.now();
let n = 0;
if (app) {
  while (Date.now() - started < seconds * 1000) {
    await appSteps[n % appSteps.length](n);
    await page.waitForTimeout(160);
    n++;
  }
} else {
  const press = ['btn-primary', 'btn-secondary', 'btn-icon', 'btn-ghost'].map(
    (id) => `[data-testid="frame-press-full"] [data-testid="${id}"]`,
  );
  while (Date.now() - started < seconds * 1000) {
    await page.locator(press[n % press.length]).click({ delay: 60 });
    if (n % 4 === 1) await page.locator('[data-testid="frame-spark-full"] .ui-switch').click();
    if (n % 4 === 2) await page.locator('[data-testid="frame-window-full"] [data-testid="launch"]').click();
    if (n % 4 === 3) await page.locator('[data-testid="frame-live-full"] [data-testid="fire"]').click();
    await page.waitForTimeout(120);
    n++;
  }
}
await summarize('active');
await page.waitForTimeout(3000);
await summarize('idle');
console.log(`interactions ${n}`);
await browser.close();
