#!/usr/bin/env node
// Copies the `globe` block of the design tokens into the engine, so the renderer reads colors from
// the design system and never hard-codes them. Run after the Design Director updates tokens.json:
//   npm run tokens
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../../../docs/design/tokens.json');
const dst = resolve(here, '../src/engine/design-tokens.json');

const all = JSON.parse(readFileSync(src, 'utf8'));
const out = {
  _source: 'docs/design/tokens.json (keys: globe, tier, hot)',
  globe: all.globe,
  tier: all.tier,
  hot: all.hot,
};
writeFileSync(dst, JSON.stringify(out, null, 2) + '\n');
console.log(`[tokens] ${Object.keys(out.globe).length} globe tokens -> src/engine/design-tokens.json`);

// The lab's own UI uses the full design token sheet, so the dev tools and the ambient overlay
// share the interface's type, colors and motion.
copyFileSync(resolve(here, '../../../docs/design/tokens.css'), resolve(here, '../src/lab/design-tokens.css'));
console.log('[tokens] tokens.css -> src/lab/design-tokens.css');
