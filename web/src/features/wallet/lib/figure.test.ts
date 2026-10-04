import { describe, expect, it } from 'vitest';
import { figureEm } from './figure';

describe('figureEm', () => {
  it('counts a digit as 0.675 em and a separator as 0.175 em', () => {
    expect(figureEm('0')).toBeCloseTo(0.675, 10);
    expect(figureEm(',')).toBeCloseTo(0.175, 10);
    expect(figureEm('10,183,082.19')).toBeCloseTo(10 * 0.675 + 3 * 0.175, 10);
  });

  it('is nothing for nothing', () => {
    expect(figureEm('')).toBe(0);
  });

  it('grows with every digit', () => {
    expect(figureEm('1,234,567.89')).toBeLessThan(figureEm('12,345,678.90'));
    expect(figureEm('12,345,678.90')).toBeLessThan(figureEm('1,234,567,890.12'));
  });

  it('counts a sign or a letter as a digit, the widest glyph', () => {
    expect(figureEm('-5')).toBeCloseTo(2 * 0.675, 10);
    expect(figureEm('M')).toBeCloseTo(0.675, 10);
  });
});
