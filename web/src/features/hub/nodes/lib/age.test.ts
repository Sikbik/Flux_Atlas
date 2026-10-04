import { describe, expect, it } from 'vitest';
import type { NodeAgeBucket } from '../../../../api/generated/NodeAgeBucket';
import { ageModel, rangeText } from './age';

const BUCKETS: NodeAgeBucket[] = [
  { label: '<7d', min_days: 0, max_days: 7, nodes: 853 },
  { label: '7-30d', min_days: 7, max_days: 30, nodes: 1706 },
  { label: '1-6mo', min_days: 30, max_days: 180, nodes: 2652 },
  { label: '6-12mo', min_days: 180, max_days: 365, nodes: 1057 },
  { label: '1-2y', min_days: 365, max_days: 730, nodes: 302 },
  { label: '2y+', min_days: 730, max_days: null, nodes: 68 },
];

describe('rangeText', () => {
  it('writes each of the server buckets in plain words', () => {
    expect(BUCKETS.map((b) => rangeText(b.min_days, b.max_days))).toEqual([
      'Under 7 days',
      '7 days to 1 month',
      '1 to 6 months',
      '6 months to 1 year',
      '1 to 2 years',
      'Over 2 years',
    ]);
  });
});

describe('ageModel', () => {
  const m = ageModel(BUCKETS, 12);

  it('draws the six buckets in the server order, then the nodes with no known start', () => {
    expect(m?.bars.map((b) => b.label)).toEqual([
      '<7d',
      '7-30d',
      '1-6mo',
      '6-12mo',
      '1-2y',
      '2y+',
      'Unknown',
    ]);
    expect(m?.bars.at(-1)?.unknown).toBe(true);
  });

  it('takes shares of every confirmed node, unknown ages included, and heights from the tallest', () => {
    expect(m?.total).toBe(6650);
    expect(m?.bars[2]?.share).toBeCloseTo(2652 / 6650);
    expect(m?.bars[2]?.frac).toBe(1);
    expect(m?.bars[0]?.frac).toBeCloseTo(853 / 2652);
  });

  it('names the largest group and says what it is', () => {
    expect(m?.reading).toBe('The largest group of nodes, 39.9%, is 1 to 6 months old.');
  });

  it('reads every column out for a screen reader', () => {
    expect(m?.summary).toContain('Under 7 days: 853 nodes (12.8%)');
    expect(m?.summary).toContain('Start not known: 12 nodes (0.2%)');
  });

  it('leaves the unknown column out when every node says when it began', () => {
    expect(ageModel(BUCKETS, 0)?.bars).toHaveLength(6);
  });

  it('is null with no nodes to age', () => {
    expect(ageModel(undefined, 0)).toBeNull();
    expect(
      ageModel(
        BUCKETS.map((b) => ({ ...b, nodes: 0 })),
        0,
      ),
    ).toBeNull();
  });
});
