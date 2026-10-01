import { describe, expect, it } from 'vitest';
import { earningsFromPayments, earningsFromTotals, earningTiles, windowLabel } from './earnings';

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

describe('earningTiles', () => {
  const cut = (flux: number) => ({ flux, complete: false, estimate: false });
  const full = (flux: number) => ({ flux, complete: true, estimate: false });
  const names = ['24 hours', '7 days', '30 days'] as const;
  const tilesOf = (a: ReturnType<typeof cut>, b: ReturnType<typeof cut>, c: ReturnType<typeof cut>) =>
    earningTiles([
      [names[0], a],
      [names[1], b],
      [names[2], c],
    ]);

  it('says a young ledger once instead of three times', () => {
    const t = tilesOf(cut(10), cut(10), cut(10));
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ label: '24 hours', cut: true, merged: true });
  });

  it('keeps every window that has its own figure', () => {
    const t = tilesOf(full(10), full(70), full(300));
    expect(t.map((x) => x.label)).toEqual(names);
    expect(t.every((x) => !x.merged)).toBe(true);
  });

  it('merges only the windows cut to the same figure', () => {
    const t = tilesOf(full(10), cut(30), cut(30));
    expect(t.map((x) => x.label)).toEqual(['24 hours', '7 days']);
    expect(t[1]).toMatchObject({ merged: true });
    expect(t[0]).toMatchObject({ merged: false });
  });

  it('never merges an unknown or an estimated window', () => {
    const unknown = { flux: null, complete: false, estimate: false };
    const est = { flux: 5, complete: false, estimate: true };
    expect(
      earningTiles([
        [names[0], unknown],
        [names[1], unknown],
        [names[2], unknown],
      ]),
    ).toHaveLength(3);
    expect(
      earningTiles([
        [names[0], est],
        [names[1], est],
        [names[2], est],
      ]),
    ).toHaveLength(3);
  });

  it('keeps cut windows with different figures apart', () => {
    expect(tilesOf(cut(10), cut(10), cut(25)).map((x) => x.label)).toEqual(['24 hours', '30 days']);
  });
});
