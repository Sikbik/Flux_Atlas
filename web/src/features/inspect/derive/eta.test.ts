import { describe, expect, it } from 'vitest';
import { etaClock, etaParts, spanText } from './eta';

describe('etaParts', () => {
  it('counts seconds under 90 s, minutes under an hour, hours under two days', () => {
    expect(etaParts(28_000)).toEqual({ value: '28', unit: 's', phrase: 'in 28 s' });
    expect(etaParts(89_400)).toMatchObject({ value: '89', unit: 's' });
    expect(etaParts(90_000)).toEqual({ value: '2', unit: 'min', phrase: 'in 2 min' });
    expect(etaParts(53_000_000)).toEqual({ value: '14.7', unit: 'h', phrase: 'in 14.7 h' });
    expect(etaParts(47 * 3_600_000)).toMatchObject({ value: '47.0', unit: 'h' });
  });

  it('switches to days past two days and never goes negative', () => {
    expect(etaParts(2 * 86_400_000 + 3 * 3_600_000)).toEqual({
      value: '2d 3h',
      unit: '',
      phrase: 'in 2d 3h',
    });
    expect(etaParts(3 * 86_400_000).value).toBe('3d');
    expect(etaParts(-5_000).value).toBe('0');
  });

  it('writes a two figure countdown with a zero padded tail', () => {
    expect(etaClock(28_000)).toEqual({ a: '28', aUnit: 's', phrase: 'in 28 s' });
    expect(etaClock(125_000)).toEqual({ a: '2', aUnit: 'm', b: '05', bUnit: 's', phrase: 'in 2 min 5 s' });
    expect(etaClock(46_800_000 + 54 * 60_000)).toEqual({
      a: '13',
      aUnit: 'h',
      b: '54',
      bUnit: 'm',
      phrase: 'in 13 h 54 min',
    });
    expect(etaClock(30 * 3_600_000)).toMatchObject({ a: '1', aUnit: 'd', b: '06', bUnit: 'h' });
    expect(etaClock(-1)).toEqual({ a: '0', aUnit: 's', phrase: 'in 0 s' });
  });

  it('writes a span without the leading in', () => {
    expect(spanText(8 * 60_000)).toBe('8 min');
    expect(spanText(3.2 * 3_600_000)).toBe('3.2 h');
    expect(spanText(2 * 86_400_000)).toBe('2d');
  });
});
