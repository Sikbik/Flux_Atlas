import { describe, expect, it } from 'vitest';
import type { ChainDailyDto } from '../../../../api/generated/ChainDailyDto';
import type { ChainDay } from '../../../../api/generated/ChainDay';
import {
  BLOCKS_PER_DAY_PON,
  BLOCKS_PER_DAY_POW,
  blockSeconds,
  bucketFrame,
  completeValues,
  DAILY_RANGES,
  DAY_MS,
  dailySeries,
  drawnSeries,
  expectedBlocks,
  fluxText,
  hashrateText,
  headline,
  isRunningDay,
  lastKnown,
  legacyMining,
  legacyNote,
  logAxisFor,
  logTickText,
  METRICS,
  PON_ACTIVATION_MS,
  pickBucketSize,
  rangePhrase,
  resolveScale,
  type SeriesFrame,
  summaryOf,
  thinValues,
} from './daily';

const D0 = Date.UTC(2026, 8, 1); // a Tuesday

function day(i: number, over: Partial<ChainDay> = {}): ChainDay {
  return {
    day_ms: D0 + i * DAY_MS,
    transactions: 40_000 + i,
    blocks: 2880,
    fees: 0.00004,
    fees_total: 0.12 + i / 1000,
    outputs: 3_000_000,
    supply: 430_000_000 + i * 40_320,
    difficulty: 0.1,
    network_hash: 3.66e10,
    ...over,
  };
}

/** A payload built `generatedAfterLast` ms after the start of its last day (a day and a minute: the day is over). */
function dto(days: ChainDay[], generatedAfterLast = DAY_MS + 60_000): ChainDailyDto {
  const last = days.at(-1)?.day_ms ?? D0;
  return { generated_ms: last + generatedAfterLast, first_day_ms: days[0]?.day_ms ?? null, days };
}

describe('the ranges', () => {
  it('names the longest range two years, never the whole chain', () => {
    expect(DAILY_RANGES.map((r) => r.label)).toEqual(['30D', '90D', '1Y', '2Y']);
    expect(rangePhrase('all')).toBe('the last two years, all that Insight keeps');
    expect(rangePhrase('all')).not.toMatch(/whole chain|genesis/);
  });
});

describe('isRunningDay', () => {
  it('is true for a day the payload was built in, false once the day is over', () => {
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
    expect(s.running).toBe(false);
    expect(s.trimmed).toBe(false);
  });

  it('charts the fees a day from the total, never from the average per block', () => {
    const s = dailySeries(dto([day(0, { fees: 0.00004231, fees_total: 0.1218 })]), 'fees');
    expect(s.v).toEqual([0.1218]);
    expect(METRICS.fees.field).toBe('fees_total');
  });

  it('flags the day so far on a per-day figure, and not on a standing one', () => {
    const running = dto([day(0), day(1), day(2)], 3 * 3_600_000);
    expect(dailySeries(running, 'transactions').running).toBe(true);
    expect(dailySeries(running, 'blocks').running).toBe(true);
    expect(dailySeries(running, 'supply').running).toBe(false);
    expect(dailySeries(running, 'transactions').t).toHaveLength(3);
  });

  it('never turns a missing figure into a zero', () => {
    const s = dailySeries(dto([day(0, { fees_total: null }), day(1, { fees_total: Number.NaN })]), 'fees');
    expect(s.v).toEqual([null, null]);
  });

  it('gives the whole days of a series with a partial last one', () => {
    const s = dailySeries(dto([day(0), day(1), day(2)], 3 * 3_600_000), 'transactions');
    expect(completeValues(s)).toEqual([40_000, 40_001]);
    const whole = dailySeries(dto([day(0), day(1)]), 'transactions');
    expect(completeValues(whole)).toEqual([40_000, 40_001]);
  });
});

describe('pickBucketSize and bucketFrame', () => {
  it('draws up to 800 days a day, which holds the two years the server keeps', () => {
    expect(pickBucketSize(30)).toBe(1);
    expect(pickBucketSize(365)).toBe(1);
    expect(pickBucketSize(730)).toBe(1);
    expect(pickBucketSize(800)).toBe(1);
    expect(pickBucketSize(801)).toBe(7);
    expect(pickBucketSize(5000)).toBe(7);
    expect(pickBucketSize(5700)).toBe(14);
  });

  const frame = (n: number, f: (i: number) => number | null, running = false): SeriesFrame => ({
    metric: 'transactions',
    t: Array.from({ length: n }, (_, i) => D0 + i * DAY_MS),
    v: Array.from({ length: n }, (_, i) => f(i)),
    span: 1,
    running,
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
    const two = frame(730, () => 5, true);
    expect(drawnSeries(two)).toBe(two);
  });

  it('draws a longer history as weekly means, without the day so far that would pull a week down', () => {
    const f = frame(3100, () => 5, true);
    const d = drawnSeries(f);
    expect(d.t.length).toBeLessThanOrEqual(800);
    expect(d.span).toBe(7);
    expect(d.running).toBe(false);
    expect(d.trimmed).toBe(true);
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
  const series = (metric: SeriesFrame['metric'], v: (number | null)[], running = false): SeriesFrame => ({
    metric,
    t: v.map((_, i) => D0 + i * DAY_MS),
    v,
    span: 1,
    running,
    trimmed: false,
  });
  const geometric = (n: number, from: number, to: number) =>
    Array.from({ length: n }, (_, i) => from * (to / from) ** (i / (n - 1)));

  it('goes to log by itself when a series spans orders of magnitude', () => {
    expect(resolveScale(series('transactions', geometric(60, 500, 45_000)), 'auto')).toBe('log');
    expect(resolveScale(series('fees', geometric(60, 0.001, 0.9)), 'auto')).toBe('log');
  });

  it('stays linear for a series that stays within a few times its size', () => {
    expect(resolveScale(series('transactions', geometric(60, 38_000, 47_000)), 'auto')).toBe('linear');
  });

  it('does not let the day so far, low by nature, take a steady series to log', () => {
    const v = [...geometric(59, 40_000, 44_000), 900];
    expect(resolveScale(series('transactions', v, true), 'auto')).toBe('linear');
    expect(resolveScale(series('transactions', v, false), 'auto')).toBe('log');
  });

  it('never takes the supply or the block count to log by itself, nor a short or gappy series', () => {
    expect(resolveScale(series('supply', geometric(60, 1_000, 430_000_000)), 'auto')).toBe('linear');
    expect(resolveScale(series('blocks', geometric(60, 10, 2880)), 'auto')).toBe('linear');
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
  it('reads the newest whole day of a per-day figure against the seven days before it', () => {
    const f = dailySeries(
      dto(Array.from({ length: 12 }, (_, i) => day(i, { transactions: i === 11 ? 55_000 : 40_000 }))),
      'transactions',
    );
    const h = headline(f);
    expect(h.value).toBe(55_000);
    expect(h.at).toBe(D0 + 11 * DAY_MS);
    expect(h.change?.kind).toBe('percent');
    expect(h.change?.value).toBeCloseTo(37.5);
  });

  it('skips the day so far: yesterday is the newest day with a whole figure', () => {
    const days = Array.from({ length: 12 }, (_, i) => day(i, { transactions: i === 11 ? 3_000 : 40_000 }));
    const f = dailySeries(dto(days, 2 * 3_600_000), 'transactions');
    const h = headline(f);
    expect(h.value).toBe(40_000);
    expect(h.at).toBe(D0 + 10 * DAY_MS);
    expect(h.change?.value).toBeCloseTo(0);
  });

  it('says what the supply gained since the range began', () => {
    const f = dailySeries(
      dto(Array.from({ length: 40 }, (_, i) => day(i, { supply: 400_000_000 + i * 40_000 }))),
      'supply',
    );
    const h = headline(f);
    expect(h.value).toBe(400_000_000 + 39 * 40_000);
    expect(h.change).toEqual({ kind: 'amount', value: 39 * 40_000, period: '39 days' });
  });

  it('offers no supply comparison for a range of under a week', () => {
    const f = dailySeries(dto([day(0), day(1), day(2)]), 'supply');
    expect(headline(f).change).toBeNull();
  });

  it('offers no comparison for the block count, which is a schedule, and none from too few days', () => {
    const days = Array.from({ length: 12 }, (_, i) => day(i));
    expect(headline(dailySeries(dto(days), 'blocks')).change).toBeNull();
    expect(headline(dailySeries(dto([day(0), day(1), day(2)]), 'transactions')).change).toBeNull();
  });

  it('has nothing to say about a series with no figure', () => {
    const h = headline(dailySeries(dto([day(0, { fees_total: null })]), 'fees'));
    expect(h).toEqual({ value: null, at: null, change: null });
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

  it('says the scale is log, a mean of weeks, and what was drawn partial or left out', () => {
    const weeks = { ...f, span: 7, trimmed: true };
    const s = summaryOf(weeks, 'log', 'all');
    expect(s).toContain('as means of weeks');
    expect(s).toContain('over the last two years, all that Insight keeps');
    expect(s).toContain('Drawn on a log scale.');
    expect(s).toContain('The day still running is left out.');
    expect(summaryOf({ ...f, running: true }, 'linear', '30')).toContain('today so far');
  });

  it('puts units on FLUX figures and handles a series with no figure', () => {
    const fees = dailySeries(dto([day(0, { fees_total: 0.02 }), day(1, { fees_total: 0.02 })]), 'fees');
    expect(summaryOf(fees, 'linear', '30')).toContain('0.020 FLUX');
    const none = dailySeries(dto([day(0, { fees_total: null })]), 'fees');
    expect(summaryOf(none, 'linear', '90')).toBe('Fees paid a day: no figures for the last 90 days.');
  });
});

describe('blocks a day', () => {
  it('reads the seconds between blocks off the count, and nothing off an unknown one', () => {
    expect(blockSeconds(2880)).toBeCloseTo(30);
    expect(blockSeconds(2700)).toBeCloseTo(32);
    expect(blockSeconds(0)).toBeNull();
    expect(blockSeconds(null)).toBeNull();
  });

  it('expects 720 blocks on the days of 120 second blocks and 2,880 since Proof of Node', () => {
    expect(expectedBlocks(PON_ACTIVATION_MS - 2 * DAY_MS)).toBe(BLOCKS_PER_DAY_POW);
    expect(expectedBlocks(PON_ACTIVATION_MS + 2 * DAY_MS)).toBe(BLOCKS_PER_DAY_PON);
  });
});

describe('the mining years', () => {
  const pow = (i: number, over: Partial<ChainDay> = {}) =>
    day(0, {
      day_ms: PON_ACTIVATION_MS - (10 - i) * DAY_MS,
      difficulty: 50_000 + i,
      network_hash: 3e6 + i,
      ...over,
    });

  it('finds the last day of mining the payload holds, and none when the range starts later', () => {
    const l = legacyMining(dto([pow(0), pow(1), day(0), day(1)]));
    expect(l?.difficulty).toBe(50_001);
    expect(l?.networkHash).toBe(3e6 + 1);
    expect(l && l.dayMs + DAY_MS <= PON_ACTIVATION_MS).toBe(true);
    expect(legacyMining(dto([day(0), day(1)]))).toBeNull();
    expect(legacyMining(dto([]))).toBeNull();
  });

  it('skips a mining day with neither figure', () => {
    const l = legacyMining(dto([pow(0), pow(1, { difficulty: null, network_hash: null })]));
    expect(l?.difficulty).toBe(50_000);
  });

  it('tells the story without charting it', () => {
    const none = legacyNote(null);
    expect(none).toMatch(/Mining ended when Proof of Node began on 25 Oct 2025/);
    expect(none).toMatch(/no longer measure mining work/);
    const l = legacyNote(legacyMining(dto([pow(0), pow(1)])));
    expect(l).toMatch(/the last whole day of mining in this range/);
    expect(l).toMatch(/Msol\/s/);
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

  it('writes a solution rate in the biggest unit above 1', () => {
    expect(hashrateText(950)).toBe('950 sol/s');
    expect(hashrateText(1.48e8)).toBe('148 Msol/s');
    expect(hashrateText(3.66e10)).toBe('36.6 Gsol/s');
  });

  it('reads every figure of the metrics table', () => {
    expect(METRICS.transactions.value(43_210.4)).toBe('43,210');
    expect(METRICS.supply.value(430_806_540.5)).toBe('430,806,541');
    expect(METRICS.supply.short(430_806_540.5)).toBe('430.8M');
    expect(METRICS.blocks.value(2879.6)).toBe('2,880');
    expect(lastKnown([1, null, 3, null])).toBe(2);
    expect(lastKnown([null])).toBe(-1);
  });
});
