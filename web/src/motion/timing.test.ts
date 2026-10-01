// Keeps the pieces of the language that live in two places in step: the numbers in timing.ts and the
// tokens in motion.css, the rule lists in attach.ts and the selectors in motion.css, the tokens in
// motion.css and the design doc. And one house rule: no emojis anywhere in this folder or its docs.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { QUIET, rules } from './attach';
import { parseBezier } from './geometry';
import { DUR, EASE, FLASH_PER_SECOND, REDUCED_MS } from './timing';

const here = fileURLToPath(new URL('.', import.meta.url));
const read = (p: string): string => readFileSync(p, 'utf8');
const css = read(join(here, 'motion.css'));
const runnerCss = read(join(here, 'runners/fx.css'));
const tokens = read(join(here, '../styles/tokens.css'));
const docPath = join(here, '../../../docs/design/motion-language.md');

const camel = (kebab: string): string => kebab.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

function declared(source: string, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of source.matchAll(new RegExp(`--${prefix}-([a-z0-9-]+):\\s*([^;]+);`, 'g'))) {
    out[camel(m[1]!)] = norm(m[2]!.replace(/\/\*.*?\*\//g, ''));
  }
  return out;
}

describe('timing.ts and motion.css say the same thing', () => {
  it('every duration is a token with the same value, and every token is a duration', () => {
    const tokensMs = declared(css, 'fx-dur');
    for (const [name, ms] of Object.entries(DUR)) {
      expect(tokensMs[name], `--fx-dur-${name}`).toBe(`${ms}ms`);
    }
    expect(Object.keys(tokensMs).sort()).toEqual(Object.keys(DUR).sort());
  });

  it('every easing is a token with the same curve (the shared ones come from tokens.css)', () => {
    const fxEase = declared(css, 'fx-ease');
    const sharedEase = declared(tokens, 'ease');
    for (const [name, curve] of Object.entries(EASE)) {
      const expected = fxEase[name] ?? sharedEase[name === 'burst' ? 'outExpo' : name];
      expect(norm(curve), `EASE.${name}`).toBe(expected);
    }
    for (const name of Object.keys(fxEase)) expect(EASE, `--fx-ease-${name}`).toHaveProperty(name);
  });

  it('every easing is a curve the geometry code can bake into keyframes', () => {
    for (const [name, curve] of Object.entries(EASE)) {
      const b = parseBezier(curve);
      expect(b, `EASE.${name}`).not.toBeNull();
      expect(b?.at(1)).toBe(1);
    }
  });

  it('keeps the flash rate and the reduced duration inside the accessibility limits', () => {
    expect(FLASH_PER_SECOND).toBeLessThanOrEqual(3); // WCAG 2.3.1
    expect(REDUCED_MS).toBeLessThanOrEqual(200);
  });
});

describe('attach.ts and motion.css say the same thing', () => {
  it('every charge selector has its ring in the stylesheet', () => {
    for (const selector of rules.charge) {
      expect(css, selector).toContain(`${selector}::after`);
    }
  });

  it('the stylesheet is quiet in the same zones as the engine', () => {
    for (const zone of QUIET.split(',').map((s) => s.trim())) {
      expect(css, zone).toContain(zone);
    }
  });

  it('the kit selectors the rules name exist in the kit (a rename there must show up here)', () => {
    const kitRoot = join(here, '../ui');
    const sources = listFiles(kitRoot)
      .filter((f) => /\.(tsx|css)$/.test(f) && !f.includes('.test.'))
      .map(read)
      .join('\n');
    for (const selector of Object.values(rules).flat()) {
      for (const cls of selector.matchAll(/\.(ui-[a-z0-9_-]+)/g)) {
        expect(sources, `${selector} -> ${cls[1]}`).toContain(cls[1]!);
      }
    }
  });
});

describe('the design doc', () => {
  it('lists every --fx token the stylesheet declares', () => {
    const doc = read(docPath);
    const names = new Set<string>();
    for (const source of [css, runnerCss]) {
      for (const m of source.matchAll(/(--fx-[a-z0-9-]+)\s*:/g)) names.add(m[1]!);
    }
    expect(names.size).toBeGreaterThan(20);
    const missing = [...names].filter((n) => !doc.includes(n));
    expect(missing, `tokens missing from docs/design/motion-language.md: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('house rules', () => {
  it('has no emojis in the motion folder or its docs', () => {
    const files = [...listFiles(here), docPath].filter((f) => /\.(ts|tsx|css|md|mjs)$/.test(f));
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      const hit = /\p{Extended_Pictographic}/u.exec(read(f));
      expect(hit, `${f}: ${hit?.[0]}`).toBeNull();
    }
  });
});

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}
