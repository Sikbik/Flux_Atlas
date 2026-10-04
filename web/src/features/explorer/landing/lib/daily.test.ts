import { describe, expect, it } from 'vitest';
import type { ChainDailyDay, ChainDailyDto } from '../api';
import {
  bucketFrame,
  DAY_MS,
  dailySeries,
  drawnSeries,
  fluxText,
  hashrateText,
  headline,
  isRunningDay,
  lastKnown,
  logAxisFor,
  logTickText,
  METRICS,
  pickBucketSize,
  resolveScale,
  type SeriesFrame,
  summaryOf,
  thinValues,
} from './daily';

const D0 = Date.UTC(2026, 8, 1); // a Tuesday

function day(i: number, over: Partial<ChainDailyDay> = {}): ChainDailyDay {
  return {
    day_ms: D0 + i * DAY_MS,
    transactions: 40_000 + i,
    fees: 0.02,
    outputs: 3_000_000,
    supply: 430_000_000 + i * 40_320,
    difficulty: 0.1,
    network_hash: null,
    ...over,
  };
}

function dto(days: ChainDailyDay[], generatedAfterLast = DAY_MS + 60_000): ChainDailyDto {
  const last = days.at(-1)?.day_ms ?? D0;
  return { generated_ms: last + generatedAfterLast, first_day_ms: days[0]?.day_ms ?? null, days };
}

describe('isRunningDay', () => {
  it('is true for the day the payload was built in, false once the day is over', () => {
    expect(isRunningDay(D0, D0 + 3 * 3_600_000)).toBe(true);
    expect(isRunningDay(D0, D0 + DAY_MS)).toBe(false);
    expect(isRunningDay(D0, D0 + DAY_MS + 60_000)).toBe(false);
  });
});

describe('dailySeries', () => {
  it('takes one figure a day and keeps unknown days as gaps', () => {
    const days = [day(0), day(1, { transactions: null }), day(2)];
    const s = dailySeries(dto(days), 'transactions');
    expect(s.t).toEqual(days.map((d) => d.day_ms));
    expect(s.v).toEqual([40_000, null, 40_002]);
    expect(s.span).toBe(1);
    expect(s.trimmed).toBe(false);
  });

  it('leaves the running day out of a per-day figure, and keeps it for a standing one', () => {
    const days = [day(0), day(1), day(2)];
    // Built three hours into the last day.
    const running = dto(days, 3 * 3_600_000);
    const tx = dailySeries(running, 'transactions');
    expect(tx.t).toHaveLength(2);
    expect(tx.trimmed).toBe(true);
    const supply = dailySeries(running, 'supply');
    expect(supply.t).toHaveLength(3);
    expect(supply.trimmed).toBe(false);
  });

  it('never turns a missing figure into a zero', () => {
    const s = dailySeries(dto([day(0, { fees: null }), day(1, { fees: Number.NaN })]), 'fees');
    expect(s.v).toEqual([null, null]);
  });
});

describe('pickBucketSize and bucketFrame', () => {
  it('draws up to 480 days a day, then whole weeks', () => {
    expect(pickBucketSize(30)).toBe(1);
    expect(pickBucketSize(365)).toBe(1);
    expect(pickBucketSize(480)).toBe(1);
    expect(pickBucketSize(481)).toBe(7);
    expect(pickBucketSize(3100)).toBe(7);
    expect(pickBucketSize(3400)).toBe(14);
  });

  const frame = (n: number, f: (i: number) => number | null): SeriesFrame => ({
    metric: 'transactions',
    t: Array.from({ length: n }, (_, i) => D0 + i * DAY_MS),
    v: Array.from({ length: n }, (_, i) => f(i)),
    span: 1,
    trimmed: false,
  });

  it('averages the known days of a week and starts every bucket on a Monday', () => {
    // D0 is a Tuesday: the first bucket is the six days to the next Monday, then whole weeks.
    const b = bucketFrame(
      frame(20, (i) => i),
      7,
    );
    expect(b.span).toBe(7);
    expect(b.t[0]).toBe(D0);
    expect(new Date(b.t[1] as number).getUTCDay()).toBe(1);
    // Days 0 to 5 (Tuesday to Sunday) average 2.5; days 6 to 12 average 9.
    expect(b.v[0]).toBeCloseTo(2.5);
    expect(b.v[1]).toBeCloseTo(9);
  });

  it('skips unknown days in a mean and leaves a bucket with none as a gap', () => {
    const b = bucketFrame(
      frame(14, (i) => (i < 6 ? null : i % 2 === 0 ? null : i)),
      7,
    );
    expect(b.v[0]).toBeNull();
    expect(b.v[1]).toBeCloseTo((7 + 9 + 11) / 3);
  });

  it('does not change a series that fits', () => {
    const f = frame(40, (i) => i);
    expect(bucketFrame(f, 1)).toBe(f);
    expect(drawnSeries(f)).toBe(f);
  });

  it('draws a long history as weekly means, whole', () => {
    const f = frame(3100, () => 5);
    const d = drawnSeries(f);
    expect(d.t.length).toBeLessThanOrEqual(480);
    expect(d.span).toBe(7);
    expect(d.v.every((x) => x === 5)).toBe(true);
  });
});

describe('thinValues', () => {
  it('keeps a short run and averages a long one into n values', () => {
    expect(thinValues([1, 2, 3], 5)).toEqual([1, 2, 3]);
    const t = thinValues(
      Array.from({ length: 100 }, (_, i) => i),
      10,
    );
    expect(t).toHaveLength(10);
    expect(t[0]).toBeCloseTo(4.5);
    expect(t[9]).toBeCloseTo(94.5);
  });

  it('keeps a stretch with nothing known as a gap', () => {
    const v = [...Array.from({ length: 50 }, () => null), ...Array.from({ length: 50 }, (_, i) => i)];
    const t = thinValues(v, 10);
    expect(t.slice(0, 5).every((x) => x === null)).toBe(true);
    expect(t[9]).not.toBeNull();
  });
});

describe('resolveScale', () => {
  const series = (metric: SeriesFrame['metric'], v: (number | null)[]): SeriesFrame => ({
    metric,
    t: v.map((_, i) => D0 + i * DAY_MS),
    v,
    span: 1,
    trimmed: false,
  });
  const geometric = (n: number, from: number, to: number) =>
    Array.from({ length: n }, (_, i) => from * (to / from) ** (i / (n - 1)));

  it('goes to log by itself when a series spans orders of magnitude', () => {
    expect(resolveScale(series('transactions', geometric(60, 500, 45_000)), 'auto')).toBe('log');
    expect(resolveScale(series('difficulty', geometric(60, 0.08, 100_000)), 'auto')).toBe('log');
  });

  it('stays linear for a series that stays within a few times its size', () => {
    expect(resolveScale(series('transactions', geometric(60, 38_000, 47_000)), 'auto')).toBe('linear');
  });

  it('never takes the supply to log by itself, nor a short or gappy series', () => {
    expect(resolveScale(series('supply', geometric(60, 1_000, 430_000_000)), 'auto')).toBe('linear');
    expect(resolveScale(series('transactions', geometric(6, 10, 90_000)), 'auto')).toBe('linear');
    const gappy = geometric(60, 500, 45_000).map((x, i) => (i % 4 === 0 ? 0 : x));
    expect(resolveScale(series('transactions', gappy), 'auto')).toBe('linear');
  });

  it('does what the reader chose, as far as the data allows', () => {
    const flat = series('transactions', geometric(60, 40_000, 41_000));
    expect(resolveScale(flat, 'log')).toBe('log');
    expect(resolveScale(series('transactions', geometric(60, 500, 45_000)), 'linear')).toBe('linear');
    expect(resolveScale(series('transactions', [0, 0, null]), 'log')).toBe('linear');
  });
});

describe('logAxisFor', () => {
  it('spans whole powers of ten around the values', () => {
    const a = logAxisFor([500, 45_000, null, 3_000]);
    expect(a.lo).toBe(2);
    expect(a.hi).toBe(5);
    expect(a.ticks).toEqual([2, 3, 4, 5]);
    expect(a.step).toBe(1);
  });

  it('thins the ticks of a very wide range to about six', () => {
    const a = logAxisFor([0.07, 120_000_000]);
    expect(a.ticks.length).toBeLessThanOrEqual(7);
    expect(a.ticks[0]).toBe(a.lo);
    expect(a.ticks.at(-1)).toBe(a.hi);
    expect(a.step).toBeGreaterThan(1);
  });

  it('gives a flat series a decade, and nothing a default', () => {
    expect(logAxisFor([100, 100]).hi - logAxisFor([100, 100]).lo).toBe(1);
    expect(logAxisFor([null, 0])).toEqual({ lo: 0, hi: 1, ticks: [0, 1], step: 1 });
  });

  it('names a tick by its value', () => {
    expect(logTickText(-2)).toBe('0.01');
    expect(logTickText(2)).toBe('100');
    expect(logTickText(4)).toBe('10K');
    expect(logTickText(6)).toBe('1M');
  });
});

describe('headline', () => {
  it('reads the newest value of a per-day figure against the seven days before it', () => {
    const f = dailySeries(
      dto(Array.from({ length: 12 }, (_, i) => day(i, { transactions: i === 11 ? 55_000 : 40_000 }))),
      'transactions',
    );
    const h = headline(f);
    expect(h.value).toBe(55_000);
    expect(h.at).toBe(D0 + 11 * DAY_MS);
    expect(h.lapsed).toBe(false);
    expect(h.change?.kind).toBe('percent');
    expect(h.change?.value).toBeCloseTo(37.5);
  });

  it('says what the supply gained over thirty days', () => {
    const f = dailySeries(
      dto(Array.from({ length: 40 }, (_, i) => day(i, { supply: 400_000_000 + i * 40_000 }))),
      'supply',
    );
    const h = headline(f);
    expect(h.value).toBe(400_000_000 + 39 * 40_000);
    expect(h.change).toEqual({ kind: 'amount', value: 30 * 40_000, period: '30 days' });
  });

  it('keeps the last value of a figure that went unknown and says it lapsed', () => {
    const days = Array.from({ length: 10 }, (_, i) => day(i, { network_hash: i < 6 ? 1.5e8 + i : null }));
    const h = headline(dailySeries(dto(days), 'network_hash'));
    expect(h.value).toBe(1.5e8 + 5);
    expect(h.at).toBe(D0 + 5 * DAY_MS);
    expect(h.lapsed).toBe(true);
    expect(h.change).toBeNull();
  });

  it('has nothing to say about a series with no figure', () => {
    const h = headline(dailySeries(dto([day(0, { fees: null })]), 'fees'));
    expect(h).toEqual({ value: null, at: null, lapsed: false, change: null });
  });

  it('offers no comparison for difficulty, and none from too few days', () => {
    expect(headline(dailySeries(dto([day(0), day(1), day(2)]), 'difficulty')).change).toBeNull();
    expect(headline(dailySeries(dto([day(0), day(1), day(2)]), 'transactions')).change).toBeNull();
  });
});

describe('summaryOf', () => {
  const f = dailySeries(
    dto(
      Array.from({ length: 10 }, (_, i) =>
        day(i, { transactions: [40, 41, 39, 50, 43, 42, 44, 45, 47, 46][i]! * 1000 }),
      ),
      DAY_MS + 1,
    ),
    'transactions',
  );

  it('names the chart, its range, its ends and its extremes', () => {
    const s = summaryOf(f, 'linear', '30');
    expect(s).toContain('Transactions a day over the last 30 days, UTC.');
    expect(s).toContain('From 40,000 on 1 Sep 2026 to 46,000 on 10 Sep 2026.');
    expect(s).toContain('Highest 50,000 on 4 Sep 2026, lowest 39,000 on 3 Sep 2026.');
    expect(s).not.toContain('log scale');
  });

  it('says the scale is log, a mean of weeks, and what was left out', () => {
    const weeks = { ...f, span: 7, trimmed: true };
    const s = summaryOf(weeks, 'log', 'all');
    expect(s).toContain('as means of weeks');
    expect(s).toContain('over the whole chain');
    expect(s).toContain('Drawn on a log scale.');
    expect(s).toContain('The day still running is left out.');
  });

  it('puts units on FLUX figures and handles a series with no figure', () => {
    const fees = dailySeries(dto([day(0), day(1)]), 'fees');
    expect(summaryOf(fees, 'linear', '30')).toContain('0.020 FLUX');
    const none = dailySeries(dto([day(0, { fees: null })]), 'fees');
    expect(summaryOf(none, 'linear', '90')).toBe('Fees paid a day: no figures for the last 90 days.');
  });
});

describe('formats', () => {
  it('writes FLUX with the digits that mean something at its size', () => {
    expect(fluxText(1_234_567.8)).toBe('1,234,568');
    expect(fluxText(12.5)).toBe('12.50');
    expect(fluxText(0.0213)).toBe('0.021');
    expect(fluxText(0.00002)).toBe('0.00002');
    expect(fluxText(0)).toBe('0');
  });

  it('writes a hash rate in the biggest unit above 1', () => {
    expect(hashrateText(950)).toBe('950 H/s');
    expect(hashrateText(1.48e8)).toBe('148 MH/s');
    expect(hashrateText(1.5234e9)).toBe('1.52 GH/s');
  });

  it('reads every figure of the metrics table', () => {
    expect(METRICS.transactions.value(43_210.4)).toBe('43,210');
    expect(METRICS.supply.value(430_806_540.5)).toBe('430,806,541');
    expect(METRICS.supply.short(430_806_540.5)).toBe('430.8M');
    expect(METRICS.difficulty.value(0.0749)).toBe('0.075');
    expect(lastKnown([1, null, 3, null])).toBe(2);
    expect(lastKnown([null])).toBe(-1);
  });
});
