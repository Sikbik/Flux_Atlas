#!/usr/bin/env node
// The quiet-zone audit on the live app: what animates when nothing is happening, and whether a burst of events
// stays inside the budget.
//
//   rest    Opens the app, waits for the gap between two blocks (the feed is live; the app has to be quiet for
//           0.7 s), leaves it alone and samples document.getAnimations() for a few seconds. Each animation is listed
//           with what it is and where it runs, as a state (tens of seconds: the block timer's ring, a progress bar),
//           an event (light or a wash an arrival or an input started) or a loop (never ends). Rest may have states
//           and nothing else: the light layer is empty, the effect budget is at zero, no event runs and no loop.
//   stress  Fires everything at once (blocks, toasts, windows, a palette; on a phone the tabs) and samples the
//           effect budget and the light layer every 40 ms: nothing may exceed the caps (2 power-ons, 2 currents,
//           3 pulses, 3 sparks, 3 slides, 10 in all), the frame is shot at the peak and when it is over (to look at
//           for overlap), and once the app is quiet again the layer, the inline tracks and the budget are empty.
//
// usage: node src/motion/tools/audit.mjs [--base http://127.0.0.1:5380] [--mode full|reduced|off]
//          [--only rest|stress] [--phone] [--seconds 6] [--out DIR] [--no-gpu]
//
// Needs the dev server proxied to a backend (see ../README.md), playwright-core and a system Chromium. The shots go
// to --out (default /home/stache/.cache/flux-atlas/shots/m1/audit).

// biome-ignore-all lint/suspicious/noConsole: a command line tool reports on stdout

import { existsSync, mkdirSync } from 'node:fs';
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
const mode = String(opt('mode', 'full'));
const only = String(opt('only', 'rest,stress')).split(',');
const phone = argv.includes('--phone');
const seconds = Number(opt('seconds', 6));
const out = String(opt('out', '/home/stache/.cache/flux-atlas/shots/m1/audit'));
const gpu = !argv.includes('--no-gpu');
const label = `${phone ? 'phone' : 'desktop'}, ${mode}`;

const exe = process.env.CHROMIUM || ['/usr/bin/chromium', '/usr/bin/google-chrome-stable'].find(existsSync);
const glArgs = gpu
  ? ['--enable-gpu', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ executablePath: exe, headless: true, args: glArgs });
const context = await browser.newContext({
  viewport: phone ? { width: 390, height: 844 } : { width: 1600, height: 900 },
  deviceScaleFactor: 1,
  isMobile: phone,
  hasTouch: phone,
});
const page = await context.newPage();
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(`${base}/`, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => window.__atlas?.store?.loaded === true, null, { timeout: 60000 });
await page.waitForTimeout(5000);
await page.evaluate(async (m) => {
  const { useUi } = await import('/src/store/ui.ts');
  useUi.getState().setMotion(m);
}, mode);
await page.waitForTimeout(600);

const failures = [];
const fail = (what) => {
  failures.push(what);
  console.log(`  FAIL ${what}`);
};

// ---- in the page ----------------------------------------------------------------------------------------------

// A running animation is one of three things. An event is light or a wash that an arrival or an input started and
// that ends in seconds; a state runs for tens of seconds (the block timer's ring, a progress bar) and is data drawn
// with a transform; a loop never ends. Rest has states and nothing else.
await page.evaluate(() => {
  window.__kindOf = (a) => {
    const t = a.effect?.getTiming?.();
    if (t?.iterations === Number.POSITIVE_INFINITY) return 'loop';
    return Number(t?.duration ?? 0) >= 5000 ? 'state' : 'event';
  };
  /** Everything an effect draws while it runs: the overlay's nodes and what is inside a track (the empty tracks a <Current> renders stay). */
  window.__lightNodes = () => document.querySelectorAll('.fx-layer *, .fx-current *').length;
});

/**
 * Waits for the gap between two events: nothing is drawn and the budget is empty for 0.7 s. With `idle`, only states
 * may run besides (the page at rest); without, a window's own animations are left alone (an open page may loop).
 */
const waitQuiet = (limit, idle = true) =>
  page.evaluate(
    ([limit, idle]) =>
      new Promise((resolve) => {
        const kindOf = window.__kindOf;
        const t0 = performance.now();
        let since = performance.now();
        const tick = () => {
          const busy =
            window.__lightNodes() > 0 ||
            (window.__atlasMotion?.stats().active ?? 0) > 0 ||
            (idle &&
              document.getAnimations().some((a) => a.playState === 'running' && kindOf(a) !== 'state'));
          const t = performance.now();
          if (busy) since = t;
          if (t - since >= 700) resolve(true);
          else if (t - t0 > limit) resolve(false);
          else setTimeout(tick, 100);
        };
        tick();
      }),
    [limit, idle],
  );

const budgetNow = () => page.evaluate(() => window.__atlasMotion?.stats() ?? null);

// ---- rest -------------------------------------------------------------------------------------------------------

if (only.includes('rest')) {
  console.log(`rest (${label}): ${seconds} s with no input`);
  const sample = (ms) =>
    page.evaluate(
      (ms) =>
        new Promise((resolve) => {
          const kindOf = window.__kindOf;
          const rows = new Map();
          const name = (el) =>
            el
              ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${[...(el.classList ?? [])]
                  .slice(0, 2)
                  .map((c) => `.${c}`)
                  .join('')}`
              : '?';
          const t0 = performance.now();
          let samples = 0;
          let lightMax = 0;
          const tick = () => {
            samples++;
            lightMax = Math.max(lightMax, window.__lightNodes());
            for (const a of document.getAnimations()) {
              const t = a.effect?.getTiming?.();
              const kind = kindOf(a);
              const key = `${kind.padEnd(5)} ${a.animationName ?? a.transitionProperty ?? '(waapi)'} on ${name(
                a.effect?.target,
              )}${a.effect?.pseudoElement ?? ''} [${kind === 'loop' ? 'infinite' : `${Math.round(Number(t?.duration ?? 0))} ms`}]`;
              const row = rows.get(key) ?? { n: 0, running: 0 };
              row.n++;
              if (a.playState === 'running') row.running++;
              rows.set(key, row);
            }
            if (performance.now() - t0 < ms) setTimeout(tick, 250);
            else resolve({ samples, lightMax, rows: [...rows.entries()] });
          };
          tick();
        }),
      ms,
    );
  // Sample in the gap, and again if an event arrived during the sample.
  let seen = null;
  let calm = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    calm = await waitQuiet(60000);
    seen = await sample(seconds * 1000);
    if (seen.rows.every(([k, v]) => k.startsWith('state') || v.running === 0)) break;
    console.log('  an event landed during the sample (the feed is live); sampling again');
  }
  const stateRows = seen.rows.filter(([k]) => k.startsWith('state'));
  // A finished animation that holds its end state (fill: forwards) is listed by the browser but runs nothing.
  const eventRows = seen.rows.filter(([k, v]) => k.startsWith('event') && v.running > 0);
  const loopRows = seen.rows.filter(([k]) => k.startsWith('loop'));
  console.log(
    `  ${seen.samples} samples${calm ? '' : ' (no gap between events was found)'}, light nodes at most ${seen.lightMax}`,
  );
  for (const [k, v] of seen.rows)
    console.log(`  ${String(v.running).padStart(2)}/${String(v.n).padEnd(2)} running  ${k}`);
  if (seen.rows.length === 0) console.log('  nothing animates');
  console.log(
    `  ${stateRows.length} state animation(s), ${eventRows.length} event running, ${loopRows.length} loop`,
  );
  if (eventRows.length === 0 && seen.lightMax > 0) fail('light was drawn at rest');
  for (const [k] of loopRows) fail(`an infinite animation at rest: ${k}`);
  if (eventRows.length > 0)
    fail(
      `light or a wash was running at rest (the feed never gave a quiet gap): ${eventRows.map(([k]) => k).join('; ')}`,
    );
  const budget = await budgetNow();
  console.log(
    `  budget at rest: ${JSON.stringify(budget?.byKind ?? null)} active ${budget?.active ?? 'n/a'}`,
  );
  if (budget && budget.active > 0) fail(`the effect budget is not empty at rest (${budget.active})`);
}

// ---- stress ------------------------------------------------------------------------------------------------------

if (only.includes('stress')) {
  console.log(`stress (${label}): a burst of everything at once`);
  mkdirSync(out, { recursive: true });
  await waitQuiet(60000, false); // start from a quiet app, so the numbers are the burst's
  const before = await budgetNow();
  await page.evaluate(() => {
    window.__peak = { total: 0, byKind: {}, light: 0 };
    const sample = () => {
      const s = window.__atlasMotion?.stats();
      if (s) {
        window.__peak.total = Math.max(window.__peak.total, s.active);
        for (const [k, v] of Object.entries(s.byKind)) {
          window.__peak.byKind[k] = Math.max(window.__peak.byKind[k] ?? 0, v);
        }
      }
      window.__peak.light = Math.max(window.__peak.light, window.__lightNodes());
    };
    window.__peakTimer = setInterval(sample, 40);
  });
  // blocks and toasts together, then windows and a palette (a phone: the tabs), as fast as a person and the network
  // could together
  await page.evaluate(async () => {
    const { toast } = await import('/src/app/toasts.ts');
    const s = window.__atlas.store;
    const hex = (n) => n.toString(16).padStart(64, '0');
    for (let i = 0; i < 4; i++) {
      const tip = s.blocks.newest();
      const height = (tip?.height ?? 2_998_000) + 1;
      s.apply({
        t: 'block',
        seq: (s.seq ?? 0) + 1,
        observed_ms: Date.now(),
        height,
        hash: hex(height ^ 0x7e7e7e),
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
      toast({ kind: 'info', title: `Toast ${i + 1}`, body: 'A burst of events at once.' });
      await new Promise((r) => setTimeout(r, 90));
    }
  });
  if (!phone) {
    for (const id of ['explorer', 'settings', 'terminal', 'about']) {
      await page.click(`[data-launcher="${id}"]`);
      await page.waitForTimeout(110);
    }
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(220);
    await page.screenshot({ path: join(out, `stress-peak-${phone ? 'phone' : 'desktop'}-${mode}.png`) });
    await page.keyboard.press('Escape');
  } else {
    for (const tab of ['live', 'you', 'live', 'globe']) {
      const r = await page.evaluate((t) => {
        const b = document.querySelector(`.shell-tab[data-tab="${t}"]`)?.getBoundingClientRect();
        return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
      }, tab);
      if (r) await page.touchscreen.tap(r.x, r.y);
      await page.waitForTimeout(120);
      if (tab === 'you') {
        await page.screenshot({ path: join(out, `stress-peak-${phone ? 'phone' : 'desktop'}-${mode}.png`) });
      }
    }
  }
  const quiet = await waitQuiet(25000, false);
  const peak = await page.evaluate(() => {
    clearInterval(window.__peakTimer);
    return window.__peak;
  });
  await page.screenshot({ path: join(out, `stress-after-${phone ? 'phone' : 'desktop'}-${mode}.png`) });
  console.log(`  peak ${JSON.stringify(peak)}`);
  const caps = { power: 2, current: 2, pulse: 3, spark: 3, slide: 3 };
  for (const [kind, cap] of Object.entries(caps)) {
    if ((peak.byKind[kind] ?? 0) > cap) fail(`${kind} reached ${peak.byKind[kind]} (cap ${cap})`);
  }
  if (peak.total > 10) fail(`${peak.total} effects at once (cap 10)`);
  const left = await page.evaluate(() => window.__lightNodes());
  const budget = await budgetNow();
  console.log(
    `  after: ${quiet ? 'quiet again' : 'NOT quiet after 25 s'}, light nodes ${left}, budget ${JSON.stringify(budget)}`,
  );
  if (before && before.active > 0)
    console.log(`  (the budget was not empty when the burst began: ${before.active})`);
  // The pages the burst opened may animate on their own (a loop, a progress ring): not an effect, listed to see.
  const content = await page.evaluate(() =>
    [
      ...new Set(
        document
          .getAnimations()
          .filter((a) => a.playState === 'running' && window.__kindOf(a) !== 'state')
          .map(
            (a) =>
              `${window.__kindOf(a)} ${a.animationName ?? a.transitionProperty ?? '(waapi)'} on ${a.effect?.target?.tagName?.toLowerCase()}.${String(a.effect?.target?.className?.baseVal ?? a.effect?.target?.className ?? '').split(' ')[0]}${a.effect?.pseudoElement ?? ''}`,
          ),
      ),
    ].slice(0, 8),
  );
  if (content.length > 0)
    console.log(`  content still animating in the pages the burst opened: ${content.join('; ')}`);
  if (!quiet || left > 0 || (budget && budget.active > 0)) {
    fail(
      `something was left running after the burst: ${left} light node(s), ${budget?.active ?? '?'} effect(s)`,
    );
    // What is still there, so a stuck run can be found: the nodes, their animations and where they are in them.
    const rest = await page.evaluate(() => {
      const name = (n) =>
        `${n.tagName.toLowerCase()}${n.className ? `.${String(n.className).split(' ')[0]}` : ''}`;
      return {
        nodes: [...document.querySelectorAll('.fx-layer *, .fx-current *')].slice(0, 12).map(name),
        running: document
          .getAnimations()
          .filter((a) => a.playState === 'running' && window.__kindOf(a) !== 'state')
          .slice(0, 12)
          .map(
            (a) =>
              `${window.__kindOf(a)} ${a.animationName ?? a.transitionProperty ?? '(waapi)'} on ${name(a.effect?.target)}${a.effect?.pseudoElement ?? ''}`,
          ),
        animations: document
          .getAnimations()
          .filter((a) => a.effect?.target?.closest?.('.fx-layer, .fx-current'))
          .slice(0, 12)
          .map(
            (a) =>
              `${a.playState} ${Math.round(Number(a.currentTime ?? 0))}/${Math.round(a.effect.getComputedTiming().endTime)} ms on ${name(a.effect.target)}`,
          ),
      };
    });
    console.log(`  left over: ${JSON.stringify(rest)}`);
  }
  console.log(`  shots: ${out}`);
}

await browser.close();
console.log(failures.length === 0 ? 'audit ok' : `audit found ${failures.length} problem(s)`);
process.exit(failures.length === 0 ? 0 : 1);
