import { describe, expect, it } from 'vitest';
import {
  describeShares,
  OTHER_COLOR,
  SHARE_SLOTS,
  type ShareSegmentLike,
  segmentColors,
  segmentText,
  sharesOf,
  sumOf,
  tierInk,
} from './shareBar';

const seg = (id: string, value: number | null, extra: Partial<ShareSegmentLike> = {}): ShareSegmentLike => ({
  id,
  label: id[0]?.toUpperCase() + id.slice(1),
  value,
  ...extra,
});

describe('segmentColors', () => {
  it('uses the tier ink for tier segments, not the emissive colour', () => {
    expect(tierInk('cumulus')).toBe('var(--tier-cumulus-ink)');
    expect(
      segmentColors([
        seg('c', 1, { tier: 'cumulus' }),
        seg('n', 1, { tier: 'nimbus' }),
        seg('s', 1, { tier: 'stratus' }),
      ]),
    ).toEqual(['var(--tier-cumulus-ink)', 'var(--tier-nimbus-ink)', 'var(--tier-stratus-ink)']);
  });

  it('gives the unknown segment the reserved off-status gray', () => {
    expect(segmentColors([seg('a', 1), seg('u', 1, { unknown: true })])).toEqual([
      SHARE_SLOTS[0],
      'var(--status-off)',
    ]);
  });

  it('lets an explicit colour win over a tier', () => {
    expect(segmentColors([seg('a', 1, { color: 'var(--accent-500)', tier: 'nimbus' })])).toEqual([
      'var(--accent-500)',
    ]);
  });

  it('takes the categorical slots in array order, skipping segments with their own colour', () => {
    const colors = segmentColors([
      seg('a', 1),
      seg('b', 1, { tier: 'stratus' }),
      seg('c', 1),
      seg('d', 1, { unknown: true }),
      seg('e', 1),
    ]);
    expect(colors).toEqual([
      'var(--viz-1)',
      'var(--tier-stratus-ink)',
      'var(--viz-2)',
      'var(--status-off)',
      'var(--viz-3)',
    ]);
  });

  it('folds the seventh plain segment and beyond into Other, never cycling', () => {
    const many = Array.from({ length: 8 }, (_, i) => seg(`s${i}`, 1));
    const colors = segmentColors(many);
    expect(colors.slice(0, 6)).toEqual([...SHARE_SLOTS]);
    expect(colors[6]).toBe(OTHER_COLOR);
    expect(colors[7]).toBe(OTHER_COLOR);
  });
});

describe('sumOf and sharesOf', () => {
  it('sums positive finite values only', () => {
    expect(sumOf([seg('a', 3), seg('b', null), seg('c', -2), seg('d', 7)])).toBe(10);
  });

  it('divides by the sum by default and by a given total otherwise', () => {
    const rows = sharesOf([seg('a', 25), seg('b', 75)]);
    expect(rows.map((r) => r.share)).toEqual([0.25, 0.75]);
    const partial = sharesOf([seg('a', 25), seg('b', 25)], 200);
    expect(partial.map((r) => r.share)).toEqual([0.125, 0.125]);
  });

  it('treats unknown and negative values as zero and an empty whole as no share', () => {
    expect(sharesOf([seg('a', null), seg('b', -4)]).map((r) => r.share)).toEqual([0, 0]);
    expect(sharesOf([seg('a', 5)], 0).map((r) => r.share)).toEqual([1]);
  });

  it('never exceeds one when the given total is smaller than a value', () => {
    expect(sharesOf([seg('a', 50)], 10)[0]?.share).toBe(1);
  });
});

describe('segmentText and describeShares', () => {
  it('writes one segment with a grouped value and a one-decimal percent', () => {
    expect(segmentText(seg('cumulus', 3393), 0.5044)).toBe('Cumulus 3,393 (50.4%)');
    expect(segmentText(seg('x', null), 0)).toBe('X Unknown');
  });

  it('lists every share in one sentence, naming the tier', () => {
    const text = describeShares('Node tiers', [
      seg('c', 3393, { tier: 'cumulus' }),
      seg('n', 1580, { tier: 'nimbus' }),
      seg('s', 1763, { tier: 'stratus' }),
    ]);
    expect(text).toBe('Node tiers: Cumulus 3,393 (50.4%), Nimbus 1,580 (23.5%), Stratus 1,763 (26.2%)');
  });

  it('works without a label and says so when there is nothing', () => {
    expect(describeShares(undefined, [seg('a', 1), seg('b', 1)])).toBe('A 1 (50.0%), B 1 (50.0%)');
    expect(describeShares('Tiers', [seg('a', null), seg('b', null)])).toBe('Tiers: no data');
    expect(describeShares(undefined, [])).toBe('No data');
  });

  it('keeps an unknown segment in the sentence', () => {
    expect(
      describeShares('Reach', [seg('up', 90), seg('unknown', 10, { unknown: true, label: 'Unknown' })]),
    ).toBe('Reach: Up 90 (90.0%), Unknown 10 (10.0%)');
  });
});
