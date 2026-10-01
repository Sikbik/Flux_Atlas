import { describe, expect, it } from 'vitest';
import { churnBuckets, windowChange } from './churn';
import type { MetricFrame } from './metrics';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Hourly samples from a day boundary: node_count rises by `perHour`, cumulus takes all of it. */
function frame(hours: number, perHour: number, start = 100 * DAY): MetricFrame {
  const t = Array.from({ length: hours }, (_, i) => start + i * HOUR);
  const total = t.map((_, i) => 1000 + i * perHour);
  return {
    t,
    v: {
      node_count: total,
      cumulus: total.map((x) => x - 500),
      nimbus: t.map(() => 300),
      stratus: t.map(() => 200),
    },
  };
}

describe('churnBuckets', () => {
  it('reports the net change per day, the first bucket against the first sample', () => {
    const b = churnBuckets(frame(48, 2), DAY);
    expect(b).toHaveLength(2);
    // Day 1: from the first sample (1000) to its last (1000 + 23*2).
    expect(b[0]!.net).toBe(46);
    // Day 2: 24 hours of +2 from the end of day 1.
    expect(b[1]!.net).toBe(48);
    expect(b[0]!.t).toBe(100 * DAY);
    expect(b[1]!.t).toBe(101 * DAY);
  });

  it('splits the change by tier and keeps unchanged tiers at zero', () => {
    const b = churnBuckets(frame(48, 2), DAY);
    expect(b[1]!.tiers.cumulus).toBe(48);
    expect(b[1]!.tiers.nimbus).toBe(0);
    expect(b[1]!.tiers.stratus).toBe(0);
  });

  it('aligns buckets to the epoch, not to the first sample', () => {
    const f = frame(10, 1, 100 * DAY + 5 * HOUR);
    const b = churnBuckets(f, DAY);
    expect(b).toHaveLength(1);
    expect(b[0]!.t).toBe(100 * DAY);
  });

  it('shows a loss as a negative bar', () => {
    const b = churnBuckets(frame(48, -1), DAY);
    expect(b[1]!.net).toBe(-24);
  });

  it('leaves a bucket with no sample unknown and bridges the gap in the next one', () => {
    const f = frame(72, 1);
    // Drop every sample of day 2.
    const keep = f.t.map((t) => t < 101 * DAY || t >= 102 * DAY);
    const g: MetricFrame = {
      t: f.t.filter((_, i) => keep[i]),
      v: Object.fromEntries(Object.entries(f.v).map(([k, col]) => [k, col.filter((_, i) => keep[i])])),
    };
    const b = churnBuckets(g, DAY);
    expect(b[1]!.net).toBeNull();
    // Day 3 spans the gap: from the end of day 1 to the end of day 3.
    expect(b[2]!.net).toBe(1000 + 71 - (1000 + 23));
  });

  it('returns nothing for an empty frame', () => {
    expect(churnBuckets({ t: [], v: {} }, DAY)).toEqual([]);
  });
});

describe('windowChange', () => {
  it('is the last known value minus the first', () => {
    expect(windowChange([null, 10, 12, null, 15, null])).toEqual({ from: 10, to: 15, change: 5 });
  });
  it('needs two known points', () => {
    expect(windowChange([null, 10, null])).toBeNull();
    expect(windowChange([])).toBeNull();
  });
});
