#!/usr/bin/env node
// Globe performance and memory checks against a running app (dev server or a VITE_ATLAS_TEST=1
// build), on the real GPU by default. Reads `window.__atlasGlobeStats`.
//
// usage:
//   node scripts/globe-check.mjs fps  [--base URL] [--path /] [--w 2560 --h 1440] [--seconds 10] [--swiftshader]
//   node scripts/globe-check.mjs soak [--base URL] [--minutes 10] [--w 1600 --h 900]
//
// fps:  waits for the globe, then counts requestAnimationFrame callbacks and reads the engine's own
//       frame and CPU times over the window; prints fps, frame-time percentiles, nodes drawn, the
//       governor's quality and render scale.
// soak: churns routes (open and close node, app, host, block, queue, about windows, the ambient
//       mode, `?w=` extras) for N minutes while the demo stream plays, and samples the JS heap after a
//       forced GC (CDP HeapProfiler.collectGarbage + Runtime.getHeapUsage) once a minute.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const mode = argv[0] ?? 'fps';
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const base = String(opt('base', 'http://127.0.0.1:5173'));
const width = Number(opt('w', mode === 'fps' ? 2560 : 1600));
const height = Number(opt('h', mode === 'fps' ? 1440 : 900));
const exe = process.env.CHROMIUM || ['/usr/bin/chromium', '/usr/bin/google-chrome-stable'].find(existsSync);
const glArgs = argv.includes('--swiftshader')
  ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  : ['--enable-gpu', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'];

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: [...glArgs, '--enable-precise-memory-info', '--js-flags=--expose-gc'],
});
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

async function ready(path) {
  await page.goto(new URL(path, base).toString(), { waitUntil: 'load', timeout: 60_000 });
  await page.waitForFunction(
    () => window.__atlasGlobeStats?.ready && window.__atlasGlobeStats.nodes > 6000,
    null,
    {
      timeout: 60_000,
    },
  );
}

const stats = () =>
  page.evaluate(() => {
    const s = window.__atlasGlobeStats;
    return {
      nodes: s.nodes,
      engineFps: Math.round(s.fps * 10) / 10,
      quality: s.quality,
      renderScale: s.renderScale,
      dpr: s.dpr,
      drawCalls: s.drawCalls,
      beats: s.beats,
      art: s.art,
      gpu: (() => {
        const gl = document.createElement('canvas').getContext('webgl2');
        const ext = gl?.getExtension('WEBGL_debug_renderer_info');
        return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
      })(),
    };
  });

if (mode === 'fps') {
  const seconds = Number(opt('seconds', 10));
  await ready(String(opt('path', '/')));
  // Let the intro wave and the governor settle first.
  await page.waitForTimeout(Number(opt('settle', 5000)));
  const r = await page.evaluate(
    (ms) =>
      new Promise((res) => {
        const frames = [];
        const cpu = [];
        let last = performance.now();
        const t0 = last;
        const tick = (now) => {
          frames.push(now - last);
          cpu.push(window.__atlasGlobeStats.frameMs);
          last = now;
          if (now - t0 < ms) requestAnimationFrame(tick);
          else res({ frames, elapsed: now - t0 });
        };
        requestAnimationFrame(tick);
      }),
    seconds * 1000,
  );
  const f = r.frames.slice(1).sort((a, b) => a - b);
  const pct = (p) => f[Math.min(f.length - 1, Math.floor((p / 100) * f.length))];
  const s = await stats();
  const cpuMs = await page.evaluate(() => window.__atlasGlobeStats.cpuMs);
  // GPU-synced cost per frame (update, render and a readback per frame; median of three runs of 90).
  const benchMs = await page.evaluate(() => {
    const e = window.__atlasGlobe?.engine;
    if (!e) return null;
    const runs = [e.benchmark(90), e.benchmark(90), e.benchmark(90)].sort((a, b) => a - b);
    return runs[1];
  });
  console.log(
    JSON.stringify(
      {
        viewport: `${width}x${height}`,
        fps: Math.round(((r.frames.length - 1) * 10000) / r.elapsed) / 10,
        frameMs: {
          p50: +pct(50).toFixed(2),
          p95: +pct(95).toFixed(2),
          p99: +pct(99).toFixed(2),
          max: +f.at(-1).toFixed(2),
        },
        engineCpuMs: +cpuMs.toFixed(2),
        gpuSyncedMsPerFrame: benchMs === null ? null : +benchMs.toFixed(2),
        ...s,
        errors,
      },
      null,
      2,
    ),
  );
} else if (mode === 'soak') {
  const minutes = Number(opt('minutes', 10));
  const cdp = await context.newCDPSession(page);
  await ready('/');
  const keys = await page.evaluate(() => {
    const t = globalThis.__atlas.store.nodes;
    const out = [];
    for (let i = 0; i < t.count && out.length < 40; i += 97) out.push(t.endpoint(i) || String(t.ids[i]));
    return out;
  });
  const apps = await page.evaluate(() =>
    globalThis.__atlas.store
      .appList()
      .slice(0, 10)
      .map((a) => a.name),
  );
  const tip = await page.evaluate(() => globalThis.__atlas.store.tip?.height ?? 1);
  const heap = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
    const u = await cdp.send('Runtime.getHeapUsage');
    const dom = await cdp.send('Memory.getDOMCounters').catch(() => null);
    const g = await page.evaluate(() => ({
      beats: window.__atlasGlobeStats.beats,
      frames: window.__atlasGlobeStats.frames,
      nodes: window.__atlasGlobeStats.nodes,
      fps: window.__atlasGlobeStats.fps,
    }));
    return {
      usedMB: +(u.usedSize / 1048576).toFixed(1),
      totalMB: +(u.totalSize / 1048576).toFixed(1),
      dom,
      ...g,
    };
  };
  const nav = (path) =>
    page.evaluate((p) => {
      history.pushState({}, '', p);
      dispatchEvent(new PopStateEvent('popstate'));
    }, path);
  const routes = (i) => {
    const k = keys[i % keys.length];
    const a = apps[i % Math.max(1, apps.length)] ?? 'kadenanode';
    return [
      `/node/${encodeURIComponent(k)}`,
      `/node/${encodeURIComponent(keys[(i + 7) % keys.length])}?w=queue`,
      `/app/${encodeURIComponent(a)}`,
      `/host/${encodeURIComponent(k.split(':')[0])}`,
      `/block/${tip - (i % 20)}?w=about`,
      '/queue?w=mempool,analytics',
      '/about',
      '/ambient',
      '/',
    ];
  };
  const samples = [];
  const t0 = Date.now();
  samples.push({ minute: 0, ...(await heap()) });
  console.log(JSON.stringify(samples.at(-1)));
  let i = 0;
  let nextSample = t0 + 60_000;
  while (Date.now() - t0 < minutes * 60_000) {
    for (const p of routes(i)) {
      await nav(p);
      await page.waitForTimeout(700);
    }
    i++;
    if (Date.now() >= nextSample) {
      nextSample += 60_000;
      samples.push({ minute: Math.round((Date.now() - t0) / 60_000), cycles: i, ...(await heap()) });
      console.log(JSON.stringify(samples.at(-1)));
    }
  }
  await nav('/');
  await page.waitForTimeout(3000);
  samples.push({
    minute: +((Date.now() - t0) / 60_000).toFixed(1),
    cycles: i,
    final: true,
    ...(await heap()),
  });
  console.log(JSON.stringify(samples.at(-1)));
  const first = samples[1] ?? samples[0];
  const last = samples.at(-1);
  console.log(
    JSON.stringify({
      heapStartMB: samples[0].usedMB,
      heapAfter1minMB: first.usedMB,
      heapEndMB: last.usedMB,
      growthAfterWarmupMB: +(last.usedMB - first.usedMB).toFixed(1),
      routeChanges: i * 9,
      beats: last.beats,
      errors,
    }),
  );
}
await browser.close();
