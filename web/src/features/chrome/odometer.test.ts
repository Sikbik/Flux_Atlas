import { describe, expect, it } from 'vitest';
import { countUpValue, diffCells, planChange, ROLL_STAGGER_MS } from './odometer';

describe('diffCells', () => {
  it('marks only the characters that changed, aligned on the last digit', () => {
    const cells = diffCells('2,996,929', '2,996,930');
    expect(cells.map((c) => c.ch).join('')).toBe('2,996,930');
    const changed = cells.filter((c) => c.from !== null);
    expect(changed.map((c) => `${c.from}>${c.ch}`)).toEqual(['2>3', '9>0']);
  });

  it('ranks the rolling digits from the last one backward (40 ms apart)', () => {
    const cells = diffCells('2,996,929', '2,996,930');
    const ranks = cells.filter((c) => c.from !== null).map((c) => c.rank);
    // The last digit rolls first (rank 0), the one before it second.
    expect(ranks).toEqual([1, 0]);
    expect(ROLL_STAGGER_MS).toBe(40);
  });

  it('keeps the position from the end as a stable key', () => {
    const cells = diffCells('99', '100');
    expect(cells.map((c) => c.pos)).toEqual([2, 1, 0]);
  });

  it('treats a new leading character as rolling from blank', () => {
    const cells = diffCells('99', '100');
    expect(cells[0]).toMatchObject({ ch: '1', from: ' ' });
  });
});

describe('planChange', () => {
  it('does nothing for the first value, no change, or unknown values', () => {
    expect(planChange('5', '5', 5, 5)).toEqual({ kind: 'none' });
    expect(planChange('Unknown', '5', null, 5)).toEqual({ kind: 'none' });
    expect(planChange('5', 'Unknown', 5, null)).toEqual({ kind: 'none' });
  });

  it('swaps silently under 0.05 percent', () => {
    expect(planChange('6,724', '6,725', 6724, 6725)).toEqual({ kind: 'none' });
  });

  it('rolls digits for ordinary changes, in the direction of the change', () => {
    const up = planChange('2,996,929', '2,996,930', 2_996_929, 2_996_930);
    expect(up.kind).toBe('none');
    const up2 = planChange('100', '103', 100, 103);
    expect(up2).toMatchObject({ kind: 'roll', dir: 'up' });
    const down = planChange('100', '97', 100, 97);
    expect(down).toMatchObject({ kind: 'roll', dir: 'down' });
  });

  it('counts up past a 5 percent jump', () => {
    expect(planChange('100', '130', 100, 130)).toEqual({ kind: 'count', dir: 'up' });
    expect(planChange('130', '100', 130, 100)).toEqual({ kind: 'count', dir: 'down' });
  });
});

describe('countUpValue', () => {
  it('starts at the old value, ends at the new one and eases out', () => {
    expect(countUpValue(100, 200, 0)).toBe(100);
    expect(countUpValue(100, 200, 1)).toBe(200);
    const mid = countUpValue(100, 200, 0.2);
    expect(mid).toBeGreaterThan(150);
    expect(mid).toBeLessThan(200);
  });

  it('clamps t outside 0..1', () => {
    expect(countUpValue(0, 10, -1)).toBe(0);
    expect(countUpValue(0, 10, 5)).toBe(10);
  });
});
