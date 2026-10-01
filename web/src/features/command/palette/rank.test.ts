import { describe, expect, it } from 'vitest';
import { editDistance, highlight, matchScore } from './rank';

describe('matchScore', () => {
  it('orders exact, prefix, word prefix, substring and letters-in-order', () => {
    const exact = matchScore('hetzner', 'Hetzner');
    const prefix = matchScore('hetz', 'Hetzner Online GmbH');
    const word = matchScore('online', 'Hetzner Online GmbH');
    const sub = matchScore('zner', 'Hetzner Online GmbH');
    const seq = matchScore('htzr', 'Hetzner');
    expect(exact).toBe(100);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(sub);
    expect(sub).toBeGreaterThan(seq);
    expect(seq).toBeGreaterThan(0);
  });

  it('is zero for no match and for an empty query', () => {
    expect(matchScore('xyz', 'Hetzner')).toBe(0);
    expect(matchScore('', 'Hetzner')).toBe(0);
    expect(matchScore('   ', 'Hetzner')).toBe(0);
  });

  it('ignores case and surrounding spaces', () => {
    expect(matchScore('  HETZ ', 'hetzner')).toBe(matchScore('hetz', 'hetzner'));
  });

  it('forgives a typo only when fuzzy is on', () => {
    expect(matchScore('bitcoinwhtiepaper', 'BitcoinWhitepaper')).toBe(0);
    expect(matchScore('bitcoinwhtiepaper', 'BitcoinWhitepaper', { fuzzy: true })).toBeGreaterThan(0);
    expect(matchScore('kadena nod', 'kadenanode', { fuzzy: true })).toBeGreaterThanOrEqual(0);
  });

  it('prefers an earlier substring', () => {
    expect(matchScore('109', '65.109.26.93')).toBeGreaterThan(matchScore('109', '65.26.93.109x'));
  });
});

describe('editDistance', () => {
  it('counts edits and gives up past the limit', () => {
    expect(editDistance('kitten', 'sitting', 3)).toBe(3);
    expect(editDistance('kitten', 'sitting', 2)).toBeNull();
    expect(editDistance('abc', 'abc', 1)).toBe(0);
    expect(editDistance('abc', 'abcdef', 2)).toBeNull();
  });
});

describe('highlight', () => {
  it('marks the first occurrence of the query', () => {
    expect(highlight('65.109.26.93:16147', '65.109')).toEqual([
      { text: '65.109', hit: true },
      { text: '.26.93:16147', hit: false },
    ]);
    expect(highlight('Host 65.109.26.93', '65.109')).toEqual([
      { text: 'Host ', hit: false },
      { text: '65.109', hit: true },
      { text: '.26.93', hit: false },
    ]);
  });

  it('marks each word when the whole query does not occur', () => {
    expect(highlight('Hetzner Online GmbH', 'online hetz')).toEqual([
      { text: 'Hetz', hit: true },
      { text: 'ner ', hit: false },
      { text: 'Online', hit: true },
      { text: ' GmbH', hit: false },
    ]);
  });

  it('leaves unmatched text alone', () => {
    expect(highlight('Helsinki', 'zzz')).toEqual([{ text: 'Helsinki', hit: false }]);
    expect(highlight('Helsinki', '')).toEqual([{ text: 'Helsinki', hit: false }]);
  });
});
