import { describe, expect, it } from 'vitest';
import type { BenchMetric } from '../../../../api/generated/BenchMetric';
import type { NodeBenchSpread } from '../../../../api/generated/NodeBenchSpread';
import type { Tier } from '../../../../api/generated/Tier';
import { benchModel, benchNumber, niceMax, presentMetrics } from './benchmarks';

const spread = (
  tier: Tier,
  metric: BenchMetric,
  p10: number,
  p50: number,
  p90: number,
  minimum: number | null,
  nodes = 1500,
): NodeBenchSpread => ({ tier, metric, p10, p50, p90, minimum, nodes });

const EPS = [
  spread('cumulus', 'eps', 104.7, 215.8, 407.3, 90),
  spread('nimbus', 'eps', 208.1, 341.3, 658.7, 180),
  spread('stratus', 'eps', 413.1, 540.1, 994.9, 360),
];

describe('niceMax', () => {
  it('rounds up to a scale top that splits into four clean marks', () => {
    expect(niceMax(1014.8)).toBe(1200);
    expect(niceMax(2296)).toBe(2400);
    expect(niceMax(812)).toBe(1000);
    expect(niceMax(0.9)).toBe(1);
    expect(niceMax(100)).toBe(100);
  });

  it('survives nothing to scale', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-4)).toBe(1);
  });
});

describe('benchNumber', () => {
  it('is whole above 100 and keeps one decimal below unless it is whole', () => {
    expect(benchNumber(1156.1)).toBe('1,156');
    expect(benchNumber(104.7)).toBe('105');
    expect(benchNumber(28.7)).toBe('28.7');
    expect(benchNumber(90)).toBe('90');
    expect(benchNumber(Number.NaN)).toBe('Unknown');
  });
});

describe('presentMetrics', () => {
  it('lists the metrics any node measured in the server order, once', () => {
    const list = [
      ...EPS,
      spread('stratus', 'up_mbps', 1, 2, 3, 100),
      spread('nimbus', 'disk_write_mbs', 1, 2, 3, 220),
    ];
    expect(presentMetrics(list).map((m) => m.id)).toEqual(['eps', 'disk_write_mbs', 'up_mbps']);
    expect(presentMetrics(undefined)).toEqual([]);
  });
});

describe('benchModel', () => {
  const m = benchModel(EPS, 'eps');

  it('orders the tiers smallest first on one scale', () => {
    expect(m?.rows.map((r) => r.tier)).toEqual(['cumulus', 'nimbus', 'stratus']);
    expect(m?.max).toBe(1200);
    // 994.9 / 1200 on the shared scale: the Stratus bar ends near the right edge, the Cumulus bar well short.
    expect(m?.rows[2]?.x90).toBeCloseTo(994.9 / 1200);
    expect(m?.rows[0]?.x90).toBeCloseTo(407.3 / 1200);
  });

  it('places the minimum on the same scale', () => {
    expect(m?.rows[0]?.xMin).toBeCloseTo(90 / 1200);
    expect(m?.rows[0]?.minimum).toBe(90);
  });

  it('marks the scale in quarters', () => {
    expect(m?.ticks.map((t) => t.text)).toEqual(['0', '300', '600', '900', '1,200']);
  });

  it('reads each row out in words, with the minimum', () => {
    expect(m?.rows[0]?.text).toBe(
      'Cumulus: 10th percentile 105, median 216, 90th percentile 407 events/s; the tier minimum is 90; measured on 1,500 nodes.',
    );
  });

  it('says how far above the minimum the typical node is', () => {
    expect(m?.reading).toBe(
      'The median node measures 2.4 times the minimum for Cumulus, 1.9 times for Nimbus and 1.5 times for Stratus.',
    );
  });

  it('notes a tier with a tenth of its nodes under the minimum', () => {
    const low = benchModel([spread('cumulus', 'eps', 80, 216, 407, 90)], 'eps');
    expect(low?.rows[0]?.tenthBelow).toBe(true);
    expect(low?.reading).toContain('At least a tenth of Cumulus nodes measure under it.');
    expect(m?.rows.some((r) => r.tenthBelow)).toBe(false);
  });

  it('draws a metric with no known minimum, and says nothing about one', () => {
    const none = benchModel([spread('cumulus', 'ram_gb', 8, 16, 32, null)], 'ram_gb');
    expect(none?.rows[0]?.xMin).toBeNull();
    expect(none?.rows[0]?.ratio).toBeNull();
    expect(none?.reading).toBe('');
  });

  it('is null for a metric no tier measured', () => {
    expect(benchModel(EPS, 'cores')).toBeNull();
    expect(benchModel(undefined, 'eps')).toBeNull();
  });
});
