// The pure logic of the number ticker (design 6.4 D): which characters of the formatted text
// changed, which way they roll, and when a change rolls, counts up or swaps silently. No DOM and no
// React, so every rule is unit tested; `useOdometer` and `AnimatedNumber` only apply the decisions.

export type RollDirection = 'up' | 'down';

/** Milliseconds between neighbouring digits starting to roll, last digit first. */
export const ROLL_STAGGER_MS = 40;
/** Duration of a count-up from the previous value. */
export const COUNT_UP_MS = 900;
/** A measured quantity that moves by less than this fraction of itself swaps silently (0.05%). */
export const SILENT_BELOW = 0.0005;
/** A change larger than this fraction of the value counts up instead of rolling (5%). */
export const COUNT_UP_ABOVE = 0.05;

/** One character of the formatted text, as the ticker draws it. */
export interface Cell {
  /** Distance from the right end (0 is the last character): a stable React key while digits change. */
  pos: number;
  /** The character shown. */
  ch: string;
  /** True for `0` to `9`: digits sit in fixed-width cells and roll. */
  digit: boolean;
  /** The character this cell replaces; set only on a cell that animates in this update. */
  from: string | null;
  /** True when the character is new at this position, so the cell animates. */
  changed: boolean;
  /** Stagger rank among changed digits counted from the right (0 starts first). */
  rank: number;
}

/** True for a single `0` to `9`. */
export function isDigit(ch: string | null | undefined): boolean {
  return ch !== null && ch !== undefined && ch.length === 1 && ch >= '0' && ch <= '9';
}

/** The text as cells with nothing animating (first paint, count-up frames, reduced motion). */
export function staticCells(text: string): Cell[] {
  const chars = Array.from(text);
  return chars.map((ch, i) => ({
    pos: chars.length - 1 - i,
    ch,
    digit: isDigit(ch),
    from: null,
    changed: false,
    rank: 0,
  }));
}

/**
 * Diffs two formatted strings into cells. Characters are compared from the right, because numbers
 * grow on the left (`9,999` to `10,000` changes every digit, `6,724` to `6,725` only the last). A
 * changed digit gets a stagger rank counted from the right; a changed separator or unit takes the
 * rank of the digit beside it, so it fades in with that digit.
 */
export function planCells(prev: string, next: string): Cell[] {
  const before = Array.from(prev);
  const after = Array.from(next);
  const cells: Cell[] = new Array(after.length);
  let rank = -1;
  for (let r = 0; r < after.length; r++) {
    const i = after.length - 1 - r;
    const ch = after[i] as string;
    const old = before[before.length - 1 - r];
    const changed = old !== ch;
    const digit = isDigit(ch);
    if (changed && digit) rank++;
    cells[i] = { pos: r, ch, digit, from: changed ? (old ?? null) : null, changed, rank: Math.max(rank, 0) };
  }
  return cells;
}

/** `up` when the value rose, `down` when it fell, null when it did not move. */
export function directionOf(prev: number, next: number): RollDirection | null {
  return next > prev ? 'up' : next < prev ? 'down' : null;
}

/** |next - prev| as a fraction of |prev|; Infinity when leaving zero. */
export function relativeChange(prev: number, next: number): number {
  const delta = Math.abs(next - prev);
  if (delta === 0) return 0;
  return prev === 0 ? Number.POSITIVE_INFINITY : delta / Math.abs(prev);
}

export type TransitionKind = 'none' | 'swap' | 'roll' | 'count';

/** What to do with one update. */
export interface Transition {
  /** `none`: nothing visible changes; `swap`: instant; `roll`: changed digits roll; `count`: count up. */
  kind: TransitionKind;
  /** The way the value moved, null when unknown or unchanged. Drives the tint and the roll direction. */
  dir: RollDirection | null;
  /** The previous value, for a count-up to start from. */
  from?: number;
  /** A swap with no tint at all: the value moved by less than 0.05%, or Unknown is involved. */
  silent?: boolean;
}

export interface ChangeInput {
  /** The number currently shown (null when Unknown or when no number has been shown yet). */
  prev: number | null;
  /** The new number (null renders Unknown). */
  next: number | null;
  prevText: string;
  nextText: string;
  /** False for `roll={false}` and for reduced or off motion: updates swap and never roll or count. */
  animate: boolean;
  /** Count up from zero when the first number arrives. */
  countUpFirst: boolean;
  /** True until the component has shown its first number. */
  first: boolean;
}

/**
 * Classifies one update, per design 6.4 D.
 *
 * Detection is on the formatted text: if it does not change, nothing happens. Big moves (over 5%
 * of the value) count up over 900 ms. Smaller moves roll the changed digits. Two readings of the
 * spec are explicit here. A whole-number count (nodes, heights, mempool size) moves by events, so
 * `6,724` to `6,725` always rolls even though it is 0.015%; the 0.05% silent rule applies to
 * measured quantities (prices, rates, amounts) where the last digits are noise. And a step of one
 * has nothing to count through, so it rolls instead of counting up.
 */
export function classifyChange(i: ChangeInput): Transition {
  if (i.prevText === i.nextText) return { kind: 'none', dir: null };
  if (i.prev === null || i.next === null) {
    if (i.next !== null && i.first && i.countUpFirst && i.animate) {
      return { kind: 'count', dir: 'up', from: 0 };
    }
    return { kind: 'swap', dir: null, silent: true };
  }
  const dir = directionOf(i.prev, i.next);
  if (dir === null) return { kind: 'swap', dir: null, silent: true };
  if (!i.animate) return { kind: 'swap', dir };
  const rel = relativeChange(i.prev, i.next);
  const whole = Number.isInteger(i.prev) && Number.isInteger(i.next);
  if (rel > COUNT_UP_ABOVE && !(whole && Math.abs(i.next - i.prev) < 2)) {
    return { kind: 'count', dir, from: i.prev };
  }
  if (!whole && rel < SILENT_BELOW) return { kind: 'swap', dir, silent: true };
  return { kind: 'roll', dir };
}

/** Exponential ease-out: fast off the line, settling slowly. 0 at 0, exactly 1 at 1. */
export function easeOutExpo(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x >= 1 ? 1 : 1 - 2 ** (-10 * x);
}

/** The value shown `elapsedMs` into a count-up from `from` to `to`. */
export function countUpValue(from: number, to: number, elapsedMs: number, durationMs = COUNT_UP_MS): number {
  if (!(durationMs > 0) || elapsedMs >= durationMs) return to;
  return from + (to - from) * easeOutExpo(elapsedMs / durationMs);
}

/** Minimum milliseconds between visual updates for a rate in updates per second (0 = no limit). */
export function minIntervalMs(maxHz: number): number {
  return maxHz > 0 && Number.isFinite(maxHz) ? 1000 / maxHz : 0;
}

export interface CoalesceDecision {
  /** Show the new value now. */
  commitNow: boolean;
  /** Otherwise, how long until the pending value may be shown. */
  waitMs: number;
}

/**
 * Rate limit for visual updates: the first update shows at once; later ones wait until
 * `intervalMs` has passed since the last visible update (the latest value then wins).
 */
export function coalesce(nowMs: number, lastCommitMs: number | null, intervalMs: number): CoalesceDecision {
  if (lastCommitMs === null || intervalMs <= 0) return { commitNow: true, waitMs: 0 };
  const wait = lastCommitMs + intervalMs - nowMs;
  return wait <= 0 ? { commitNow: true, waitMs: 0 } : { commitNow: false, waitMs: wait };
}
