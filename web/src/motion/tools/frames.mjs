#!/usr/bin/env node
// Frame-sequence capture for the interaction language (run it against /dev/motion).
//
// Motion is judged as frames, not stills. Each scenario triggers a real interaction with real input
// (page.mouse, page.keyboard), freezes the Web Animations it started, then seeks them to chosen
// times and screenshots a clip at each one. The result is a deterministic filmstrip (no dependence
// on how fast the capture itself runs) and an ImageMagick contact sheet.
//
// usage: node src/motion/tools/frames.mjs [--base http://127.0.0.1:5380] [--out DIR] [--only a,b]
//          [--mode settings|full|reduced|off] [--dpr 3] [--list] [--no-gpu]
//
// Needs the dev server (see the README), playwright-core, a system Chromium and ImageMagick.

// biome-ignore-all lint/suspicious/noConsole: a command line tool reports on stdout

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const base = String(opt('base', 'http://127.0.0.1:5380'));
const out = String(opt('out', '/home/stache/.cache/flux-atlas/shots/m1/frames'));
const only = String(opt('only', '')).split(',').filter(Boolean);
const mode = String(opt('mode', 'full'));
const dpr = Number(opt('dpr', 3));
const gpu = !argv.includes('--no-gpu');

const range = (to, step) => Array.from({ length: Math.floor(to / step) + 1 }, (_, i) => i * step);
const sel = (id, testid) => `[data-testid="frame-${id}-${mode}"] [data-testid="${testid}"]`;
const frameSel = (id) => `[data-testid="frame-${id}-${mode}"]`;

/** Presses with the real mouse at a fraction of the target, and holds. */
const press =
  (fx = 0.3, fy = 0.5) =>
  async (page, box) => {
    await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
    await page.waitForTimeout(350);
  };
const down = async (page) => page.mouse.down();

const scenarios = [
  {
    name: 'pulse-primary',
    note: 'press the chamfered primary button (white light on Blue Wave), held',
    target: sel('press', 'btn-primary'),
    pad: 14,
    times: range(260, 20),
    cols: 5,
    pre: press(0.28),
    act: down,
    release: (page) => page.mouse.up(),
  },
  {
    name: 'pulse-secondary',
    note: 'press the secondary button near its right end',
    target: sel('press', 'btn-secondary'),
    pad: 14,
    times: range(260, 20),
    cols: 5,
    pre: press(0.78, 0.4),
    act: down,
    release: (page) => page.mouse.up(),
  },
  {
    name: 'pulse-icon',
    note: 'press a 32 px icon button',
    target: sel('press', 'btn-icon'),
    pad: 16,
    times: range(240, 20),
    cols: 5,
    pre: press(0.5, 0.5),
    act: down,
    release: (page) => page.mouse.up(),
  },
  {
    name: 'pulse-chip',
    note: 'press a pill chip',
    target: sel('press', 'btn-chip'),
    pad: 14,
    times: range(240, 20),
    cols: 5,
    pre: press(0.3, 0.5),
    act: down,
    release: (page) => page.mouse.up(),
  },
  {
    name: 'pulse-key',
    note: 'keyboard: focus the secondary button, press Enter (light starts at the top centre)',
    target: sel('press', 'btn-secondary'),
    pad: 14,
    times: range(260, 20),
    cols: 5,
    pre: async (page) => {
      await page.keyboard.press('Tab');
      await page.locator(sel('press', 'btn-secondary')).focus();
      await page.waitForTimeout(350);
    },
    act: (page) => page.keyboard.down('Enter'),
    release: (page) => page.keyboard.up('Enter'),
  },
  {
    name: 'spark-switch',
    note: 'switch turns on: the head lands on the knob after it slides',
    target: sel('spark', 'switch'),
    pad: 22,
    times: range(560, 40),
    cols: 5,
    pre: async (page, box) => {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(350);
    },
    act: async (page) => {
      await page.mouse.down();
      await page.mouse.up();
    },
  },
  {
    name: 'spark-watch',
    note: 'watch toggled on',
    target: sel('spark', 'watch'),
    pad: 18,
    times: range(440, 40),
    cols: 5,
    pre: async (page, box) => {
      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
      await page.waitForTimeout(350);
    },
    act: async (page) => {
      await page.mouse.down();
      await page.mouse.up();
    },
  },
  {
    name: 'spark-copy',
    note: 'copy commits: the head lands on the icon',
    target: sel('spark', 'copy'),
    pad: 18,
    times: range(480, 40),
    cols: 5,
    pre: async (page, box) => {
      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
      await page.waitForTimeout(350);
    },
    act: async (page) => {
      await page.mouse.down();
      await page.mouse.up();
    },
  },
  {
    name: 'tabs-slide',
    note: 'select the last tab: the line stretches to it and relaxes',
    target: sel('tabs', 'tabs'),
    pad: 8,
    times: range(480, 40),
    cols: 2,
    tile: 900,
    pre: async (page) => {
      const t = await page.locator(sel('tabs', 'tab-3')).boundingBox();
      await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
      await page.waitForTimeout(350);
    },
    act: async (page) => {
      await page.mouse.down();
      await page.mouse.up();
    },
  },
  {
    name: 'settle-values',
    note: 'update values: changed numbers land with a glow',
    target: sel('list', 'list'),
    pad: 6,
    times: [0, 60, 120, 240, 400, 640, 900],
    cols: 2,
    dpr: 2,
    tile: 760,
    pre: async (page) => {
      const t = await page.locator(sel('list', 'row-tick')).boundingBox();
      await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
      await page.waitForTimeout(350);
    },
    act: async (page) => {
      await page.mouse.down();
      await page.mouse.up();
    },
  },
  {
    name: 'fresh-row',
    note: 'a new row arrives: a white wash and an edge bar decay',
    target: sel('list', 'list'),
    pad: 6,
    times: [0, 120, 400, 800, 1200, 1600],
    cols: 3,
    dpr: 2,
    tile: 640,
    pre: async (page) => {
      const t = await page.locator(sel('list', 'row-add')).boundingBox();
      await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
      await page.waitForTimeout(350);
    },
    act: async (page) => {
      await page.mouse.down();
      await page.mouse.up();
    },
  },
  {
    name: 'window-open',
    note: 'a dock launcher opens the window: it comes up out of the launcher, light crosses it',
    target: `${frameSel('window')} [data-testid="stage"]`,
    pad: 0,
    times: range(560, 40),
    cols: 4,
    dpr: 2,
    tile: 560,
    pre: async (page) => {
      const t = await page.locator(sel('window', 'launch')).boundingBox();
      await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
      await page.waitForTimeout(350);
    },
    act: async (page) => {
      await page.mouse.down();
      await page.mouse.up();
    },
  },
  {
    name: 'window-close',
    note: 'closing is faster and returns to the launcher',
    target: `${frameSel('window')} [data-testid="stage"]`,
    pad: 0,
    times: range(200, 25),
    cols: 3,
    dpr: 2,
    tile: 560,
    setup: async (page) => {
      await page.locator(sel('window', 'launch')).click();
      await page.waitForTimeout(900);
    },
    pre: async (page) => {
      const t = await page.locator(sel('window', 'launch')).boundingBox();
      await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
      await page.waitForTimeout(350);
    },
    act: async (page) => {
      await page.mouse.down();
      await page.mouse.up();
    },
  },
  {
    name: 'toast',
    note: 'a toast arrives: quick scale and fade, one comet along its top edge',
    target: `${frameSel('window')} [data-testid="stage"]`,
    pad: 0,
    times: range(440, 40),
    cols: 4,
    dpr: 2,
    tile: 560,
    pre: async (page) => {
      const t = await page.locator(sel('window', 'toast-btn')).boundingBox();
      await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
      await page.waitForTimeout(350);
    },
    act: async (page) => {
      await page.mouse.down();
      await page.mouse.up();
    },
  },
  {
    name: 'block-arrives',
    note: 'a block lands: a streak along the rail, the new card circled once, the number glows',
    target: frameSel('live'),
    pad: 0,
    times: [0, 60, 120, 200, 300, 420, 560, 700, 860, 1000],
    cols: 3,
    dpr: 2,
    tile: 640,
    pre: async (page) => {
      const t = await page.locator(sel('live', 'fire')).boundingBox();
      await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
      await page.waitForTimeout(350);
    },
    act: async (page) => {
      await page.mouse.down();
      await page.mouse.up();
    },
  },
];

if (argv.includes('--list')) {
  for (const s of scenarios) console.log(`${s.name.padEnd(18)} ${s.note}`);
  process.exit(0);
}

const exe = process.env.CHROMIUM || ['/usr/bin/chromium', '/usr/bin/google-chrome-stable'].find(existsSync);
const glArgs = gpu
  ? ['--enable-gpu', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ executablePath: exe, headless: true, args: glArgs });

async function open(scale) {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: scale,
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[console.error] ${m.text()}`);
  });
  await page.goto(`${base}/dev/motion`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('[data-testid="motion-gallery"]', { timeout: 60000 });
  await page.waitForTimeout(2500); // the runners load on idle; the globe settles
  if (mode !== 'settings') await page.click(`[data-testid="mode-${mode}"]`);
  await page.waitForTimeout(300);
  return { context, page };
}

mkdirSync(out, { recursive: true });
for (const sc of scenarios) {
  if (only.length && !only.includes(sc.name)) continue;
  const { context, page } = await open(sc.dpr ?? dpr);
  const dir = join(out, `${sc.name}-${mode}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  try {
    const target = page.locator(sc.target);
    await target.scrollIntoViewIfNeeded();
    await sc.setup?.(page);
    await target.scrollIntoViewIfNeeded();
    let box = await target.boundingBox();
    if (!box) throw new Error(`no box for ${sc.target}`);
    await sc.pre?.(page, box);
    box = await target.boundingBox();
    const pad = sc.pad ?? 12;
    const clip = {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: Math.min(1600, box.width + pad * 2),
      height: Math.min(900, box.height + pad * 2),
    };
    // Freeze: remember what already animates, neutralise the watchdog timers, act, then take over
    // every animation the interaction started.
    await page.evaluate(() => {
      window.__fxBefore = new Set(document.getAnimations());
      window.__st = window.setTimeout;
      window.setTimeout = (fn, ms, ...a) => (ms >= 100 && ms <= 1500 ? 0 : window.__st(fn, ms, ...a));
    });
    await sc.act(page);
    await page.waitForTimeout(40);
    const n = await page.evaluate(() => {
      window.__fxFresh = document.getAnimations().filter((a) => !window.__fxBefore.has(a));
      for (const a of window.__fxFresh) a.pause();
      return window.__fxFresh.length;
    });
    const files = [];
    for (const t of sc.times) {
      await page.evaluate((time) => {
        for (const a of window.__fxFresh) a.currentTime = time;
      }, t);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const f = join(dir, `t${String(t).padStart(4, '0')}.png`);
      await page.screenshot({ path: f, clip });
      files.push(f);
    }
    await page.evaluate(() => {
      window.setTimeout = window.__st;
      for (const a of window.__fxFresh) a.cancel();
    });
    await sc.release?.(page);
    const sheet = join(out, `${sc.name}-${mode}.png`);
    const tile = sc.tile ?? Math.min(Math.round(clip.width * (sc.dpr ?? dpr)), 520);
    execFileSync('montage', [
      ...files.flatMap((f, i) => ['-label', `${sc.times[i]} ms`, f]),
      '-tile',
      `${sc.cols ?? 5}x`,
      '-geometry',
      `${tile}x+6+6`,
      '-background',
      '#05070a',
      '-fill',
      '#9aa4b6',
      '-pointsize',
      '14',
      sheet,
    ]);
    console.log(`[frames] ${sc.name} (${mode}): ${n} animations, ${files.length} frames -> ${sheet}`);
  } catch (e) {
    console.log(`[frames] ${sc.name} FAILED: ${e.message}`);
  }
  await context.close();
}
await browser.close();
