#!/usr/bin/env node
// Real-time frame time of /dev/motion with the globe running: at rest, then with effects firing
// (presses, switches, window opens and closes, simulated blocks) for a while, then at rest again.
//
// The page's requestAnimationFrame cadence is the measure: a steady 60 fps shows as a mean near
// 16.7 ms and nothing over 25 ms. Every frame over 25 ms is also attributed, from the browser's
// long-animation-frame entries, to the script that held it: `socket` is the app's live WebSocket
// handler (`onmessage`: the globe's mesh update, which freezes the page for 1 to 2 s about every 12 s
// whatever the page is doing), `other` is any other script, `unattributed` is a frame over 25 ms with no
// script behind it (the compositor or the GPU). Effects are clean when `other` and `unattributed`
// stay at 0. It reports; it does not judge.
//
// usage: node src/motion/tools/frametime.mjs [--base http://127.0.0.1:5380] [--dpr 1] [--seconds 8] [--no-gpu]
//
// Needs the dev server (see the README), playwright-core and a system Chromium.

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
await page.goto(`${base}/dev/motion`, { waitUntil: 'load' });
await page.waitForSelector('[data-testid="motion-gallery"]');
await page.waitForTimeout(4000);
await page.click('[data-testid="mode-full"]');
await page.waitForTimeout(500);

await page.evaluate(() => {
  window.__ft = [];
  window.__long = { socket: 0, other: 0 };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const socket = (e.scripts ?? []).some((s) => /onmessage/i.test(s.invoker ?? ''));
        window.__long[socket ? 'socket' : 'other']++;
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
    return out;
  });
  console.log(label.padEnd(8), JSON.stringify(r));
};

console.log(`dpr ${dpr}, ${seconds} s of activity, GPU ${gpu ? 'on' : 'off'}`);
await page.waitForTimeout(4000);
await summarize('idle');

const press = ['btn-primary', 'btn-secondary', 'btn-icon', 'btn-ghost'].map(
  (id) => `[data-testid="frame-press-full"] [data-testid="${id}"]`,
);
const started = Date.now();
let n = 0;
while (Date.now() - started < seconds * 1000) {
  await page.locator(press[n % press.length]).click({ delay: 60 });
  if (n % 4 === 1) await page.locator('[data-testid="frame-spark-full"] .ui-switch').click();
  if (n % 4 === 2) await page.locator('[data-testid="frame-window-full"] [data-testid="launch"]').click();
  if (n % 4 === 3) await page.locator('[data-testid="frame-live-full"] [data-testid="fire"]').click();
  await page.waitForTimeout(120);
  n++;
}
await summarize('active');
await page.waitForTimeout(3000);
await summarize('idle');
console.log(`interactions ${n}`);
await browser.close();
