import { describe, expect, it } from 'vitest';
import {
  type ChangeInput,
  classifyChange,
  coalesce,
  countUpValue,
  directionOf,
  easeOutExpo,
  isDigit,
  minIntervalMs,
  planCells,
  relativeChange,
  staticCells,
} from './odometer';

const text = (cells: ReturnType<typeof planCells>) => cells.map((c) => c.ch).join('');
const changed = (cells: ReturnType<typeof planCells>) => cells.map((c) => (c.changed ? c.ch : '.')).join('');

describe('isDigit', () => {
  it('accepts only 0-9', () => {
    expect(isDigit('0')).toBe(true);
    expect(isDigit('9')).toBe(true);
    expect(isDigit(',')).toBe(false);
    expect(isDigit('K')).toBe(false);
    expect(isDigit('12')).toBe(false);
    expect(isDigit(null)).toBe(false);
    expect(isDigit(undefined)).toBe(false);
  });
});

describe('planCells', () => {
  it('changes only the last digit for 6,724 to 6,725', () => {
    const cells = planCells('6,724', '6,725');
    expect(text(cells)).toBe('6,725');
    expect(changed(cells)).toBe('....5');
    expect(cells[4]).toMatchObject({ from: '4', digit: true, rank: 0 });
  });

  it('ranks changed digits from the right, 0 first', () => {
    const cells = planCells('6,799', '6,800');
    // The 6 and the comma are unchanged; 8, 0 and 0 changed.
    expect(changed(cells)).toBe('..800');
    const ranks = cells.filter((c) => c.changed).map((c) => c.rank);
    expect(ranks).toEqual([2, 1, 0]);
  });

  it('aligns from the right when the length grows: 9,999 to 10,000', () => {
    const cells = planCells('9,999', '10,000');
    expect(text(cells)).toBe('10,000');
    // The comma is at the same distance from the right in both strings and does not change.
    expect(cells[2]?.ch).toBe(',');
    expect(cells[2]?.changed).toBe(false);
    // The new leading digit has no previous character.
    expect(cells[0]).toMatchObject({ ch: '1', from: null, changed: true });
    expect(cells.filter((c) => c.digit && c.changed)).toHaveLength(5);
  });

  it('a separator that appears fades in with the digit beside it: 999 to 1,000', () => {
    const cells = planCells('999', '1,000');
    expect(text(cells)).toBe('1,000');
    const comma = cells[1];
    expect(comma).toMatchObject({ ch: ',', digit: false, changed: true });
    expect(comma?.rank).toBe(2);
  });

  it('shrinking drops the leading character: 1,000 to 999', () => {
    const cells = planCells('1,000', '999');
    expect(text(cells)).toBe('999');
    expect(cells.every((c) => c.changed && c.digit)).toBe(true);
  });

  it('keeps unchanged suffixes still: 9.99 FLUX to 10.00 FLUX', () => {
    const cells = planCells('9.99 FLUX', '10.00 FLUX');
    expect(text(cells)).toBe('10.00 FLUX');
    expect(cells.slice(0, 5).map((c) => c.changed)).toEqual([true, true, false, true, true]);
    expect(cells.slice(-5).every((c) => !c.changed)).toBe(true);
  });

  it('an unchanged text changes nothing', () => {
    expect(planCells('6,724', '6,724').some((c) => c.changed)).toBe(false);
  });

  it('staticCells marks digits and never animates', () => {
    const cells = staticCells('1,2K');
    expect(cells.map((c) => c.digit)).toEqual([true, false, true, false]);
    expect(cells.some((c) => c.changed)).toBe(false);
  });
});

describe('directionOf and relativeChange', () => {
  it('reads direction from the numbers', () => {
    expect(directionOf(1, 2)).toBe('up');
    expect(directionOf(2, 1)).toBe('down');
    expect(directionOf(2, 2)).toBeNull();
  });

  it('is relative to the previous value, infinite from zero', () => {
    expect(relativeChange(100, 105)).toBeCloseTo(0.05);
    expect(relativeChange(100, 50)).toBeCloseTo(0.5);
    expect(relativeChange(0, 3)).toBe(Number.POSITIVE_INFINITY);
    expect(relativeChange(0, 0)).toBe(0);
  });
});

describe('classifyChange', () => {
  const base = (over: Partial<ChangeInput>): ChangeInput => ({
    prev: 6724,
    next: 6725,
    prevText: '6,724',
    nextText: '6,725',
    animate: true,
    countUpFirst: false,
    first: false,
    ...over,
  });

  it('rolls a +1 on a whole-number count even though it is far below 0.05%', () => {
    expect(classifyChange(base({}))).toEqual({ kind: 'roll', dir: 'up' });
  });

  it('rolls down when the count falls', () => {
    expect(classifyChange(base({ next: 6723, nextText: '6,723' }))).toEqual({ kind: 'roll', dir: 'down' });
  });

  it('does nothing when the formatted text is the same', () => {
    expect(classifyChange(base({ nextText: '6,724' })).kind).toBe('none');
  });

  it('counts up for a jump of more than 5%', () => {
    const t = classifyChange(base({ next: 7200, nextText: '7,200' }));
    expect(t).toEqual({ kind: 'count', dir: 'up', from: 6724 });
  });

  it('counts down for a big fall', () => {
    const t = classifyChange(base({ next: 5000, nextText: '5,000' }));
    expect(t).toEqual({ kind: 'count', dir: 'down', from: 6724 });
  });

  it('exactly 5% still rolls; a hair over counts up', () => {
    expect(classifyChange(base({ prev: 1000, next: 1050, prevText: '1,000', nextText: '1,050' })).kind).toBe(
      'roll',
    );
    expect(classifyChange(base({ prev: 1000, next: 1051, prevText: '1,000', nextText: '1,051' })).kind).toBe(
      'count',
    );
  });

  it('a step of one has nothing to count through, so it rolls even when it is over 5%', () => {
    expect(classifyChange(base({ prev: 19, next: 20, prevText: '19', nextText: '20' })).kind).toBe('roll');
    expect(classifyChange(base({ prev: 4, next: 6, prevText: '4', nextText: '6' })).kind).toBe('count');
  });

  it('swaps silently when a measured quantity moves by under 0.05%', () => {
    const t = classifyChange(
      base({ prev: 62193420.55, next: 62193420.56, prevText: '62,193,420.55', nextText: '62,193,420.56' }),
    );
    expect(t).toEqual({ kind: 'swap', dir: 'up', silent: true });
  });

  it('rolls a measured quantity once it moves by 0.05% or more', () => {
    const t = classifyChange(base({ prev: 0.0746, next: 0.0747, prevText: '0.0746', nextText: '0.0747' }));
    expect(t.kind).toBe('roll');
  });

  it('swaps without rolling when animation is off, keeping the direction for the tint', () => {
    expect(classifyChange(base({ animate: false }))).toEqual({ kind: 'swap', dir: 'up' });
  });

  it('shows Unknown instantly, with no tint', () => {
    expect(classifyChange(base({ next: null, nextText: 'Unknown' }))).toEqual({
      kind: 'swap',
      dir: null,
      silent: true,
    });
    expect(classifyChange(base({ prev: null, prevText: 'Unknown' }))).toEqual({
      kind: 'swap',
      dir: null,
      silent: true,
    });
  });

  it('counts up from zero for the first number when asked to', () => {
    const t = classifyChange(
      base({ prev: null, prevText: 'Unknown', first: true, countUpFirst: true, next: 6725 }),
    );
    expect(t).toEqual({ kind: 'count', dir: 'up', from: 0 });
  });

  it('does not count up the first number without the option or with animation off', () => {
    const arrive = { prev: null, prevText: 'Unknown', first: true } as const;
    expect(classifyChange(base({ ...arrive })).kind).toBe('swap');
    expect(classifyChange(base({ ...arrive, countUpFirst: true, animate: false })).kind).toBe('swap');
  });
});

describe('count-up', () => {
  it('easeOutExpo runs from 0 to exactly 1 and never goes backwards', () => {
    expect(easeOutExpo(0)).toBe(0);
    expect(easeOutExpo(1)).toBe(1);
    let last = -1;
    for (let i = 0; i <= 100; i++) {
      const v = easeOutExpo(i / 100);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
    expect(easeOutExpo(-5)).toBe(0);
    expect(easeOutExpo(5)).toBe(1);
  });

  it('is front-loaded: most of the distance is covered early', () => {
    expect(easeOutExpo(0.25)).toBeGreaterThan(0.8);
  });

  it('interpolates from the previous value to the target over 900 ms', () => {
    expect(countUpValue(100, 200, 0)).toBe(100);
    expect(countUpValue(100, 200, 900)).toBe(200);
    expect(countUpValue(100, 200, 5000)).toBe(200);
    const mid = countUpValue(100, 200, 225);
    expect(mid).toBeGreaterThan(180);
    expect(mid).toBeLessThan(200);
  });

  it('counts down too', () => {
    const v = countUpValue(200, 100, 100);
    expect(v).toBeLessThan(200);
    expect(v).toBeGreaterThan(100);
  });
});

describe('coalesce', () => {
  it('maps a rate to a minimum interval', () => {
    expect(minIntervalMs(1)).toBe(1000);
    expect(minIntervalMs(4)).toBe(250);
    expect(minIntervalMs(0)).toBe(0);
    expect(minIntervalMs(-1)).toBe(0);
    expect(minIntervalMs(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('shows the first update at once', () => {
    expect(coalesce(5000, null, 1000)).toEqual({ commitNow: true, waitMs: 0 });
  });

  it('holds updates that arrive inside the interval and says how long', () => {
    expect(coalesce(5300, 5000, 1000)).toEqual({ commitNow: false, waitMs: 700 });
  });

  it('shows an update once the interval has passed', () => {
    expect(coalesce(6000, 5000, 1000)).toEqual({ commitNow: true, waitMs: 0 });
    expect(coalesce(9000, 5000, 1000).commitNow).toBe(true);
  });

  it('never holds when coalescing is off', () => {
    expect(coalesce(5001, 5000, 0)).toEqual({ commitNow: true, waitMs: 0 });
  });
});
