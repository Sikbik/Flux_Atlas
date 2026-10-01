import { describe, expect, it } from 'vitest';
import { leaders, nameList, shareText } from './concentration';

const c = (label: string, count: number) => ({ key: label, label, count });

describe('leaders', () => {
  it('stops at the entity that takes the running share past half', () => {
    const r = leaders([c('A', 40), c('B', 25), c('C', 20), c('D', 15)], 100);
    expect(r.n).toBe(2);
    expect(r.leaders.map((x) => x.label)).toEqual(['A', 'B']);
    expect(r.share).toBeCloseTo(0.65);
    expect(r.reached).toBe(true);
  });

  it('needs more than half, not exactly half', () => {
    expect(leaders([c('A', 50), c('B', 50)], 100).n).toBe(2);
    expect(leaders([c('A', 51), c('B', 49)], 100).n).toBe(1);
  });

  it('sorts its input and counts nodes outside every entity against the leaders', () => {
    const r = leaders([c('small', 10), c('big', 30)], 100);
    // 40 of 100 never passes half: unlocated nodes make up the difference.
    expect(r.reached).toBe(false);
    expect(r.n).toBe(2);
    expect(r.share).toBeCloseTo(0.4);
    expect(r.leaders[0]!.label).toBe('big');
  });

  it('handles an empty network', () => {
    const r = leaders([], 0);
    expect(r.n).toBe(0);
    expect(r.reached).toBe(false);
  });
});

describe('nameList', () => {
  it('reads as a sentence', () => {
    expect(nameList([])).toBe('');
    expect(nameList(['Germany'])).toBe('Germany');
    expect(nameList(['Germany', 'Finland'])).toBe('Germany and Finland');
    expect(nameList(['Germany', 'Finland', 'France'])).toBe('Germany, Finland and France');
  });
  it('folds a long list into a count', () => {
    expect(nameList(['A', 'B', 'C', 'D', 'E'])).toBe('A, B and 3 others');
    expect(nameList(['A', 'B', 'C', 'D', 'E'], 4)).toBe('A, B, C and 2 others');
  });
});

describe('shareText', () => {
  it('shows one decimal for an ordinary share', () => {
    expect(shareText(0.989)).toBe('98.9%');
    expect(shareText(0.5)).toBe('50.0%');
    expect(shareText(0.001)).toBe('0.1%');
  });
  it('never rounds a small share down to zero', () => {
    expect(shareText(0.00045)).toBe('<0.1%');
  });
  it('keeps a true zero and rejects what is not a share', () => {
    expect(shareText(0)).toBe('0.0%');
    expect(shareText(Number.NaN)).toBe('');
    expect(shareText(-1)).toBe('');
  });
});
