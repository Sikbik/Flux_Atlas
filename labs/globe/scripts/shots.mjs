#!/usr/bin/env node
// Deterministic screenshots of the lab: loads a URL, stops the engine's own animation loop, runs an
// optional setup script in the page, then steps the simulation in fixed 1/60 s frames and captures at
// the requested simulated times. The same shot is therefore the same picture on every machine that
// renders it (the GPU only changes antialiasing).
//
//   npm run dev                              # in one terminal (or `npm run preview` after a build)
//   node scripts/shots.mjs                   # every shot into ./shots
//   node scripts/shots.mjs --only relay      # the shots whose name contains "relay"
//   node scripts/shots.mjs --base http://127.0.0.1:5391 --gpu
//
// Needs `playwright-core` (the web app has it: run `npm i` in ../../web, or set PLAYWRIGHT_CORE to its
// path) and a system Chromium. `magick` (ImageMagick) turns the PNGs into WebP and builds the contact
// sheets; without it the PNGs stay as they are.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '..', 'shots');
const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i < 0 ? d : argv[i + 1];
};
const BASE = opt('base', process.env.GLOBE_LAB_URL ?? 'http://127.0.0.1:5391');
const ONLY = opt('only', '');
const GPU = argv.includes('--gpu');

function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT_CORE, 'playwright-core', resolve(here, '../../../web/node_modules/playwright-core')].filter(Boolean);
  for (const t of tries) {
    try {
      return createRequire(import.meta.url)(t);
    } catch {
      /* try the next */
    }
  }
  throw new Error('playwright-core not found: run `npm i` in ../../web or set PLAYWRIGHT_CORE');
}
const { chromium } = loadPlaywright();

// ---- helpers that run inside the page ------------------------------------------------------------------

/** Picks the node nearest to a lat/lon, optionally of one tier (1 cumulus, 2 nimbus, 3 stratus). Returns its id. */
const NEAREST = `
const nearest = (lat, lon, tier) => {
  const s = engine.nodes; let best = -1, bd = 1e9;
  for (let i = 0; i < s.high; i++) {
    if (s.alive[i] !== 1 || !Number.isFinite(s.lat[i])) continue;
    if (tier && s.tier[i] !== tier) continue;
    const d = (s.lat[i] - lat) ** 2 + ((s.lon[i] - lon) * Math.cos(lat * Math.PI / 180)) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return s.id[best];
};`;

/** A block from a producer to three payees (Cumulus, Nimbus, Stratus), as the feed would send it. */
const BLOCK = (prod, p1, p2, p3) => `${NEAREST}
engine.emitBlock({ height: 2996930, producer: nearest(${prod}), payees: [
  { id: nearest(${p1}, 1), tier: 1, amount: 1 }, { id: nearest(${p2}, 2), tier: 2, amount: 3.5 }, { id: nearest(${p3}, 3), tier: 3, amount: 9 } ] });`;

const SUN = 'sun=2026-09-30T14:00:00Z';
const BARE = `intro=0&hud=0&feed=0&${SUN}`;

// ---- the shots -------------------------------------------------------------------------------------------

/** name, query, viewport, steps. `times` are simulated seconds after `setup`; `clip` crops in CSS pixels. */
const SHOTS = [
  // The three art directions, same camera.
  { name: 'art-marble', q: `art=marble&${BARE}&cam=25,15,2.9`, times: [0.5] },
  { name: 'art-dotmatrix', q: `art=dotmatrix&${BARE}&cam=25,15,2.9`, times: [0.5] },
  { name: 'art-neon', q: `art=neon&${BARE}&cam=25,15,2.9`, times: [0.5] },
  // The lab with its dev HUD.
  { name: 'explore-hud', q: `art=marble&intro=0&feed=0&${SUN}&cam=25,15,2.9`, times: [0.5] },
  // The moon under the pointer: the hover state and its card.
  { name: 'moon-hover', q: `art=marble&${BARE}&cam=25,15,2.9`, times: [0.5], hover: 'moon', clip: [560, 20, 980, 380] },
  // Selection: the beacon, the dimmed rest, the peers and their links.
  { name: 'selection-beacon', q: `art=marble&intro=0&feed=0&${SUN}&mesh=selection`, times: [3.2], setup: `${NEAREST} engine.select(nearest(50.1, 8.7, 2), { fly: true });`, hudOff: true },
  // An app's constellation.
  { name: 'constellation', q: `art=marble&${BARE}`, times: [7], setup: `{ const a = __lab.data.apps; const i = Math.max(0, a.names.indexOf('softethervpn-prod1')); engine.showAppConstellation(Array.from(new Set(a.instances.subarray(a.offsets[i], a.offsets[i + 1]))), { name: a.names[i], fly: true }); }` },
  // The mesh flow layer.
  { name: 'mesh-flow', q: `art=dotmatrix&${BARE}&mesh=flow&cam=30,10,3.2`, times: [4] },
  // The relay (design 6.4 I) on its own timeline: producer flare, shockwave, uplink, the moon receives,
  // the bar and the dev-fund chip, three downlinks in coinbase order, arrivals, the next aim.
  {
    name: 'relay',
    q: `art=marble&${BARE}&cam=36,-16,2.55&labels=0`,
    times: [0.12, 0.45, 0.75, 0.9, 1.05, 1.3, 1.65, 1.95, 2.15, 2.75],
    setup: BLOCK('37.5, -77.4', '48.1, 11.6', '51.5, -0.1', '60.2, 25'),
    sheet: { cols: 3, cell: 900 },
  },
  // The same relay under reduced motion: static ribbons, no shockwave.
  { name: 'relay-reduced', q: `art=marble&${BARE}&cam=36,-16,2.55&labels=0`, times: [0.3, 0.6, 1.0], setup: `engine.setReduced(true); ${BLOCK('37.5, -77.4', '48.1, 11.6', '51.5, -0.1', '60.2, 25')}`, reduced: true, sheet: { cols: 3, cell: 800 } },
  // The moon: companion close-up, the chain and ring, orbit mode portrait, earthrise and eclipse.
  { name: 'moon-companion', q: `art=marble&${BARE}&cam=25,15,2.9&moonclock=0`, times: [0.5], clip: [780, 40, 440, 300], dpr: 3 },
  { name: 'moon-chain', q: `art=marble&${BARE}&cam=25,15,3.3`, times: [0.5] },
  { name: 'moon-orbit-portrait', q: `art=marble&${BARE}`, times: [3.5], setup: `engine.viewMoon('portrait', { rate: 30 });` },
  { name: 'moon-earthrise', q: `art=marble&${BARE}`, times: [3], setup: `engine.viewMoon('earthrise', { at: 7.5, rate: 30 });` },
  { name: 'moon-eclipse', q: `art=marble&${BARE}&sun=2026-09-30T20:30:00Z`, times: [8], setup: `engine.viewMoon('eclipse', { rate: 30 });` },
  { name: 'moon-lite', q: `art=dotmatrix&quality=low&${BARE}&cam=25,15,2.9`, times: [0.5], clip: [780, 40, 440, 300], dpr: 3 },
  // The moon in the other two art directions, to show the symbol is the same object everywhere.
  { name: 'moon-neon', q: `art=neon&${BARE}&cam=25,15,2.9`, times: [0.5], clip: [780, 40, 440, 300], dpr: 3 },
  // The boot: the symbol assembles, the reveal wave lights the planet, it lifts off and becomes the moon.
  { name: 'boot', q: `art=marble&${BARE}&labels=0&cam=25,-30,3.4`, times: [0.2, 0.55, 0.85, 1.16, 1.6, 2.1, 2.6, 3.0, 3.6], setup: 'BOOT', sheet: { cols: 3, cell: 800 } },
  // Docked UI: the globe re-centers in the free area and the moon's orbit gives way.
  {
    name: 'inset-docked',
    q: `art=marble&${BARE}&cam=25,15,2.9`,
    times: [0.6],
    // A stand-in for the app's docked window: the globe and the moon's orbit keep to the free area.
    setup: `engine.setInset({ left: 0, right: 420, top: 0, bottom: 0 }, 1);
      const d = document.createElement('div');
      d.style.cssText = 'position:fixed;top:16px;right:16px;bottom:16px;width:388px;border-radius:14px;background:rgba(12,14,26,.88);border:1px solid rgba(255,255,255,.07);box-shadow:0 18px 60px rgba(0,0,0,.5);color:#c9cde0;font:13px/1.6 "Open Sans",system-ui,sans-serif;padding:22px 24px;z-index:20';
      d.innerHTML = '<div style="font:600 15px Montserrat,sans-serif;color:#fff;margin-bottom:14px">Docked window</div><div style="opacity:.6">The globe re-centres in the free area. The moon keeps to it, and never sits behind this panel.</div>';
      document.body.append(d);`,
  },
  // The phone.
  { name: 'mobile', q: `art=marble&intro=0&feed=0&${SUN}`, times: [0.3, 1.0, 1.8], setup: BLOCK('37.5, -77.4', '48.1, 11.6', '51.5, -0.1', '60.2, 25'), mobile: true, sheet: { cols: 3, cell: 390 } },
  // Ambient mode: the director's scenes.
  { name: 'ambient-landing', q: `art=marble&ambient=1&intro=0&hud=0&feed=0&${SUN}`, times: [2.5, 4.5], setup: '__lab.feed.blockNow();', pre: 6, sheet: { cols: 2, cell: 800 } },
  { name: 'ambient-hub', q: `art=marble&ambient=1&intro=0&hud=0&feed=0&${SUN}`, times: [6], setup: `engine.ambient.scene('hub');` },
  { name: 'ambient-web', q: `art=marble&ambient=1&intro=0&hud=0&feed=0&${SUN}&mesh=flow`, times: [8], setup: `engine.ambient.scene('web');` },
  { name: 'ambient-constellation', q: `art=marble&ambient=1&intro=0&hud=0&feed=0&${SUN}`, times: [6], setup: `engine.ambient.scene('constellation');` },
  // Ambient under reduced motion: still compositions, the moon parked right of the planet, cross-fades between them.
  { name: 'ambient-reduced', q: `art=marble&ambient=1&intro=0&hud=0&feed=0&${SUN}`, times: [3, 28, 52], reduced: true, sheet: { cols: 3, cell: 800 } },
  { name: 'ambient-earthrise', q: `art=marble&ambient=1&intro=0&hud=0&feed=0&${SUN}`, times: [5, 10], setup: `engine.ambient.scene('earthrise');`, sheet: { cols: 2, cell: 800 } },
];

const BOOT_SETUP = `
// The lab's own boot timeline (src/lab/boot.ts), advanced one engine frame at a time.
let t = 0;
const orig = engine.stepFrame.bind(engine);
engine.stepFrame = (dt) => { t += dt; __lab.bootAt(t, 39, -77); orig(dt); };
__lab.bootAt(0, 39, -77);`;

// ---- run -----------------------------------------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });
const exe = process.env.CHROMIUM || ['/usr/bin/chromium', '/usr/bin/google-chrome-stable'].find(existsSync);
const args = GPU ? ['--enable-gpu', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ executablePath: exe, headless: true, args });
const haveMagick = (() => {
  try {
    execFileSync('magick', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

for (const shot of SHOTS.filter((s) => !ONLY || s.name.includes(ONLY))) {
  const mobile = shot.mobile === true;
  const ctx = await browser.newContext({
    viewport: { width: mobile ? 390 : 1600, height: mobile ? 844 : 900 },
    deviceScaleFactor: shot.dpr ?? (mobile ? 2 : 1),
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: shot.reduced ? 'reduce' : 'no-preference',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/?${shot.q}`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(3500);
  await page.evaluate(() => engine.pause());
  if (shot.pre) await page.evaluate((n) => { for (let i = 0; i < n; i++) engine.stepFrame(1 / 60); }, Math.round(shot.pre * 60));
  if (shot.hudOff) await page.evaluate(() => document.querySelector('.hud')?.classList.add('collapsed'));
  if (shot.setup) await page.evaluate(`(async()=>{ ${shot.setup === 'BOOT' ? BOOT_SETUP : shot.setup} })()`);
  let sim = 0;
  const files = [];
  for (let i = 0; i < shot.times.length; i++) {
    const n = Math.max(0, Math.round((shot.times[i] - sim) * 60));
    await page.evaluate((n) => { for (let k = 0; k < n; k++) engine.stepFrame(1 / 60); }, n);
    sim += n / 60;
    if (shot.hover === 'moon' && i === 0) {
      const m = await page.evaluate(() => engine.moonScreen());
      await page.mouse.move(m.x - 140, m.y + 90);
      await page.mouse.move(m.x, m.y, { steps: 5 });
      await page.evaluate(() => { for (let k = 0; k < 40; k++) engine.stepFrame(1 / 60); });
      await page.waitForTimeout(300);
    }
    // The overlays (captions, counters) run on the page's own clock: let their transitions finish.
    await page.waitForTimeout(shot.q.includes('ambient=1') ? 1100 : 120);
    const name = shot.times.length > 1 ? `${shot.name}-${String(i + 1).padStart(2, '0')}` : shot.name;
    const file = join(OUT, `${name}.png`);
    const o = { path: file };
    if (shot.clip) o.clip = { x: shot.clip[0], y: shot.clip[1], width: shot.clip[2], height: shot.clip[3] };
    await page.screenshot(o);
    files.push(file);
  }
  console.log(`${shot.name.padEnd(24)} ${files.length} frame(s)${errors.length ? `  ERRORS: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  if (haveMagick && shot.sheet && files.length > 1) {
    execFileSync('magick', ['montage', ...files, '-tile', `${shot.sheet.cols}x`, '-geometry', `${shot.sheet.cell}x+3+3`, '-background', '#0a0b12', join(OUT, `${shot.name}-sheet.png`)]);
  }
  await ctx.close();
}
await browser.close();

// PNG to WebP, like the design's shots.
if (haveMagick) {
  for (const f of readdirSync(OUT).filter((f) => f.endsWith('.png'))) {
    const src = join(OUT, f);
    execFileSync('magick', [src, '-quality', '90', src.replace(/\.png$/, '.webp')]);
    rmSync(src);
  }
}
console.log(`shots in ${OUT}`);
