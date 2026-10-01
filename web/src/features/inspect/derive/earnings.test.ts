import { describe, expect, it } from 'vitest';
import { earningsFromPayments, earningsFromTotals, windowLabel } from './earnings';

const DAY = 86_400_000;
const NOW = 100 * DAY;
const num = (s: string) => Number(s);

describe('earningsFromPayments', () => {
  const pay = (daysAgo: number, amount: string) => ({ time_ms: NOW - daysAgo * DAY, amount });
  const payments = [pay(0.2, '9'), pay(3, '9'), pay(6.5, '3.5'), pay(20, '1'), pay(40, '100')];

  it('sums each window from the payments inside it', () => {
    const e = earningsFromPayments(payments, { nowMs: NOW, firstMs: 0, toFlux: num });
    expect(e.h24.flux).toBe(9);
    expect(e.d7.flux).toBe(21.5);
    expect(e.d30.flux).toBe(22.5);
    expect(e.d30.complete).toBe(true);
    expect(e.d7.estimate).toBe(false);
  });

  it('marks a window the ledger does not cover', () => {
    const e = earningsFromPayments(payments, { nowMs: NOW, firstMs: NOW - 10 * DAY, toFlux: num });
    expect(e.h24.complete).toBe(true);
    expect(e.d7.complete).toBe(true);
    expect(e.d30.complete).toBe(false);
  });

  it('leaves completeness unknown while the ledger start is unknown', () => {
    const e = earningsFromPayments(payments, { nowMs: NOW, firstMs: null, toFlux: num });
    expect(e.d30.complete).toBe(false);
  });
});

describe('earningsFromTotals', () => {
  it('passes the server totals through and flags short history', () => {
    const e = earningsFromTotals({ h24: 5, d30: 120, nowMs: NOW, firstMs: NOW - 12 * DAY });
    expect(e.h24).toEqual({ flux: 5, complete: true, estimate: false });
    expect(e.d30).toEqual({ flux: 120, complete: false, estimate: false });
  });

  it('takes the 30 day total as the week when the whole ledger is inside the week', () => {
    const e = earningsFromTotals({ h24: 1, d30: 4, nowMs: NOW, firstMs: NOW - 3 * DAY });
    expect(e.d7).toEqual({ flux: 4, complete: false, estimate: false });
  });

  it('scales the observed rate to a week otherwise and says it is an estimate', () => {
    const young = earningsFromTotals({ h24: 1, d30: 20, nowMs: NOW, firstMs: NOW - 10 * DAY });
    expect(young.d7.flux).toBeCloseTo(14, 9);
    expect(young.d7).toMatchObject({ estimate: true, complete: true });
    const old = earningsFromTotals({ h24: 1, d30: 60, nowMs: NOW, firstMs: NOW - 90 * DAY });
    expect(old.d7.flux).toBeCloseTo(14, 9);
  });

  it('prefers an exact week when one is given', () => {
    const e = earningsFromTotals({ h24: 1, d30: 60, d7: 13, nowMs: NOW, firstMs: 0 });
    expect(e.d7).toEqual({ flux: 13, complete: true, estimate: false });
  });

  it('does not invent a week from nothing', () => {
    expect(earningsFromTotals({ h24: null, d30: null, nowMs: NOW, firstMs: 0 }).d7.flux).toBeNull();
    expect(earningsFromTotals({ h24: 1, d30: 9, nowMs: NOW, firstMs: null }).d7.flux).toBeNull();
  });
});

describe('windowLabel', () => {
  it('adds the ledger note only to a cut window', () => {
    expect(windowLabel('30 days', { flux: 1, complete: true, estimate: false })).toBe('30 days');
    expect(windowLabel('30 days', { flux: 1, complete: false, estimate: false })).toBe(
      '30 days, since first ingest',
    );
    expect(windowLabel('30 days', { flux: null, complete: false, estimate: false })).toBe('30 days');
  });
});
