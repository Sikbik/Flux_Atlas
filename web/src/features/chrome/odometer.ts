// The odometer's logic (design 6.4 D), kept pure: which characters of a formatted number changed, which
// way the number moved, and which rule applies (silent swap, digit roll, or count-up).

export type Direction = 'up' | 'down';

export interface Cell {
  /** The character shown. */
  ch: string;
  /** The character it replaces when it rolls, or null when it did not change. */
  from: string | null;
  /** 0 for the last character that rolls, then 1, 2, ... (40 ms apart, from the last digit backward). */
  rank: number;
  /** Position from the end of the number (0 is the last character); stable across renders, so a key. */
  pos: number;
}

/** Changes under this fraction of the value swap silently (design 6.4 D). */
export const SILENT_FRACTION = 0.0005;
/** Changes over this fraction count up instead of rolling. */
export const COUNT_UP_FRACTION = 0.05;
/** Delay between rolling digits, last digit first. */
export const ROLL_STAGGER_MS = 40;

export type Plan =
  /** Nothing to animate (first render, unchanged, or a change too small to matter). */
  { kind: 'none' } | { kind: 'roll'; dir: Direction; cells: Cell[] } | { kind: 'count'; dir: Direction };

/**
 * Decides how to show `prev -> next`. `prevValue` and `nextValue` are the underlying numbers (null
 * when unknown); the texts are what the formatter produced for them.
 */
export function planChange(
  prevText: string,
  nextText: string,
  prevValue: number | null,
  nextValue: number | null,
): Plan {
  if (prevText === nextText || prevValue === null || nextValue === null) return { kind: 'none' };
  const delta = nextValue - prevValue;
  if (delta === 0) return { kind: 'none' };
  const dir: Direction = delta > 0 ? 'up' : 'down';
  const base = Math.max(Math.abs(prevValue), 1);
  const fraction = Math.abs(delta) / base;
  if (fraction < SILENT_FRACTION) return { kind: 'none' };
  if (fraction > COUNT_UP_FRACTION) return { kind: 'count', dir };
  return { kind: 'roll', dir, cells: diffCells(prevText, nextText) };
}

/** Per-character diff of two formatted numbers, aligned on the right (the last digit is the unit). */
export function diffCells(prevText: string, nextText: string): Cell[] {
  const cells: Cell[] = [];
  let rank = 0;
  for (let k = 0; k < nextText.length; k++) {
    const ch = nextText[nextText.length - 1 - k]!;
    const old = prevText[prevText.length - 1 - k] ?? null;
    const changed = old !== ch;
    cells.push({ ch, from: changed ? (old ?? ' ') : null, rank: changed ? rank++ : -1, pos: k });
  }
  cells.reverse();
  return cells;
}

const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));

/** The value `t` (0..1) of the way through a count-up from `from` to `to`. */
export function countUpValue(from: number, to: number, t: number): number {
  return from + (to - from) * easeOutExpo(Math.min(1, Math.max(0, t)));
}
