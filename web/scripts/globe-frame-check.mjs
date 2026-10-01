#!/usr/bin/env node
// Globe framing check against a running app (dev server or a VITE_ATLAS_TEST=1 build), on the real
// GPU by default. Measures the planet's projected disc (`window.__atlasGlobe.engine.framing()`) against
// the free area the frame leaves (the DOM's top bar, dock and block rail) and fails when the planet
// leaves it.
//
// usage:
//   node scripts/globe-frame-check.mjs [--base URL] [--device 2560x1440] [--dprs 0.67,0.8,1,...]
//                                      [--art holo|marble|neon] [--shots DIR] [--swiftshader] [--quick]
//
// Per DPR (the CSS viewport is the device size divided by it, like a desktop browser's zoom):
//   load        first frames after load
//   pitch-held  the middle button held and dragged 400 px down (the user's repro), still held
//   pitch-rest  1.8 s after the release (rubber band and momentum settled)
//   home        1.8 s after a middle-button double-click
// Once, at DPR 1 (skipped with --quick): a runtime DPR change (CDP device metrics: browser zoom),
// a resize sequence, a window opened and closed, the ambient round trip (and the mesh flow it leaves
// behind), the home control after zoom and pitch, and a WebGL context lost and never restored.
//
// Contract (framing.ts): the disc stays below the top bar, right of the dock, centred in the free
// area, and at rest at least 32 CSS px above the rail (towers and glow included: envelope 1.1). At
// every step the WebGL context is live and frames advance.
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const flag = (name) => argv.includes(`--${name}`);
const base = String(opt('base', 'http://127.0.0.1:5173'));
const [devW, devH] = String(opt('device', '2560x1440')).split('x').map(Number);
const dprs = String(opt('dprs', '0.67,0.75,0.8,0.9,1,1.1,1.25,1.333,1.5,1.6667,1.75,2,2.25'))
  .split(',')
  .map(Number);
const art = String(opt('art', 'holo'));
const shots = opt('shots', null);
if (shots) mkdirSync(String(shots), { recursive: true });
const exe = process.env.CHROMIUM || ['/usr/bin/chromium', '/usr/bin/google-chrome-stable'].find(existsSync);
const glArgs = flag('swiftshader')
  ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  : ['--enable-gpu', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'];

const ENVELOPE = 1.1;
const CLEAR_BOTTOM = 32;
const browser = await chromium.launch({ executablePath: exe, headless: true, args: glArgs });
const failures = [];
const rows = [];

async function openPage(w, h, dpr) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  await context.addInitScript((a) => {
    try {
      localStorage.setItem('atlas.ui.v1', JSON.stringify({ globeArt: a }));
    } catch {}
  }, art);
  const page = await context.newPage();
  page.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`));
  await page.goto(new URL('/', base).toString(), { waitUntil: 'load', timeout: 60_000 });
  await page.waitForFunction(
    () => window.__atlasGlobeStats?.ready && window.__atlasGlobeStats.nodes > 1000,
    null,
    {
      timeout: 90_000,
    },
  );
  await page.waitForTimeout(2500);
  return { context, page };
}

const measure = (page) =>
  page.evaluate(() => {
    const g = window.__atlasGlobe;
    const s = window.__atlasGlobeStats;
    const rect = (sel) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
    const top = rect('[data-region=topbar]');
    const dock = rect('[data-region=dock]');
    const rail = rect('[data-region=rail]');
    if (!g || !s) return { engine: false };
    const e = g.engine;
    const f = e.framing();
    return {
      engine: true,
      lost: e.renderer.getContext().isContextLost(),
      frames: s.frames,
      fps: s.fps,
      generation: s.generation,
      dpr: window.devicePixelRatio,
      vw: innerWidth,
      vh: innerHeight,
      cx: f.center.x,
      cy: f.center.y,
      r: f.radius,
      free: f.free,
      homeR: f.homeRadius,
      fit: f.fit,
      tilt: e.rig.tilt,
      range: e.rig.range,
      topbar: top ? top.bottom : 0,
      dockRight: dock ? dock.right : 0,
      railTop: rail ? rail.top : innerHeight,
      links: e.links?.count ?? 0,
      path: location.pathname,
    };
  });

async function alive(page) {
  const a = await measure(page);
  await page.waitForTimeout(500);
  const b = await measure(page);
  return b.engine && !b.lost && b.frames > a.frames;
}

/** Records a measurement and its verdict. `rest` adds the clearance and centring checks. */
async function check(page, label, { rest = true, extra } = {}) {
  const m = await measure(page);
  const why = [];
  if (!m.engine) why.push('no engine');
  else {
    if (m.lost) why.push('context lost');
    if (!(await alive(page))) why.push('frames stalled');
    if (m.cy - m.r < m.topbar - 0.5)
      why.push(`top edge ${(m.cy - m.r).toFixed(0)} above the top bar ${m.topbar}`);
    if (m.cx - m.r < m.dockRight - 0.5) why.push(`left edge ${(m.cx - m.r).toFixed(0)} under the dock`);
    if (m.cy + m.r > m.railTop - 0.5)
      why.push(`bottom ${(m.cy + m.r).toFixed(0)} under the rail ${m.railTop}`);
    // The free area the engine frames into (the window manager's) must lie inside the chrome.
    const fr = m.free;
    if (fr.y < m.topbar - 0.5 || fr.y + fr.h > m.railTop + 0.5 || fr.x < m.dockRight - 0.5)
      why.push(`free area ${JSON.stringify(fr)} overlaps the chrome`);
    if (rest) {
      const gap = m.railTop - (m.cy + m.r * ENVELOPE);
      if (gap < CLEAR_BOTTOM - 1)
        why.push(`envelope ${gap.toFixed(0)} px above the rail (< ${CLEAR_BOTTOM})`);
      const fcx = fr.x + fr.w / 2;
      const fcy = fr.y + fr.h / 2;
      if (Math.abs(m.cx - fcx) > 2) why.push(`off-centre by ${(m.cx - fcx).toFixed(1)} px`);
      if (m.cy > fcy + 1)
        why.push(`centre ${m.cy.toFixed(0)} below the free area's middle ${fcy.toFixed(0)}`);
      if (m.cx - m.r < fr.x - 0.5 || m.cx + m.r > fr.x + fr.w + 0.5) why.push('wider than the free area');
    }
  }
  if (extra) why.push(...extra(m));
  rows.push({ label, m, ok: why.length === 0 });
  if (why.length) failures.push(`${label}: ${why.join('; ')}`);
  const gap = m.engine ? (m.railTop - (m.cy + m.r)).toFixed(0) : '-';
  console.log(
    `${why.length ? 'FAIL' : 'ok  '} ${label.padEnd(34)} ${m.engine ? `${m.vw}x${m.vh}@${m.dpr}` : ''} c=(${m.cx?.toFixed(0)},${m.cy?.toFixed(0)}) r=${m.r?.toFixed(0)} gap=${gap} tilt=${m.tilt?.toFixed(2)} gen=${m.generation} fps=${m.fps?.toFixed(0)}${why.length ? `  <- ${why.join('; ')}` : ''}`,
  );
  if (shots) {
    const name = label.replace(/[^a-z0-9.-]+/gi, '_');
    await page.screenshot({ path: `${shots}/${name}.png` }).catch(() => {});
  }
  return m;
}

async function middleDrag(page, m, dy = 400) {
  const { x, y } = await canvasPoint(page, (m.dockRight + m.vw) / 2, Math.max(m.topbar + 40, m.cy - 120));
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'middle' });
  const steps = 25;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x, y + (dy * i) / steps);
    await page.waitForTimeout(16);
  }
  return { x, y: y + dy };
}

/** A point near (x, y) where the canvas itself is under the pointer (not a label or the moon). */
const canvasPoint = (page, x, y) =>
  page.evaluate(
    ([x0, y0]) => {
      for (let k = 0; k < 40; k++) {
        const x = x0 + ((k % 7) - 3) * 37;
        const y = y0 + (Math.floor(k / 7) - 3) * 29;
        if (document.elementFromPoint(x, y)?.classList.contains('globe-canvas')) return { x, y };
      }
      return { x: x0, y: y0 };
    },
    [x, y],
  );

async function middleDoubleClick(page, x0, y0) {
  const { x, y } = await canvasPoint(page, x0, y0);
  await page.mouse.move(x, y);
  for (let i = 0; i < 2; i++) {
    await page.mouse.down({ button: 'middle' });
    await page.mouse.up({ button: 'middle' });
    await page.waitForTimeout(60);
  }
}

const tiltHome = (m) => (Math.abs(m.tilt) > 0.01 ? [`tilt ${m.tilt.toFixed(3)} after home`] : []);

/** Waits (up to 8 s) for the camera to come to rest: flights are frame-stepped, so a loaded machine is slower. */
const settle = (page, min = 1200) =>
  page.waitForTimeout(min).then(() =>
    page
      .waitForFunction(
        () => {
          const r = window.__atlasGlobe?.engine.rig;
          return (
            !!r && !r.isFlying && Math.abs(r.tilt - r.tiltD) < 0.004 && Math.abs(r.range - r.rangeD) < 0.004
          );
        },
        null,
        { timeout: 8000 },
      )
      .catch(() => {}),
  );

for (const dpr of dprs) {
  const w = Math.round(devW / dpr);
  const h = Math.round(devH / dpr);
  const { context, page } = await openPage(w, h, dpr);
  const tag = `dpr${dpr}`;
  const m0 = await check(page, `${tag} load`);
  const at = await middleDrag(page, m0);
  await page.waitForTimeout(300);
  await check(page, `${tag} pitch-held`, { rest: false });
  await page.mouse.up({ button: 'middle' });
  await settle(page, 1800);
  await check(page, `${tag} pitch-rest`);
  await middleDoubleClick(page, at.x, at.y);
  await settle(page);
  await check(page, `${tag} home`, { extra: tiltHome });
  await context.close();
}

if (!flag('quick')) {
  const { context, page } = await openPage(1600, 900, 1);
  const cdp = await context.newCDPSession(page);
  // Browser zoom while the app runs: the CSS viewport and the DPR change together.
  for (const z of [1.5, 0.8, 1.25, 1]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: Math.round(1600 / z),
      height: Math.round(900 / z),
      deviceScaleFactor: z,
      mobile: false,
    });
    await page.waitForTimeout(1200);
    await check(page, `zoom ${z}`);
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  for (const [w, h] of [
    [2000, 1500],
    [2000, 1006],
    [1400, 1006],
    [1100, 700],
    [1600, 900],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(900);
    await check(page, `resize ${w}x${h}`);
  }
  // Windows open, minimize, maximize, restore and close: a centred one (Settings), a left one (the
  // explorer) and a docked one on the right (About Flux) move the free area.
  const click = async (sel, what) => {
    await page.click(sel, { timeout: 5000 }).catch(() => failures.push(`no ${what}`));
    await page.waitForTimeout(900);
  };
  await click('[aria-label="Settings"]', 'Settings launcher');
  await check(page, 'settings open');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  await check(page, 'settings closed');
  await click('[aria-label="Explorer (E)"]', 'Explorer launcher');
  await check(page, 'explorer open (left)');
  await click('[aria-label="About Flux (M)"]', 'About launcher');
  await check(page, 'about docked (right) + explorer');
  await click('[data-window-type=about] [aria-label="Minimize"]', 'About minimize');
  await check(page, 'about minimized');
  await click('[aria-label^="Restore About"]', 'About restore dot');
  await check(page, 'about restored');
  await click('[data-window-type=about] [aria-label="Maximize"]', 'About maximize');
  await check(page, 'about maximized');
  await click('[data-window-type=about] [aria-label="Restore"]', 'About un-maximize');
  await check(page, 'about un-maximized');
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(600);
  await check(page, 'windows closed');
  // Ambient and back: the mesh flow must not stay on.
  await page.click('[aria-label="Ambient mode"]').catch(() => failures.push('no Ambient launcher'));
  await page.waitForTimeout(8000);
  await page.mouse.move(300, 300);
  await page.mouse.move(700, 500, { steps: 8 });
  await page.waitForTimeout(4500);
  await check(page, 'ambient exit', {
    extra: (m) => [
      ...(m.path !== '/' ? [`still at ${m.path}`] : []),
      ...(m.links > 0 ? [`${m.links} mesh flow links still drawn`] : []),
    ],
  });
  // Zoom in and pitch, then the home control (the dock's globe, already at /).
  const m1 = await measure(page);
  await page.mouse.move(m1.cx, m1.cy);
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(40);
  }
  await middleDrag(page, m1, 300);
  await page.mouse.up({ button: 'middle' });
  await page.waitForTimeout(800);
  await page.click('[aria-label="Globe (G)"]').catch(() => failures.push('no Globe launcher'));
  await settle(page);
  await check(page, 'home control', {
    extra: (m) => [
      ...tiltHome(m),
      ...(Math.abs(m.r - m.homeR) > 2 ? [`radius ${m.r.toFixed(0)} != home ${m.homeR.toFixed(0)}`] : []),
    ],
  });
  // The context is lost and the browser never restores it: a fresh engine must take over.
  const gen0 = (await measure(page)).generation;
  await page.evaluate(() => window.__atlasGlobe.loseContext());
  await page
    .waitForFunction(
      (g) => window.__atlasGlobeStats?.generation > g && window.__atlasGlobeStats.ready,
      gen0,
      {
        timeout: 20_000,
      },
    )
    .catch(() => failures.push('context loss: no fresh engine within 20 s'));
  await page.waitForTimeout(1500);
  await check(page, 'context lost, not restored');
  await context.close();
}

await browser.close();
const bad = rows.filter((r) => !r.ok).length;
console.log(`\n${rows.length - bad}/${rows.length} checks passed`);
if (failures.length) {
  console.log(failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
