#!/usr/bin/env node
// Screenshot tool for the web app (adapted from the team tool): headless system Chromium via
// playwright-core. Relative targets resolve against the running app (default the Vite dev server).
//
// usage: npm run shot -- <url|path|file> <out.png> [options]
//   --base http://127.0.0.1:5173   origin for relative paths such as /dev/live
//   --w 1600 --h 900               viewport (default 1600x900)
//   --dpr 1                        device pixel ratio
//   --mobile                       390x844 @3x, touch, mobile UA
//   --wait 2500                    ms to wait after load before the first shot
//   --wait-for "<selector>"        also wait for a selector (for example [data-status=live])
//   --frames 1                     number of shots; out.png -> out-1.png, out-2.png, ...
//   --interval 1000                ms between frames
//   --eval "js"                    JS to run in the page before shooting
//   --fps                          measure requestAnimationFrame FPS over 3 s and print it
//   --full                         full-page screenshot
//   --gpu                          try hardware GL (ANGLE/Vulkan) instead of SwiftShader
// Console errors, page errors and failed requests are always printed.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
if (argv.length < 2) {
  console.error(
    'usage: npm run shot -- <url|path|file> <out.png> [--base --w --h --dpr --mobile --wait --wait-for --frames --interval --eval --fps --full --gpu]',
  );
  process.exit(2);
}
const [target, out] = argv;
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const flag = (name) => argv.includes(`--${name}`);

const base = String(opt('base', process.env.ATLAS_WEB_URL ?? 'http://127.0.0.1:5173'));
const url = /^[a-z]+:\/\//i.test(target)
  ? target
  : target.startsWith('/')
    ? new URL(target, base).toString()
    : `file://${resolve(target)}`;
const mobile = flag('mobile');
const width = Number(opt('w', mobile ? 390 : 1600));
const height = Number(opt('h', mobile ? 844 : 900));
const dpr = Number(opt('dpr', mobile ? 3 : 1));
const wait = Number(opt('wait', 2500));
const waitFor = opt('wait-for', null);
const frames = Number(opt('frames', 1));
const interval = Number(opt('interval', 1000));
const evalJs = opt('eval', null);

const exe = process.env.CHROMIUM || ['/usr/bin/chromium', '/usr/bin/google-chrome-stable'].find(existsSync);
const glArgs = flag('gpu')
  ? ['--enable-gpu', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

const browser = await chromium.launch({ executablePath: exe, headless: true, args: glArgs });
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: dpr,
  isMobile: mobile,
  hasTouch: mobile,
});
const page = await context.newPage();
page.on('console', (m) => {
  if (['error', 'warning'].includes(m.type())) console.log(`[console.${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => console.log(`[requestfailed] ${r.url()} ${r.failure()?.errorText ?? ''}`));

await page.goto(url, { waitUntil: 'load', timeout: 60000 });
if (waitFor) await page.waitForSelector(String(waitFor), { timeout: 60000 });
await page.waitForTimeout(wait);
if (evalJs) {
  await page.evaluate(evalJs);
  await page.waitForTimeout(500);
}
if (flag('fps')) {
  const fps = await page.evaluate(
    () =>
      new Promise((res) => {
        let n = 0;
        const t0 = performance.now();
        const tick = () => {
          n++;
          if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
          else res((n * 1000) / (performance.now() - t0));
        };
        requestAnimationFrame(tick);
      }),
  );
  console.log(`[fps] ${fps.toFixed(1)} (headless; SwiftShader numbers are NOT representative of real GPUs)`);
}

for (let i = 1; i <= frames; i++) {
  const path = frames === 1 ? out : out.replace(/(\.png)?$/i, `-${i}.png`);
  await page.screenshot({ path, fullPage: flag('full') });
  console.log(`[shot] ${path}`);
  if (i < frames) await page.waitForTimeout(interval);
}
await browser.close();
