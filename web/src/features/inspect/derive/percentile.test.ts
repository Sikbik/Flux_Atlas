import { describe, expect, it } from 'vitest';
import { encodeSyntheticNodesBin } from '../../../api/bin/writer';
import { decodeNodesBin } from '../../../api/nodesBin';
import { NodeTable } from '../../../store/nodeTable';
import { describePercentile, medianOf, percentileOf, tierColumn } from './percentile';

describe('percentileOf', () => {
  const sorted = [2, 4, 4, 8, 16];
  it('uses mid-rank percentiles', () => {
    expect(percentileOf(sorted, 2)).toBeCloseTo(10, 6); // 0 below + half of 1 equal
    expect(percentileOf(sorted, 4)).toBeCloseTo(((1 + 1) / 5) * 100, 6);
    expect(percentileOf(sorted, 16)).toBeCloseTo(90, 6);
    expect(percentileOf(sorted, 100)).toBe(100);
    expect(percentileOf(sorted, 1)).toBe(0);
    expect(percentileOf(sorted, 6)).toBeCloseTo(60, 6);
  });

  it('is null for unknown values or empty distributions', () => {
    expect(percentileOf(sorted, 0)).toBeNull();
    expect(percentileOf(sorted, null)).toBeNull();
    expect(percentileOf(sorted, Number.NaN)).toBeNull();
    expect(percentileOf([], 4)).toBeNull();
  });

  it('finds medians', () => {
    expect(medianOf([1, 3, 5])).toBe(3);
    expect(medianOf([1, 3, 5, 9])).toBe(4);
    expect(medianOf([])).toBeNull();
  });

  it('describes a rank in words', () => {
    expect(describePercentile(null, 'Stratus')).toBeNull();
    expect(describePercentile(50, 'Stratus')).toBe('Typical for Stratus');
    expect(describePercentile(81.4, 'Stratus')).toBe('Above 81% of Stratus');
    expect(describePercentile(12, 'Cumulus')).toBe('Below 88% of Cumulus');
  });
});

describe('tierColumn', () => {
  it('collects the known values of one tier, sorted, leaving out zeros', () => {
    const t = NodeTable.fromSnapshot(
      decodeNodesBin(
        encodeSyntheticNodesBin([
          { id: 1, tier: 3, ip: 'a' },
          { id: 2, tier: 3, ip: 'b' },
          { id: 3, tier: 1, ip: 'c' },
        ]),
      ),
    );
    t.cores[t.indexOf(1)] = 16;
    t.cores[t.indexOf(2)] = 0;
    t.cores[t.indexOf(3)] = 4;
    expect([...tierColumn(t, 3, 'cores')]).toEqual([16]);
    expect([...tierColumn(t, 1, 'cores')]).toEqual([4]);
  });
});
