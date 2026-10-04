import { describe, expect, it } from 'vitest';
import type { EarningsDay, PaClaim, PricePoint, PricesDto } from '../types';
import {
  buildDaily,
  claimsCsv,
  dailyCsv,
  effectiveRange,
  isCompleteDay,
  isEarningsRange,
  missedRows,
  PAYMENT_VERDICT,
  parallelRatio,
  paymentHealth,
  rangesFor,
  sliceDays,
  totalsOf,
  wholeDays,
} from './earnings';
import { DAY_MS } from './money';

const START = Date.UTC(2026, 8, 1);

const spot: PricesDto['spot'] = {
  usd: 0.08,
  eur: 0.072,
  gbp: 0.06,
  aud: 0.12,
  cad: 0.11,
  chf: 0.07,
  jpy: 12,
  cny: 0.58,
  inr: 6.6,
  krw: 106,
  sgd: 0.107,
  hkd: 0.62,
  thb: 2.9,
  myr: 0.38,
  idr: 1260,
  btc: 0.000001,
};

const history: PricePoint[] = Array.from({ length: 40 }, (_, i) => ({
  day_ms: START + i * DAY_MS,
  usd: 0.05 + i * 0.001,
}));

/** `n` days from START, 3,000 FLUX a day of Stratus. */
function days(n: number): EarningsDay[] {
  return Array.from({ length: n }, (_, i) => ({
    day_ms: START + i * DAY_MS,
    native: '3000.00000000',
    payments: 333,
    cumulus: '0.00000000',
    nimbus: '0.00000000',
    stratus: '3000.00000000',
  }));
}

describe('sliceDays', () => {
  const all = days(30);
  it('keeps the newest days of a range', () => {
    expect(sliceDays(all, '7d')).toHaveLength(7);
    expect(sliceDays(all, '7d')[6]).toBe(all[29]);
    expect(sliceDays(all, '14d')).toHaveLength(14);
  });

  it('keeps every day for all, and copes with fewer days than asked', () => {
    expect(sliceDays(all, 'all')).toHaveLength(30);
    expect(sliceDays(days(5), '7d')).toHaveLength(5);
    expect(sliceDays([], '7d')).toEqual([]);
  });

  it('knows its ranges', () => {
    expect(isEarningsRange('14d')).toBe(true);
    expect(isEarningsRange('30d')).toBe(false);
    expect(isEarningsRange('90d')).toBe(false);
  });
});

describe('ranges that fit the data', () => {
  it('offers a range only when the data is longer than it', () => {
    expect(rangesFor(30).map((r) => r.value)).toEqual(['7d', '14d', 'all']);
    expect(rangesFor(14).map((r) => r.value)).toEqual(['7d', 'all']);
    expect(rangesFor(8).map((r) => r.value)).toEqual(['7d', 'all']);
    expect(rangesFor(7).map((r) => r.value)).toEqual(['all']);
    expect(rangesFor(0).map((r) => r.value)).toEqual(['all']);
  });

  it('falls back to all when the stored range is not offered', () => {
    expect(effectiveRange('14d', 30)).toBe('14d');
    expect(effectiveRange('14d', 10)).toBe('all');
    expect(effectiveRange('7d', 3)).toBe('all');
    expect(effectiveRange('all', 30)).toBe('all');
  });
});

describe('parallelRatio', () => {
  it('is the parallel run-rate over the native one', () => {
    expect(parallelRatio(3024, 3024)).toBe(1);
    expect(parallelRatio(3000, 2910)).toBeCloseTo(0.97, 12);
  });

  it('is zero when either is nothing, and capped for a bad feed', () => {
    expect(parallelRatio(0, 5)).toBe(0);
    expect(parallelRatio(5, 0)).toBe(0);
    expect(parallelRatio(1, 5000)).toBe(10);
  });
});

describe('buildDaily', () => {
  const now = START + 10 * DAY_MS + 6 * 3_600_000;
  // The stored blocks begin at the start of the first day: a whole first day.
  const base = {
    days: days(11),
    coveredFromMs: START as number | null,
    ratio: 0.97,
    history,
    spot,
    currency: 'usd' as const,
    nowMs: now,
  };

  it('lays the days out as columns, tiers apart', () => {
    const d = buildDaily(base);
    expect(d.t).toHaveLength(11);
    expect(d.stratus[0]).toBe(3000);
    expect(d.cumulus[0]).toBe(0);
    expect(d.native[0]).toBe(3000);
    expect(d.payments[0]).toBe(333);
  });

  it('estimates the parallel assets from the ratio', () => {
    expect(buildDaily(base).pa[0]).toBeCloseTo(2910, 9);
  });

  it("values each day at its own price, not today's", () => {
    const d = buildDaily(base);
    expect(d.price[0]).toBeCloseTo(0.05, 12);
    expect(d.price[10]).toBeCloseTo(0.06, 12);
    expect(d.value[0]).toBeCloseTo(3000 * 0.05, 9);
    expect(d.value[10]).toBeCloseTo(3000 * 0.06, 9);
    expect(d.valueWithPa[0]).toBeCloseTo((3000 + 2910) * 0.05, 9);
    expect(d.approximate).toBe(false);
  });

  it("draws another currency from the dollar price at today's rate, and says so", () => {
    const d = buildDaily({ ...base, currency: 'eur' });
    expect(d.price[0]).toBeCloseTo((0.05 * 0.072) / 0.08, 12);
    expect(d.approximate).toBe(true);
  });

  it('has no value without a price', () => {
    const d = buildDaily({ ...base, history: [] });
    expect(d.price[0]).toBeNull();
    expect(d.value[0]).toBeNull();
    expect(d.valueWithPa[0]).toBeNull();
  });

  it('knows when the last day is still running', () => {
    expect(buildDaily(base).partialLast).toBe(true);
    expect(buildDaily({ ...base, nowMs: START + 12 * DAY_MS }).partialLast).toBe(false);
    expect(buildDaily({ ...base, days: [] }).partialLast).toBe(false);
  });

  it('knows when the stored blocks begin part way through the first day', () => {
    expect(buildDaily(base).partialFirst).toBe(false);
    // Covered from 14:20 on the first day: that day is partial.
    expect(buildDaily({ ...base, coveredFromMs: START + 14 * 3_600_000 + 1_200_000 }).partialFirst).toBe(
      true,
    );
    // Within the first hour counts as a whole day.
    expect(buildDaily({ ...base, coveredFromMs: START + 20 * 60_000 }).partialFirst).toBe(false);
    // A range that dropped the first day has no partial first day, whatever the window began.
    expect(
      buildDaily({
        ...base,
        days: days(11).slice(3),
        coveredFromMs: START + 14 * 3_600_000,
      }).partialFirst,
    ).toBe(false);
    expect(buildDaily({ ...base, coveredFromMs: null }).partialFirst).toBe(false);
  });

  it('says which days are whole', () => {
    const d = buildDaily({ ...base, coveredFromMs: START + 14 * 3_600_000 });
    expect(isCompleteDay(d, 0)).toBe(false);
    expect(isCompleteDay(d, 1)).toBe(true);
    expect(isCompleteDay(d, 9)).toBe(true);
    expect(isCompleteDay(d, 10)).toBe(false);
  });
});

describe('wholeDays', () => {
  const now = START + 10 * DAY_MS + 6 * 3_600_000;
  const list = days(11);

  it('drops the running day and a partial first day', () => {
    const w = wholeDays(list, START + 15 * 3_600_000, now);
    expect(w).toHaveLength(9);
    expect(w[0]).toBe(list[1]);
    expect(w[8]).toBe(list[9]);
  });

  it('keeps a first day the window covers whole', () => {
    expect(wholeDays(list, START, now)).toHaveLength(10);
    expect(wholeDays(list, START + 20 * 60_000, now)).toHaveLength(10);
    expect(wholeDays(list, null, now)).toHaveLength(10);
  });

  it('keeps the last day once it has ended', () => {
    expect(wholeDays(list, START, START + 12 * DAY_MS)).toHaveLength(11);
  });

  it('leaves nothing when every day is partial or there are none', () => {
    expect(wholeDays(days(1), START + 9 * 3_600_000, START + 12 * 3_600_000)).toEqual([]);
    expect(wholeDays(days(2), START + 9 * 3_600_000, START + DAY_MS + 3_600_000)).toEqual([]);
    expect(wholeDays([], START, now)).toEqual([]);
  });
});

describe('totalsOf', () => {
  const now = START + 10 * DAY_MS + 6 * 3_600_000;
  const input = {
    days: days(11),
    coveredFromMs: START as number | null,
    ratio: 1,
    history,
    spot,
    currency: 'usd' as const,
    nowMs: now,
  };

  it('adds the days up', () => {
    const t = totalsOf(buildDaily(input));
    expect(t.native).toBe(33_000);
    expect(t.pa).toBe(33_000);
    expect(t.payments).toBe(3663);
    expect(t.value).toBeGreaterThan(0);
  });

  it('averages only whole days, so a running day does not drag it down', () => {
    const list = days(11);
    list[10] = { ...(list[10] as EarningsDay), native: '700.00000000' };
    const t = totalsOf(buildDaily({ ...input, days: list }));
    expect(t.average).toBe(3000);
    expect(t.completeDays).toBe(10);
    expect(t.native).toBe(30_700);
  });

  it('leaves the partial first day out of the average too', () => {
    const list = days(11);
    list[0] = { ...(list[0] as EarningsDay), native: '1200.00000000' };
    list[10] = { ...(list[10] as EarningsDay), native: '700.00000000' };
    const t = totalsOf(buildDaily({ ...input, days: list, coveredFromMs: START + 15 * 3_600_000 }));
    expect(t.average).toBe(3000);
    expect(t.completeDays).toBe(9);
    // The totals still count everything that was paid.
    expect(t.native).toBe(1200 + 9 * 3000 + 700);
  });

  it('finds the best whole day', () => {
    const list = days(11);
    list[4] = { ...(list[4] as EarningsDay), native: '3600.00000000' };
    list[10] = { ...(list[10] as EarningsDay), native: '9000.00000000' };
    const t = totalsOf(buildDaily({ ...input, days: list }));
    expect(t.best).toEqual({ t: START + 4 * DAY_MS, native: 3600 });
  });

  it('has no average or best day while there is no whole day', () => {
    // One partial day only: the window began mid-day and today is still running.
    const one = days(1);
    const t = totalsOf(
      buildDaily({
        ...input,
        days: one,
        coveredFromMs: START + 9 * 3_600_000,
        nowMs: START + 12 * 3_600_000,
      }),
    );
    expect(t.native).toBe(3000);
    expect(t.average).toBeNull();
    expect(t.best).toBeNull();
    expect(t.completeDays).toBe(0);
  });

  it('is empty for no days', () => {
    const t = totalsOf(buildDaily({ ...input, days: [] }));
    expect(t).toEqual({
      native: 0,
      pa: 0,
      payments: 0,
      value: null,
      average: null,
      best: null,
      completeDays: 0,
    });
  });
});

describe('paymentHealth', () => {
  it('compares received with expected', () => {
    const h = paymentHealth({ expected_payments: 1244, received_payments: 1210 });
    expect(h.rate).toBeCloseTo(1210 / 1244, 12);
    expect(h.shortfall).toBe(34);
    expect(h.verdict).toBe('minor');
  });

  it('grades the rate', () => {
    const v = (e: number, r: number) => paymentHealth({ expected_payments: e, received_payments: r }).verdict;
    expect(v(100, 103)).toBe('ahead');
    expect(v(100, 100)).toBe('on-track');
    expect(v(100, 99)).toBe('on-track');
    expect(v(100, 96)).toBe('minor');
    expect(v(100, 90)).toBe('attention');
    expect(v(100, 70)).toBe('poor');
    expect(v(0, 0)).toBe('unknown');
  });

  it('never reports a negative shortfall', () => {
    expect(paymentHealth({ expected_payments: 10, received_payments: 12 }).shortfall).toBe(0);
  });

  it('has words for every verdict', () => {
    for (const k of Object.keys(PAYMENT_VERDICT))
      expect(PAYMENT_VERDICT[k as keyof typeof PAYMENT_VERDICT].label.length).toBeGreaterThan(3);
  });
});

describe('missedRows', () => {
  it('lists the nodes paid short, the biggest shortfall first, with their share', () => {
    const rows = missedRows([
      { node_key: 'a:0', expected: 10, received: 9 },
      { node_key: 'b:0', expected: 10, received: 5 },
      { node_key: 'c:0', expected: 10, received: 10 },
      { node_key: 'd:0', expected: 10, received: 12 },
    ]);
    expect(rows.map((r) => r.key)).toEqual(['b:0', 'a:0']);
    expect(rows[0]?.shortfall).toBe(5);
    expect(rows[0]?.share).toBeCloseTo(5 / 6, 12);
    expect(rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 12);
  });

  it('is empty when nobody is short', () => {
    expect(missedRows([])).toEqual([]);
  });
});

describe('dailyCsv', () => {
  const now = START + 10 * DAY_MS + 6 * 3_600_000;
  const base = {
    days: days(3),
    coveredFromMs: START as number | null,
    ratio: 1,
    history,
    spot,
    currency: 'usd' as const,
    nowMs: now,
  };

  it('writes a row a day with the tiers, the price that day and the value', () => {
    const d = buildDaily(base);
    const { header, rows } = dailyCsv(d, 'usd', history, spot);
    expect(header).toEqual([
      'date_utc',
      'native_flux',
      'cumulus_flux',
      'nimbus_flux',
      'stratus_flux',
      'payments',
      'parallel_assets_flux_estimate',
      'price_usd_that_day',
      'native_value_usd',
      'native_and_parallel_value_usd',
      'partial_day',
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual(['2026-09-01', 3000, 0, 0, 3000, 333, 3000, 0.05, 150, 300, false]);
    expect(rows.every((r) => r.length === header.length)).toBe(true);
  });

  it("adds the viewer's currency, marked approximate, when it is not dollars", () => {
    const d = buildDaily({ ...base, currency: 'eur' });
    const { header, rows } = dailyCsv(d, 'eur', history, spot);
    expect(header).toContain('price_eur_that_day_approximate');
    expect(header).toContain('native_value_eur_approximate');
    expect(rows.every((r) => r.length === header.length)).toBe(true);
    const at = (h: string) => (rows[0] as unknown[])[header.indexOf(h)];
    expect(at('price_usd_that_day')).toBe(0.05);
    expect(at('price_eur_that_day_approximate')).toBeCloseTo((0.05 * 0.072) / 0.08, 12);
  });

  it('leaves a value empty where there was no price', () => {
    const d = buildDaily({ ...base, history: [] });
    const { header, rows } = dailyCsv(d, 'usd', [], spot);
    expect((rows[0] as unknown[])[header.indexOf('price_usd_that_day')]).toBeNull();
    expect((rows[0] as unknown[])[header.indexOf('native_value_usd')]).toBeNull();
  });

  it('marks the running day and a partial first day', () => {
    const d = buildDaily({ ...base, days: days(11), coveredFromMs: START + 15 * 3_600_000 });
    const { header, rows } = dailyCsv(d, 'usd', history, spot);
    const at = (i: number) => (rows[i] as unknown[])[header.indexOf('partial_day')];
    expect(at(0)).toBe(true);
    expect(at(1)).toBe(false);
    expect(at(9)).toBe(false);
    expect(at(10)).toBe(true);
  });
});

describe('claimsCsv', () => {
  const claims: PaClaim[] = [
    {
      chain: 'eth',
      amount: 1250.5,
      txid: '0xabc',
      to: '0xdef',
      explorer_url: 'https://etherscan.io/tx/0xabc',
      time_ms: Date.UTC(2026, 9, 1, 8, 30, 0),
      main_txid: null,
      fee: 12,
    },
    {
      chain: 'kda',
      amount: 80,
      txid: 'k1',
      to: 'k:abc',
      explorer_url: null,
      time_ms: null,
      main_txid: null,
      fee: 0,
    },
    {
      chain: 'flux',
      amount: 5000,
      txid: `flux:${'b'.repeat(64)}`,
      to: 't3abc',
      explorer_url: `https://explorer.runonflux.io/tx/${'b'.repeat(64)}`,
      time_ms: Date.UTC(2026, 9, 2, 0, 0, 0),
      main_txid: 'b'.repeat(64),
      fee: 20,
    },
  ];

  it('writes a row per claim, empty where a time or link is not known', () => {
    const { header, rows } = claimsCsv(claims);
    expect(header).toEqual([
      'time_utc',
      'chain',
      'amount_flux',
      'fee_flux',
      'transaction',
      'main_chain_txid',
      'to_address',
      'explorer_url',
    ]);
    expect(rows[0]).toEqual([
      '2026-10-01 08:30:00',
      'eth',
      1250.5,
      12,
      '0xabc',
      null,
      '0xdef',
      'https://etherscan.io/tx/0xabc',
    ]);
    expect(rows[1]).toEqual([null, 'kda', 80, 0, 'k1', null, 'k:abc', null]);
  });

  it('carries the Flux transaction of a claim-all', () => {
    const { rows } = claimsCsv(claims);
    expect(rows[2]?.[5]).toBe('b'.repeat(64));
    expect(rows[2]?.[3]).toBe(20);
  });
});
