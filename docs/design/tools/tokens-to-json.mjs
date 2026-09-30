#!/usr/bin/env node
// Generates docs/design/tokens.json from docs/design/tokens.css so non-DOM
// consumers (the globe renderer, Playwright checks) get the same values.
// usage: node docs/design/tools/tokens-to-json.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(here, '../tokens.css');
const outPath = resolve(here, '../tokens.json');

const css = readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
// Only the first :root block holds the base tokens.
const rootStart = css.indexOf(':root {');
const rootEnd = css.indexOf('\n}', rootStart);
const block = css.slice(rootStart + 7, rootEnd);

const raw = {};
for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
  raw[m[1]] = m[2].replace(/\s+/g, ' ').trim();
}

const resolveVar = (value, depth = 0) => {
  if (depth > 8) return value;
  return value.replace(/var\((--[a-z0-9-]+)\)/gi, (_, name) =>
    raw[name] !== undefined ? resolveVar(raw[name], depth + 1) : `var(${name})`,
  );
};

const flat = {};
for (const [k, v] of Object.entries(raw)) flat[k.slice(2)] = resolveVar(v);

const num = (v) => (/^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v);
const px = (v) => (/^-?\d+(\.\d+)?px$/.test(v) ? Number.parseFloat(v) : v);
const ms = (v) => (/^-?\d+(\.\d+)?ms$/.test(v) ? Number.parseFloat(v) : v);

const pick = (prefix, map = (v) => v) =>
  Object.fromEntries(
    Object.entries(flat)
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, v]) => [k.slice(prefix.length), map(v)]),
  );

const out = {
  _generated: 'by docs/design/tools/tokens-to-json.mjs from tokens.css. Do not edit.',
  globe: pick('globe-', num),
  tier: {
    cumulus: flat['tier-cumulus'],
    nimbus: flat['tier-nimbus'],
    stratus: flat['tier-stratus'],
    cumulusInk: flat['tier-cumulus-ink'],
    nimbusInk: flat['tier-nimbus-ink'],
    stratusInk: flat['tier-stratus-ink'],
  },
  brand: pick('flux-'),
  logo: pick('logo-'),
  font: { display: flat['font-display'], sans: flat['font-sans'], accent: flat['font-accent'], mono: flat['font-mono'] },
  status: pick('status-'),
  accent: pick('accent-'),
  hot: { hot: flat.hot, hot2: flat['hot-2'] },
  surface: { void: flat.void, ink0: flat['ink-0'], ink1: flat['ink-1'], ink2: flat['ink-2'], ink3: flat['ink-3'], ink4: flat['ink-4'] },
  text: pick('text-'),
  viz: pick('viz-'),
  seq: pick('seq-'),
  div: pick('div-'),
  durationsMs: pick('dur-', ms),
  ease: pick('ease-'),
  layout: Object.fromEntries(
    ['topbar-h', 'statusbar-h', 'dock-w', 'rail-h', 'timeline-h', 'timeline-h-open', 'inspector-w', 'window-gap', 'bp-phone', 'bp-tablet', 'bp-wide', 'bp-tv'].map((k) => [k, px(flat[k])]),
  ),
  all: flat,
};

writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote ${outPath} (${Object.keys(flat).length} tokens)`);
