#!/usr/bin/env node
// What a window's power-on and power-off cost in frames, beside the real globe: the same clicks in Full and in Off
// (where nothing is drawn), so the difference is the effect and what the browser has to do for it (the aperture clip
// over the window's drop shadow, the surge, the ghost that plays the exit), not the app's own work to mount a window.
//
// Windows are opened from their dock launchers one after the other and closed with their close control. The page's
// requestAnimationFrame cadence is recorded all the time; the frames from 20 ms after a click to the end of the
// animation (500 ms for an open, 350 ms for a close) are the ones reported. The first frame after a click holds
// the page's own work (React mounting the window's content) and is left out of both modes alike.
//
// Works on the dev server and on a production build (`vite preview`): it drives the page with clicks and sets the
// motion preference through localStorage before the app starts, so it needs nothing from the app's modules. A
// production build is the number to trust: in the dev server React renders in development mode.
//
// usage: node src/motion/tools/window-cost.mjs [--base http://127.0.0.1:5381] [--dpr 1] [--cycles 4]
//          [--modes full,off] [--no-gpu]

// biome-ignore-all lint/suspicious/noConsole: a command line tool reports on stdout

import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const base = String(opt('base', 'http://127.0.0.1:5381'));
const dpr = Number(opt('dpr', 1));
const cycles = Number(opt('cycles', 4));
const modes = String(opt('modes', 'full,off')).split(',');
const gpu = !argv.includes('--no-gpu');
const windows = ['explorer', 'settings', 'terminal', 'about'];

const exe = process.env.CHROMIUM || ['/usr/bin/chromium', '/usr/bin/google-chrome-stable'].find(existsSync);
const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: gpu
    ? ['--enable-gpu', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist']
    : [],
});

const stats = (a) => {
  if (a.length === 0) return null;
  const s = [...a].sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  const mean = s.reduce((t, v) => t + v, 0) / s.length;
  return {
    frames: s.length,
    mean: +mean.toFixed(2),
    p50: +q(0.5).toFixed(2),
    p95: +q(0.95).toFixed(2),
    max: +s[s.length - 1].toFixed(2),
    over20: s.filter((v) => v > 20).length,
    over33: s.filter((v) => v > 33.4).length,
  };
};

for (const mode of modes) {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: dpr,
  });
  await context.addInitScript((m) => {
    try {
      localStorage.setItem(
        'atlas.ui.v1',
        JSON.stringify({ motion: m, perf: 'auto', globeArt: 'marble', watched: [] }),
      );
    } catch {
      // no storage: the app runs with its defaults
    }
  }, mode);
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  await page.goto(`${base}/`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__atlas?.store?.loaded === true, null, { timeout: 60000 });
  await page.waitForTimeout(6000);
  const fxMode = await page.evaluate(() => document.documentElement.dataset.fxMode ?? null);
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    const loop = (t) => {
      window.__frames.push({ t, d: t - last });
      last = t;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  const opens = [];
  const closes = [];
  const openMax = [];
  const closeMax = [];
  const slice = (t0, from, to) =>
    page.evaluate(
      ([t0, from, to]) => window.__frames.filter((f) => f.t >= t0 + from && f.t <= t0 + to).map((f) => f.d),
      [t0, from, to],
    );
  for (let c = 0; c < cycles; c++) {
    for (const id of windows) {
      await page.mouse.move(60, 400);
      const t0 = await page.evaluate(() => performance.now());
      await page.click(`[data-launcher="${id}"]`);
      await page.waitForSelector('.wm-window', { timeout: 5000 });
      await page.waitForTimeout(900);
      const o = await slice(t0, 20, 500);
      opens.push(...o);
      openMax.push(`${id[0]}${Math.round(Math.max(...o))}`);
      const t1 = await page.evaluate(() => performance.now());
      await page.click('.wm-window .wm-btn-close');
      await page.waitForTimeout(700);
      const k = await slice(t1, 20, 350);
      closes.push(...k);
      closeMax.push(`${id[0]}${Math.round(Math.max(...k))}`);
    }
  }
  console.log(
    `${mode.padEnd(8)} (data-fx-mode ${fxMode}, dpr ${dpr}, ${cycles * windows.length} opens and closes)`,
  );
  console.log(`  open    ${JSON.stringify(stats(opens))}`);
  console.log(`  close   ${JSON.stringify(stats(closes))}`);
  // the slowest frame of each open and close, in order (the window's first letter, then ms): a one-off shows where
  console.log(`  slowest frame per open:  ${openMax.join(' ')}`);
  console.log(`  slowest frame per close: ${closeMax.join(' ')}`);
  await context.close();
}
await browser.close();
