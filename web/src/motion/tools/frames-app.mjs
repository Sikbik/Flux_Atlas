#!/usr/bin/env node
// Frame-sequence capture for the interaction language on the LIVE app (frames.mjs does the gallery).
//
// Each scenario drives the real app with real input, holds every Web Animation the interaction starts at its
// first frame (the page's `Element.prototype.animate` is wrapped for the duration, and CSS animations that
// started are swept up after the act), then seeks them all to chosen times and screenshots a clip at each one.
// The filmstrip is deterministic whatever the speed of the capture, and a contact sheet is made with
// ImageMagick. The globe and the feed keep running behind it in real time.
//
// usage: node src/motion/tools/frames-app.mjs [--base http://127.0.0.1:5380] [--out DIR] [--only a,b]
//          [--mode full,reduced,off] [--dpr 2] [--list] [--no-gpu] [--debug]
//
// Needs the dev server proxied to a backend (see ../README.md), playwright-core, a system Chromium and
// ImageMagick. A block is injected into the store (window.__atlas.store.apply) so a landing is on demand;
// the toast comes from the app's own `toast()`.

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
const out = String(opt('out', '/home/stache/.cache/flux-atlas/shots/m1/app'));
const only = String(opt('only', '')).split(',').filter(Boolean);
const modes = String(opt('mode', 'full')).split(',').filter(Boolean);
const dprOpt = Number(opt('dpr', 2));
const gpu = !argv.includes('--no-gpu');
const debug = argv.includes('--debug');

const range = (to, step) => Array.from({ length: Math.floor(to / step) + 1 }, (_, i) => i * step);

const DESKTOP = { width: 1600, height: 900 };
const PHONE = { width: 390, height: 844 };

// ---- in-page helpers (serialised into the page) ---------------------------------------------------------------

/**
 * Every Web Animation created from now on starts paused at its first frame and is kept to be seeked. The page's
 * timers of 60 to 3000 ms (the runs' watchdogs, the views' clocks) are held too: with `clock` they are kept and
 * run at their time as the film is seeked (see `seek`); without, they never fire.
 */
function arm(clock) {
  if (!window.__fxAnimate) {
    window.__fxAnimate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const a = window.__fxAnimate.apply(this, args);
      if (window.__fxArmed) {
        a.pause();
        window.__fxHeld.push(a);
      }
      return a;
    };
  }
  window.__fxHeld = [];
  window.__fxBefore = new Set(document.getAnimations());
  window.__fxArmed = true;
  window.__fxClock = !!clock;
  window.__fxTimers = [];
  window.__fxNow = 0;
  // The runs end by their own watchdog timers and the views by theirs: hold the ones that would fire mid-capture.
  window.__fxSetTimeout = window.setTimeout;
  window.setTimeout = (fn, ms, ...rest) => {
    if (typeof ms !== 'number' || ms < 60 || ms > 3000) return window.__fxSetTimeout(fn, ms, ...rest);
    if (window.__fxClock && typeof fn === 'function') {
      window.__fxTimers.push({ at: window.__fxNow + ms, run: () => fn(...rest), done: false });
    }
    return 0;
  };
}

/** After the act: stop creating, and take over the CSS animations and transitions the act started. */
function settle() {
  window.__fxArmed = false;
  for (const a of document.getAnimations()) {
    if (!window.__fxBefore.has(a) && !window.__fxHeld.includes(a)) {
      a.pause();
      window.__fxHeld.push(a);
    }
  }
  return window.__fxHeld.length;
}

/**
 * Moves the film to `ms`. Every held animation is put at its own time (an animation a timer started begins when that
 * timer was due). A scenario that asked for the clock also lets the animations that reached their end finish, so the
 * run that owns them ends and gives its share of the effect budget back as it does when the page runs by itself,
 * and runs the page's timers that are due in their order: a row that waits for the block's light to end before its
 * own (data-fx-delay) lights up at that moment, and finds the budget free.
 */
async function seek(ms) {
  const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const at = (a) => Math.max(0, ms - (a.__fxStart ?? 0));
  const place = (list) => {
    for (const a of list) {
      if (a.playState === 'finished') continue;
      const end = window.__fxClock
        ? (a.effect?.getComputedTiming?.().endTime ?? Number.POSITIVE_INFINITY)
        : Number.POSITIVE_INFINITY;
      if (Number.isFinite(end) && at(a) >= end) a.finish();
      else a.currentTime = at(a);
    }
  };
  window.__fxNow = ms;
  place(window.__fxHeld);
  await frames();
  while (window.__fxClock) {
    const due = window.__fxTimers.filter((t) => !t.done && t.at <= ms).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    due.done = true;
    window.__fxNow = due.at;
    window.__fxArmed = true;
    const from = window.__fxHeld.length;
    due.run();
    window.__fxArmed = false;
    window.__fxNow = ms;
    const started = window.__fxHeld.slice(from);
    for (const a of started) a.__fxStart = due.at;
    place(started);
    await frames();
  }
}

/** What is being held, for --debug: the kind, the property or name, and where it runs. */
function describe() {
  const name = (el) =>
    el
      ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${[...(el.classList ?? [])]
          .slice(0, 2)
          .map((c) => `.${c}`)
          .join('')}`
      : '?';
  return window.__fxHeld.map((a) => {
    const t = a.effect?.target;
    const kind = a.constructor.name;
    const what = a.animationName ?? a.transitionProperty ?? '';
    return `${kind} ${what} on ${name(t)}${a.effect?.pseudoElement ? a.effect.pseudoElement : ''} (${Math.round(a.effect?.getTiming?.().duration ?? 0)} ms)`;
  });
}

function release() {
  window.setTimeout = window.__fxSetTimeout;
  for (const a of window.__fxHeld) a.cancel();
  window.__fxHeld = [];
}

// ---- scenarios ------------------------------------------------------------------------------------------------

const center = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const rectOf = (page, selector) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, selector);
const union = (rects, pad, view) => {
  const rs = rects.filter(Boolean);
  const x0 = Math.max(0, Math.min(...rs.map((r) => r.x)) - pad);
  const y0 = Math.max(0, Math.min(...rs.map((r) => r.y)) - pad);
  const x1 = Math.min(view.width, Math.max(...rs.map((r) => r.x + r.width)) + pad);
  const y1 = Math.min(view.height, Math.max(...rs.map((r) => r.y + r.height)) + pad);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
};
/** Geometry a window will have at the end of its opening (inline style, not affected by the entrance transform). */
const windowBox = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.wm-window');
    if (!el) return null;
    return {
      x: Number.parseFloat(el.style.left),
      y: Number.parseFloat(el.style.top),
      width: Number.parseFloat(el.style.width),
      height: Number.parseFloat(el.style.height),
    };
  });

const hoverCenter = async (page, selector) => {
  const r = await rectOf(page, selector);
  if (!r) throw new Error(`no box for ${selector}`);
  const c = center(r);
  await page.mouse.move(c.x, c.y);
  await page.waitForTimeout(350);
  return c;
};
const clickAt = async (page, c) => {
  await page.mouse.down();
  await page.mouse.up();
  return c;
};
const tapCenter = async (page, selector) => {
  const r = await rectOf(page, selector);
  if (!r) throw new Error(`no box for ${selector}`);
  const c = center(r);
  await page.touchscreen.tap(c.x, c.y);
};

/**
 * An injected block: the next height and a hash of its own. With no `watch` it has no payees (a quiet landing: the
 * rail and the tip are all that move); with one, the first node of the table is watched and paid, so the Pulse
 * gets a P1 row (a payment to a watched node).
 */
const injectBlock = async (watch = false) => {
  const s = window.__atlas.store;
  const payouts = [];
  if (watch) {
    const id = s.nodes.ids[0];
    (await import('/src/store/ui.ts')).useUi.getState().watch(id);
    payouts.push({ tier: 'cumulus', node: id, address: 't1watched', amount: '1.00000000' });
  }
  const tip = s.blocks.newest();
  const height = (tip?.height ?? 2_998_000) + 1;
  const hex = (n) => n.toString(16).padStart(64, '0');
  s.apply({
    t: 'block',
    seq: (s.seq ?? 0) + 1,
    observed_ms: Date.now(),
    height,
    hash: hex(height ^ 0x5a5a5a),
    prev_hash: tip?.hash ?? hex(height - 1),
    time_ms: Date.now(),
    size: 3100,
    tx_count: 12,
    producer: null,
    payouts,
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
};

const pushToast = (spec) => import('/src/app/toasts.ts').then((m) => m.toast(spec));

let closing = null; // the window the close scenario is about to close

const scenarios = [
  {
    name: 'window-open',
    note: 'desktop: the Explorer launcher opens the Explorer landing, out of the launcher',
    view: DESKTOP,
    times: range(560, 40),
    cols: 4,
    tile: 760,
    pre: (page) => hoverCenter(page, '[data-launcher="explorer"]'),
    act: (page, c) => clickAt(page, c),
    waitFor: '.wm-window',
    clip: async (page, view) =>
      union([await windowBox(page), await rectOf(page, '[data-launcher="explorer"]')], 24, view),
  },
  {
    name: 'window-close',
    note: 'desktop: the close control; the circle closes back into the launcher in 180 ms',
    view: DESKTOP,
    times: range(200, 25),
    cols: 3,
    tile: 760,
    setup: async (page) => {
      await page.click('[data-launcher="explorer"]');
      await page.waitForSelector('.wm-window');
      await page.waitForTimeout(1100);
    },
    pre: async (page) => {
      closing = await windowBox(page); // where the window was, for a mode that leaves no ghost to measure
      return hoverCenter(page, '.wm-window .wm-btn-close');
    },
    act: (page, c) => clickAt(page, c),
    waitFor: '.wm-ghost',
    ghost: true,
    clip: async (page, view) =>
      union(
        [(await rectOf(page, '.wm-ghost')) ?? closing, await rectOf(page, '[data-launcher="explorer"]')],
        24,
        view,
      ),
  },
  {
    name: 'toast',
    note: 'a toast: quick scale and fade, one comet along its top edge',
    view: DESKTOP,
    times: range(440, 40),
    cols: 4,
    tile: 640,
    pre: async () => {},
    act: (page) =>
      page.evaluate(pushToast, {
        kind: 'success',
        title: 'Settings saved',
        body: 'Your choices apply at once and stay in this browser.',
      }),
    waitFor: '.toast',
    clip: async (page, view) => union([await rectOf(page, '.toasts')], 28, view),
  },
  {
    name: 'block',
    note: 'a block lands: one streak along the rail, the new card circled once, the tip settling',
    view: DESKTOP,
    times: [0, 60, 120, 200, 300, 420, 560, 700, 860, 1000],
    cols: 2,
    tile: 1500,
    pre: async () => {},
    act: (page) => page.evaluate(injectBlock, false),
    waitFor: '.blk-item[data-fresh]',
    clip: async (page, view) =>
      union([await rectOf(page, '.railwrap'), await rectOf(page, '.statusbar')], 0, view),
  },
  {
    name: 'pulse-p1',
    note: 'a payment to a watched node: its row in the Pulse waits for the block light to end, then one streak runs along its top edge, drawn inside the row',
    view: DESKTOP,
    clock: true,
    times: [0, 200, 600, 1000, 1100, 1160, 1230, 1320, 1430, 1550, 1650, 1800],
    cols: 3,
    tile: 700,
    pre: async () => {},
    act: (page) => page.evaluate(injectBlock, true),
    waitFor: '.evt[data-kind="paid_mine"][data-fresh]',
    clip: async (page, view) => union([await rectOf(page, '.pulse')], 12, view),
  },
  {
    name: 'palette',
    note: 'the command palette: panel power-on, the kind chips and their line',
    view: DESKTOP,
    times: range(420, 40),
    cols: 4,
    tile: 760,
    pre: async () => {},
    act: (page) => page.keyboard.press('Control+k'),
    waitFor: '.pal-slot',
    clip: async (page, view) => union([await rectOf(page, '.pal-slot')], 30, view),
  },
  {
    name: 'palette-kind',
    note: 'the command palette: Tab moves the chosen kind chip, and the line under the chips stretches to it',
    view: DESKTOP,
    times: range(480, 40),
    cols: 3,
    tile: 880,
    setup: async (page) => {
      await page.keyboard.press('Control+k');
      await page.waitForSelector('.pal-kinds');
      await page.waitForTimeout(900);
    },
    pre: async () => {},
    act: (page) => page.keyboard.press('Tab'),
    waitFor: '.pal-kind:nth-child(2)[data-selected]',
    clip: async (page, view) => union([await rectOf(page, '.pal-kinds')], 22, view),
  },
  {
    name: 'phone-tab',
    note: 'phone: a tap on a tab moves the line to it',
    view: PHONE,
    phone: true,
    times: range(480, 40),
    cols: 3,
    tile: 560,
    pre: async () => {},
    act: (page) => tapCenter(page, '.shell-tab[data-tab="live"]'),
    waitFor: '.wm-window',
    clip: async (page, view) => union([await rectOf(page, '.shell-tabs')], 10, view),
  },
  {
    name: 'phone-sheet-open',
    note: 'phone: the Live sheet comes up out of the tab bar',
    view: PHONE,
    phone: true,
    times: range(480, 40),
    cols: 4,
    tile: 380,
    pre: async () => {},
    act: (page) => tapCenter(page, '.shell-tab[data-tab="live"]'),
    waitFor: '.wm-window',
    clip: async (_page, view) => ({ x: 0, y: 0, width: view.width, height: view.height }),
  },
  {
    name: 'phone-sheet-close',
    note: 'phone: a window sheet (Settings, from the You tab) goes back down when another tab is chosen',
    view: PHONE,
    phone: true,
    times: range(240, 30),
    cols: 3,
    tile: 380,
    setup: async (page) => {
      await tapCenter(page, '.shell-tab[data-tab="you"]');
      await page.waitForSelector('.wm-window');
      await page.waitForTimeout(1100);
    },
    pre: async () => {},
    act: (page) => tapCenter(page, '.shell-tab[data-tab="globe"]'),
    waitFor: '.wm-ghost',
    ghost: true,
    clip: async (_page, view) => ({ x: 0, y: 0, width: view.width, height: view.height }),
  },
];

if (argv.includes('--list')) {
  for (const s of scenarios) console.log(`${s.name.padEnd(20)} ${s.note}`);
  process.exit(0);
}

// ---- run ------------------------------------------------------------------------------------------------------

const exe = process.env.CHROMIUM || ['/usr/bin/chromium', '/usr/bin/google-chrome-stable'].find(existsSync);
const glArgs = gpu
  ? ['--enable-gpu', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ executablePath: exe, headless: true, args: glArgs });

async function openApp(sc, mode, dpr) {
  const context = await browser.newContext({
    viewport: sc.view,
    deviceScaleFactor: sc.phone ? Math.max(dpr, 2) : dpr,
    isMobile: !!sc.phone,
    hasTouch: !!sc.phone,
  });
  const page = await context.newPage();
  // Errors the page raises on the window (a ResizeObserver loop is one) are reported with the scenario.
  await page.addInitScript(() => {
    window.__errors = [];
    window.addEventListener('error', (e) => window.__errors.push(e.message));
  });
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[console.error] ${m.text()}`);
  });
  await page.goto(`${base}/`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('[data-region="dock"], [data-region="tabs"]', { timeout: 60000 });
  await page.waitForFunction(() => window.__atlas?.store?.loaded === true, null, { timeout: 60000 });
  await page.waitForTimeout(4500); // the boot, the runners (loaded on idle) and the first paint settle
  // The preference the Settings window writes; MotionRoot mirrors it to <html data-motion>.
  await page.evaluate(async (m) => {
    const { useUi } = await import('/src/store/ui.ts');
    useUi.getState().setMotion(m);
  }, mode);
  await page.waitForTimeout(400);
  return { context, page };
}

mkdirSync(out, { recursive: true });
for (const mode of modes) {
  for (const sc of scenarios) {
    if (only.length && !only.includes(sc.name)) continue;
    const { context, page } = await openApp(sc, mode, dprOpt);
    const dir = join(out, `${sc.name}-${mode}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    try {
      await sc.setup?.(page);
      const c = await sc.pre?.(page);
      await page.evaluate(arm, !!sc.clock);
      await sc.act(page, c);
      // Off draws no ghost: a close has nothing to wait for and the frames show the end state at once.
      if (sc.waitFor && !(sc.ghost && mode === 'off')) {
        await page.waitForSelector(sc.waitFor, { state: 'attached', timeout: 5000 });
      }
      await page.waitForTimeout(160); // the commits and effects that follow the act land
      const n = await page.evaluate(settle);
      if (debug) for (const line of await page.evaluate(describe)) console.log(`    held: ${line}`);
      const clip = await sc.clip(page, sc.view);
      const times = mode === 'off' ? [0, 120, 400] : sc.times;
      const files = [];
      for (const t of times) {
        await page.evaluate(seek, t);
        const f = join(dir, `t${String(t).padStart(4, '0')}.png`);
        await page.screenshot({ path: f, clip });
        files.push(f);
      }
      if (debug && sc.clock) {
        const ran = await page.evaluate(() => ({
          timers: window.__fxTimers.map((t) => `${t.at}${t.done ? ' ran' : ''}`).join(', '),
          budget: window.__atlasMotion?.stats() ?? null,
        }));
        console.log(`    timers (due ms): ${ran.timers}`);
        console.log(`    budget: ${JSON.stringify(ran.budget)}`);
      }
      await page.evaluate(release);
      const raised = await page.evaluate(() => window.__errors);
      if (raised.length > 0) console.log(`    window errors: ${[...new Set(raised)].join(' | ')}`);
      const sheet = join(out, `${sc.name}-${mode}.png`);
      execFileSync('montage', [
        ...files.flatMap((f, i) => ['-label', `${times[i]} ms`, f]),
        '-tile',
        `${sc.cols ?? 4}x`,
        '-geometry',
        `${sc.tile ?? 640}x+6+6`,
        '-background',
        '#05070a',
        '-fill',
        '#9aa4b6',
        '-pointsize',
        '14',
        sheet,
      ]);
      console.log(
        `[frames-app] ${sc.name} (${mode}): ${n} animations held, ${files.length} frames -> ${sheet}`,
      );
    } catch (e) {
      console.log(`[frames-app] ${sc.name} (${mode}) FAILED: ${e.message}`);
    }
    await context.close();
  }
}
await browser.close();
