import { describe, expect, it } from 'vitest';
import { splitHash, splitTrailingZeros } from './hashParts';

describe('splitHash', () => {
  const tx = '8aa97365b148e2125de355988b4c1be4870edc0e869587f831f8c0d65871beec';

  it('keeps the head, hides the middle, keeps the tail', () => {
    const p = splitHash(tx, 6, 5);
    expect(p).toEqual({ head: '8aa973', mid: tx.slice(6, -5), tail: '1beec' });
    expect(`${p?.head}${p?.mid}${p?.tail}`).toBe(tx);
  });

  it('does not split values that already fit', () => {
    expect(splitHash('abcdefghijkl', 6, 5)).toBeNull();
    expect(splitHash('abcdefghijklm', 6, 5)).not.toBeNull();
    expect(splitHash('', 6, 5)).toBeNull();
  });
});

describe('splitTrailingZeros', () => {
  it('dims trailing zeros past the kept decimals', () => {
    expect(splitTrailingZeros('9.00000000')).toEqual({ main: '9.00', dim: '000000' });
    expect(splitTrailingZeros('3.61000000')).toEqual({ main: '3.61', dim: '000000' });
    expect(splitTrailingZeros('0.12345678')).toEqual({ main: '0.12345678', dim: '' });
    expect(splitTrailingZeros('1,234.50000000')).toEqual({ main: '1,234.50', dim: '000000' });
  });

  it('leaves integers and short decimals alone', () => {
    expect(splitTrailingZeros('12')).toEqual({ main: '12', dim: '' });
    expect(splitTrailingZeros('9.00')).toEqual({ main: '9.00', dim: '' });
    expect(splitTrailingZeros('9.5')).toEqual({ main: '9.5', dim: '' });
  });
});
