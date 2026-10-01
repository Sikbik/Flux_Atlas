#!/usr/bin/env node
// Checks of the moon's look that one still picture cannot show: GPU cost and temporal shimmer.
//
//   node scripts/moon-checks.mjs bench   [--base URL[,URL...]] [--trials 3]
//   node scripts/moon-checks.mjs shimmer [--base URL] [--art marble|dotmatrix|neon|all] [--seal] [--frames DIR]
//
// bench    engine.benchmark(180) (forced renders with a GPU sync per frame) at 2560x1440, DPR 1, with a beat in flight,
//          for the three art directions, in the sky (the world-space moon) and as the companion. Several bases are
//          interleaved, so two builds can be compared on the same GPU at the same moment (serve the old tree on another
//          port); the median of the trials is printed, in ms per frame.
// shimmer  The orbit is frozen (setSunRate(0)) and the camera is fixed, so only the moon's own time-dependent shading
//          (breathing, bands, shimmer, flares) and the composite's dither change from one 1/60 s frame to the next.
//          Two fixed crops of 200x200 CSS px at DPR 2: one around the moon, one of empty sky (the noise floor). The
//          mean absolute error (ImageMagick) of every consecutive pair is the series. A flicker, a crawling line or a
//          sparkle is a spike (a large maximum against the median); smooth motion is flat. With --seal a block is
//          emitted first and 150 frames (the whole beat) are taken, so flares, beams and beads are in the crop. The frames
//          are written to --frames (default: the system temp directory) and removed afterwards.
//
// Needs the lab served (`npm run dev -- --port 5450`), `playwright-core` (the web app has it: `npm i` in ../../web, or
// set PLAYWRIGHT_CORE), a system Chromium on a real GPU (CHROMIUM overrides its path; --swiftshader renders in software,
// which is fine for shimmer and meaningless for bench) and, for shimmer, ImageMagick.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i < 0 ? d : argv[i + 1];
};
const BASES = String(opt('base', process.env.GLOBE_LAB_URL ?? 'http://127.0.0.1:5391')).split(',');
const ARTS = ['marble', 'dotmatrix', 'neon'];
const SOFTWARE = argv.includes('--swiftshader');

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
const exe = process.env.CHROMIUM || ['/usr/bin/chromium', '/usr/bin/google-chrome-stable'].find(existsSync);
const args = SOFTWARE ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--enable-gpu', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'];
const VT = resolve(here, 'virtual-time.js');
/** The real instant a virtual-clock run stands for (moon, sun and the chain of beads all follow it). */
const VT_WALL = Date.UTC(2026, 9, 1, 1, 11, 45);
const VSUN = 'sun=2026-10-01T01:11:45Z';
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

// ---- bench -----------------------------------------------------------------------------------------------

async function benchOnce(base, art, mode) {
  const browser = await chromium.launch({ executablePath: exe, headless: true, args });
  try {
    const page = await (await browser.newContext({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 })).newPage();
    const cam = mode === 'orbit' ? '&cam=12,18,4.8' : '&cam=25,15,2.9';
    await page.goto(`${base}/?art=${art}&moonmode=${mode}&intro=0&hud=0&feed=0&labels=0&${VSUN}${cam}`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForFunction(() => window.engine && window.__lab, null, { timeout: 60000 });
    await page.evaluate(() => engine.assets.ready);
    await page.waitForTimeout(2500);
    await page.evaluate(() => engine.pause());
    // A beat in flight, so the beams, flares and rings are part of the measurement.
    await page.evaluate(() => {
      const s = engine.nodes;
      const ids = [];
      for (let i = 0; i < s.high && ids.length < 4; i += 97) if (s.alive[i] === 1) ids.push(s.id[i]);
      engine.emitBlock({ height: 2996930, producer: ids[0], payees: [{ id: ids[1], tier: 1, amount: 1 }, { id: ids[2], tier: 2, amount: 3.5 }, { id: ids[3], tier: 3, amount: 9 }] });
    });
    await page.evaluate(() => { for (let i = 0; i < 72; i++) engine.stepFrame(1 / 60); }); // 1.2 s: into the beams
    await page.evaluate(() => engine.benchmark(40)); // warm up
    return await page.evaluate(() => engine.benchmark(180));
  } finally {
    await browser.close();
  }
}

async function bench() {
  const trials = Number(opt('trials', 3));
  const res = {};
  for (let t = 0; t < trials; t++) {
    for (const mode of ['orbit', 'companion']) {
      for (const art of ARTS) {
        for (const base of BASES) {
          try {
            (res[`${mode}/${art}/${base}`] ??= []).push(await benchOnce(base, art, mode));
          } catch (e) {
            console.log('failed', mode, art, base, String(e.message).split('\n')[0]);
          }
        }
      }
    }
    console.log(`trial ${t + 1} of ${trials} done`);
  }
  console.log(`ms per frame at 2560x1440 DPR 1, median of ${trials}`);
  for (const mode of ['orbit', 'companion']) {
    for (const art of ARTS) {
      const cells = BASES.map((b) => {
        const v = res[`${mode}/${art}/${b}`] ?? [];
        return v.length ? median(v).toFixed(2) : '-';
      });
      console.log(`${mode.padEnd(9)} ${art.padEnd(10)} ${cells.join('  |  ')}   (${BASES.join(' | ')})`);
    }
  }
}

// ---- shimmer ---------------------------------------------------------------------------------------------

/** Mean absolute error between every consecutive pair of images, as a fraction of full scale. */
function mae(files) {
  const out = [];
  for (let k = 1; k < files.length; k++) {
    let v = 0; // `compare` exits 0 for identical images: no difference
    try {
      execFileSync('magick', ['compare', '-metric', 'MAE', files[k - 1], files[k], 'null:'], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const m = /\(([0-9.e-]+)\)/.exec(String(e.stderr)); // exits 1 and prints "<abs> (<fraction>)" on stderr otherwise
      v = m ? Number(m[1]) : NaN;
    }
    out.push(v);
  }
  return out;
}

async function shimmerOne(base, art, seal) {
  const dir = mkdtempSync(join(opt('frames', tmpdir()), 'moon-shimmer-'));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: exe, headless: true, args });
    const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })).newPage();
    page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 200)));
    await page.addInitScript({ path: VT });
    await page.addInitScript(`window.__vt.setWall(${VT_WALL});`);
    await page.goto(`${base}/?art=${art}&moonmode=orbit&intro=0&hud=0&feed=0&labels=0&${VSUN}`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForFunction(() => window.engine && window.__lab, null, { timeout: 60000 });
    await page.evaluate(() => engine.assets.ready);
    await page.waitForTimeout(800);
    await page.evaluate(() => { for (let i = 0; i < 4; i++) __vt.advance(1000 / 60); engine.pause(); });
    await page.evaluate(`(async () => {
      const nearest = (lat, lon, tier) => { const s = engine.nodes; let best = -1, bd = 1e9; for (let i = 0; i < s.high; i++) { if (s.alive[i] !== 1 || !Number.isFinite(s.lat[i])) continue; if (tier && s.tier[i] !== tier) continue; const d = (s.lat[i] - lat) ** 2 + ((s.lon[i] - lon) * Math.cos(lat * Math.PI / 180)) ** 2; if (d < bd) { bd = d; best = i; } } return s.id[best]; };
      const sto = engine.nodes; const V3 = engine.moon.pos.constructor;
      const dirOf = (id) => { const k = sto.slotOf(id); return new V3(sto.dir[k * 3], sto.dir[k * 3 + 1], sto.dir[k * 3 + 2]); };
      const ids = [nearest(39.0, -77.3), nearest(55.7, 12.5, 1), nearest(51.7, 4.3, 2), nearest(60.2, 24.9, 3)];
      const pose = engine.shots.planWide(engine.moon, ids.map(dirOf), 0.8, engine.rig.fovV, engine.rig.aspect);
      engine.rig.setFree(pose.pos, pose.look, pose.up, 1e6, 1e6); engine.rig.snapFree(true);
      engine.setSunRate(0);
      window.__ids = ids;
    })()`);
    await page.evaluate(() => { for (let i = 0; i < 90; i++) engine.stepFrame(1 / 60); });
    const m0 = await page.evaluate(() => engine.moonScreen());
    const w = 200;
    const cx = Math.round(Math.min(Math.max(0, m0.x - w / 2), 1600 - w));
    const cy = Math.round(Math.min(Math.max(0, m0.y - w / 2), 900 - w));
    if (seal) {
      await page.evaluate(() => {
        const ids = window.__ids;
        engine.emitBlock({ height: 2996930, producer: ids[0], payees: [{ id: ids[1], tier: 1, amount: 1 }, { id: ids[2], tier: 2, amount: 3.5 }, { id: ids[3], tier: 3, amount: 9 }] });
      });
    }
    const moon = [];
    const sky = [];
    const N = seal ? 150 : 90;
    for (let k = 0; k < N; k++) {
      await page.evaluate(() => engine.stepFrame(1 / 60));
      const f = join(dir, `m${String(k).padStart(3, '0')}.png`);
      await page.screenshot({ path: f, clip: { x: cx, y: cy, width: w, height: w } });
      moon.push(f);
      const g = join(dir, `s${String(k).padStart(3, '0')}.png`);
      await page.screenshot({ path: g, clip: { x: 40, y: 40, width: w, height: w } });
      sky.push(g);
    }
    const dm = mae(moon);
    const ds = mae(sky);
    const med = median(dm);
    const max = Math.max(...dm);
    let step = 0;
    for (let k = 1; k < dm.length; k++) step = Math.max(step, Math.abs(dm[k] - dm[k - 1]));
    console.log(`${base} ${art}${seal ? ' seal' : ' idle'}: moon MAE median ${med.toFixed(5)}, max ${max.toFixed(5)} (frame ${dm.indexOf(max) + 1}), ratio ${(max / med).toFixed(2)}, largest step ${step.toFixed(5)}; empty sky median ${median(ds).toFixed(5)}, max ${Math.max(...ds).toFixed(5)}`);
  } finally {
    await browser?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function shimmer() {
  const art = opt('art', 'all');
  const seal = argv.includes('--seal');
  for (const base of BASES) for (const a of art === 'all' ? ARTS : [art]) await shimmerOne(base, a, seal);
}

if (cmd === 'bench') await bench();
else if (cmd === 'shimmer') await shimmer();
else {
  console.log('usage: node scripts/moon-checks.mjs bench [--base URL[,URL...]] [--trials 3] | shimmer [--base URL[,URL...]] [--art marble|dotmatrix|neon|all] [--seal] [--frames DIR]');
  process.exit(2);
}
