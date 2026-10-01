// Settle: a value that changed lands with a short glow that decays, then is just the value again.
// It animates the element's own text-shadow and colour (a few glyphs: negligible paint), never its
// layout, so a number can change width-stable inside a table cell or a status bar chip.

import { DUR } from '../timing';
import type { Fx, FxHandle } from './fx';

export interface SettleOptions {
  /** Tint the landing: `up` and `down` use the diverging pair, none keeps it white. */
  dir?: 'up' | 'down' | null;
  /** `text` (default): glow on the glyphs. `wash`: a white wash and edge bar on a row or card, decaying. */
  kind?: 'text' | 'wash';
  /** Ignore changes that come faster than this per element (default 1100 ms). */
  minGapMs?: number;
}

const last = new WeakMap<Element, number>();

const HOT = '#ffffff';
const TINT = { up: '#abbee4', down: '#ffb3a1' } as const;

/**
 * The glow's strength over time: a quick rise, then a long exponential-looking decay. Baked into
 * keyframes (the animation runs linear) so the glow is still visible at a third of the way through.
 */
export const DECAY: readonly (readonly [offset: number, strength: number])[] = [
  [0, 0],
  [0.1, 1],
  [0.24, 0.72],
  [0.42, 0.44],
  [0.64, 0.2],
  [0.84, 0.06],
  [1, 0],
];

const glow = (g: number) =>
  `0 0 ${(14 * g).toFixed(2)}px rgb(174 198 255 / ${(0.85 * g).toFixed(3)}), 0 0 ${(3 * g).toFixed(2)}px rgb(255 255 255 / ${(0.55 * g).toFixed(3)})`;

/** The fresh-row wash: strongest at once, gone in 1.6 s. */
const WASH: readonly (readonly [offset: number, strength: number])[] = [
  [0, 1],
  [0.15, 0.85],
  [0.4, 0.5],
  [0.7, 0.2],
  [1, 0],
];

const wash = (g: number) =>
  `inset 2px 0 0 0 rgb(134 161 218 / ${g.toFixed(3)}), inset 0 0 0 999px rgb(255 255 255 / ${(0.1 * g).toFixed(3)})`;

export function settle(fx: Fx, el: HTMLElement, opts: SettleOptions = {}): FxHandle | null {
  const mode = fx.gate(el);
  if (!mode) return null;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (now - (last.get(el) ?? Number.NEGATIVE_INFINITY) < (opts.minGapMs ?? 1100)) return null;
  const run = fx.begin('settle', el);
  if (!run) return null;
  last.set(el, now);

  const base = getComputedStyle(el).color;
  const flash = opts.dir ? TINT[opts.dir] : HOT;

  if (mode === 'reduced') {
    // Instant swap plus a tint that holds for a second.
    run.play(el, [{ color: flash }, { color: flash, offset: 0.5 }, { color: base }], {
      duration: 1000,
      easing: 'linear',
    });
    return run.endWhenDone(1000);
  }

  if (opts.kind === 'wash') {
    run.play(
      el,
      WASH.map(([offset, g]) => ({ offset, boxShadow: wash(g) })),
      { duration: 1600, easing: 'linear' },
    );
    return run.endWhenDone(1600);
  }

  run.play(
    el,
    DECAY.map(([offset, g]) => {
      const key: Keyframe = { offset, textShadow: glow(g) };
      // The colour holds the flash while the glow is strong, then relaxes to the text's own colour.
      if (offset === 0 || offset === 0.24) key.color = flash;
      if (offset === 1) key.color = base;
      return key;
    }),
    { duration: DUR.settle, easing: 'linear' },
  );
  return run.endWhenDone(DUR.settle);
}
