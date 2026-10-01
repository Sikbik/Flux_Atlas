// The fresh contract, enforced on the views. The engine answers an attribute that APPEARS on an element that
// is already in the document; an element created carrying `data-fresh` fires nothing. `useFresh` is what
// makes the order right, so a view that renders `data-fresh` (or opts a row in with `data-fx="current"`)
// without it ships a Current that never plays and nobody notices. This test reads the source of every
// view and says so, with the fix, before it ships.
//
// The kit (`ui/`) and this folder are out of scope: the kit's own `data-fresh` is its wash (Settle) and
// `useFresh` is defined here.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SKIP = new Set(['ui', 'motion', 'styles', 'node_modules']);

function* sources(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) {
      if (dir === src && SKIP.has(e.name)) continue;
      yield* sources(path);
    } else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) {
      yield path;
    }
  }
}

/** A JSX `data-fresh={...}`, or a row that opts into Current (`data-fx` with the `current` token). */
const RENDERS_FRESH = /\bdata-fresh\s*=\s*\{/;
const OPTS_IN = /\bdata-fx\s*=\s*(?:\{[^}]*['"`][^'"`]*\bcurrent\b|['"][^'"]*\bcurrent\b)/;
const USES_HOOK = /\buseFresh\s*\(/;
const FROM_MOTION = /from\s+['"][./]*(?:[\w./-]*\/)?motion(?:\/fresh|\/index)?['"]/;

describe('a view that marks arrivals does it with useFresh', () => {
  const offenders: string[] = [];
  let scanned = 0;
  let using = 0;
  for (const file of sources(src)) {
    scanned++;
    const text = readFileSync(file, 'utf8');
    if (!RENDERS_FRESH.test(text) && !OPTS_IN.test(text)) continue;
    using++;
    if (!(USES_HOOK.test(text) && FROM_MOTION.test(text))) {
      offenders.push(relative(join(src, '..'), file).split(sep).join('/'));
    }
  }

  it('finds the views it is meant to guard', () => {
    // The rail and the Pulse feed are the first two; if this drops to zero the pattern above stopped matching.
    expect(scanned).toBeGreaterThan(50);
    expect(using).toBeGreaterThanOrEqual(2);
  });

  it('has no view that renders data-fresh or data-fx="current" without it', () => {
    expect(
      offenders,
      'These files render `data-fresh` (or opt a row into Current) without `useFresh` from web/src/motion. ' +
        'An element created already carrying `data-fresh` never fires the language; `useFresh(keys, { max, scope })` ' +
        'adds the attribute after the element is mounted. See web/src/motion/README.md, "Marking arrivals".',
    ).toEqual([]);
  });
});
