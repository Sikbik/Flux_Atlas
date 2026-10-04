import { describe, expect, it } from 'vitest';
import type { MetricFrame } from '../../../analytics/lib/metrics';
import { todaySoFar } from './today';

const H = 3_600_000;
const DAY = 24 * H;
const D = Date.UTC(2026, 9, 4); // 4 Oct 2026, 00:00 UTC

/** Hourly buckets from yesterday 00:00 to `until` (exclusive), each worth `f(hourIndexFromYesterday)`. */
function frame(until: number, f: (i: number) => number | null, name = 'tx_count'): MetricFrame {
  const t: number[] = [];
  const v: (number | null)[] = [];
  for (let ms = D - DAY, i = 0; ms < until; ms += H, i++) {
    t.push(ms);
    v.push(f(i));
  }
  return { t, v: { [name]: v } };
}

describe('todaySoFar', () => {
  it('adds the hours of today that are known and says where they run through', () => {
    // 14:30 UTC; the server has built the hours up to 12:00, the last two are null.
    const now = D + 14.5 * H;
    const fr = frame(D + 15 * H, (i) => (i < 24 + 12 ? 100 : null));
    const r = todaySoFar(fr, 'tx_count', now);
    expect(r.kind).toBe('today');
    expect(r.value).toBe(1200);
    expect(r.throughMs).toBe(D + 12 * H);
  });

  it('compares with the same hours yesterday', () => {
    const now = D + 10.2 * H;
    // Yesterday 100 an hour; today 110 an hour through 09:00.
    const fr = frame(D + 11 * H, (i) => (i < 24 ? 100 : i < 24 + 9 ? 110 : null));
    const r = todaySoFar(fr, 'tx_count', now);
    expect(r.value).toBe(990);
    expect(r.change).toBeCloseTo(10);
  });

  it('offers no comparison when an hour of yesterday is not known, or only an hour has passed', () => {
    const now = D + 10.2 * H;
    const hole = frame(D + 11 * H, (i) => (i === 3 ? null : i < 24 + 9 ? 100 : null));
    expect(todaySoFar(hole, 'tx_count', now).change).toBeNull();
    const early = frame(D + 2 * H, (i) => (i < 24 + 1 ? 100 : null));
    const r = todaySoFar(early, 'tx_count', D + 1.5 * H);
    expect(r.kind).toBe('today');
    expect(r.change).toBeNull();
  });

  it('stands yesterday in for today just after midnight, when nothing of today is in yet', () => {
    const now = D + 0.5 * H;
    const fr = frame(D + 1 * H, (i) => (i < 24 ? 50 : null));
    const r = todaySoFar(fr, 'tx_count', now);
    expect(r.kind).toBe('yesterday');
    expect(r.value).toBe(1200);
    expect(r.throughMs).toBe(D);
  });

  it('says nothing when there is nothing to say, and never turns unknown into zero', () => {
    expect(todaySoFar({ t: [], v: {} }, 'tx_count', D + H).kind).toBe('none');
    expect(
      todaySoFar(
        frame(D + 5 * H, () => null),
        'tx_count',
        D + 4 * H,
      ).kind,
    ).toBe('none');
    expect(
      todaySoFar(
        frame(D + 5 * H, () => 1),
        'fees_flux_f64',
        D + 4 * H,
      ).kind,
    ).toBe('none');
  });

  it('reads another series by its name', () => {
    const fr = frame(
      D + 6 * H,
      (i) => (i >= 24 && i < 24 + 4 ? 0.001 : i < 24 ? 0.001 : null),
      'fees_flux_f64',
    );
    const r = todaySoFar(fr, 'fees_flux_f64', D + 5 * H);
    expect(r.value).toBeCloseTo(0.004);
    expect(r.change).toBeCloseTo(0);
  });
});
