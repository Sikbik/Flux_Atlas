// The motion root writes `<html data-motion>` as full, reduced or off, and the kit and tokens switch on it.
// This feature's stylesheets must follow that one attribute: no private attribute of their own (the old
// `data-motion-off`), and a stylesheet that says what Reduced does must say what Off does.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const FEATURES = join(dirname(fileURLToPath(import.meta.url)), '..');
const MINE = ['command', 'settings', 'achievements', 'ambient'] as const;

function stylesheets(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return stylesheets(p);
    return e.name.endsWith('.css') ? [p] : [];
  });
}

const files = MINE.flatMap((d) => stylesheets(join(FEATURES, d)));

describe('feature stylesheets and the motion mode', () => {
  it('finds the stylesheets', () => {
    expect(files.length).toBeGreaterThan(8);
  });

  it.each(files.map((f) => [f.slice(FEATURES.length + 1), f]))(
    '%s keys on <html data-motion> only',
    (_name, file) => {
      const css = readFileSync(file as string, 'utf8');
      expect(css).not.toContain('data-motion-off');
      if (css.includes('[data-motion="reduced"]')) expect(css).toContain('[data-motion="off"]');
    },
  );
});
