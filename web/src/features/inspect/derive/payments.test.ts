import { describe, expect, it } from 'vitest';
import { paymentDays, windowTotals } from './payments';

const DAY = 86_400_000;
const num = (s: string) => Number(s);
const now = 10 * DAY + 5 * 3_600_000;

describe('paymentDays', () => {
  it('buckets payments by UTC day and marks unobserved days null', () => {
    const days = paymentDays(
      [
        { time_ms: 9 * DAY + 100, amount: '9' },
        { time_ms: 9 * DAY + 200, amount: '9' },
        { time_ms: 10 * DAY + 50, amount: '3.5' },
        { time_ms: 100, amount: '9' },
      ],
      { nowMs: now, days: 4, firstMs: 8 * DAY + 1_000, toFlux: num },
    );
    expect(days.map((d) => d.flux)).toEqual([null, 0, 18, 3.5]);
    expect(days.map((d) => d.count)).toEqual([0, 0, 2, 1]);
    expect(days[3]!.dayMs).toBe(10 * DAY);
  });

  it('treats everything as unobserved when there is no history yet', () => {
    const days = paymentDays([], { nowMs: now, days: 3, firstMs: null, toFlux: num });
    expect(days.every((d) => d.flux === null)).toBe(true);
  });
});

describe('windowTotals', () => {
  it('sums the trailing window and says whether the history covers it', () => {
    const pays = [
      { time_ms: now - 1_000, amount: '9' },
      { time_ms: now - 2 * DAY, amount: '9' },
      { time_ms: now - 40 * DAY, amount: '9' },
    ];
    const w = windowTotals(pays, { nowMs: now, windowMs: 30 * DAY, firstMs: now - 3 * DAY, toFlux: num });
    expect(w).toEqual({ count: 2, flux: 18, complete: false });
    expect(
      windowTotals(pays, { nowMs: now, windowMs: 30 * DAY, firstMs: now - 31 * DAY, toFlux: num }).complete,
    ).toBe(true);
    expect(windowTotals([], { nowMs: now, windowMs: DAY, firstMs: null, toFlux: num }).complete).toBe(false);
  });
});

describe('payments with their parallel assets', () => {
  // Each payment as the server sends it: the main-chain amount and what it accrued beside it.
  const pays = [
    { time_ms: now - 1_000, amount: '9', pa: '9' },
    { time_ms: now - 2 * DAY, amount: '9', pa: '9' },
    { time_ms: 9 * DAY + 100, amount: '3.5', pa: '3.5' },
  ];

  it('counts both when parallel assets count, and the main chain alone otherwise', () => {
    const opts = { nowMs: now, windowMs: 30 * DAY, firstMs: 0, toFlux: num };
    expect(windowTotals(pays, { ...opts, includePa: true })).toEqual({ count: 3, flux: 43, complete: false });
    expect(windowTotals(pays, { ...opts, includePa: false }).flux).toBe(21.5);
    // Without the option a payment is its main-chain amount, as before.
    expect(windowTotals(pays, opts).flux).toBe(21.5);
  });

  it('draws the days on the same basis', () => {
    const opts = { nowMs: now, days: 3, firstMs: 0, toFlux: num };
    expect(paymentDays(pays, { ...opts, includePa: true }).map((d) => d.flux)).toEqual([18, 7, 18]);
    expect(paymentDays(pays, { ...opts, includePa: false }).map((d) => d.flux)).toEqual([9, 3.5, 9]);
  });
});
