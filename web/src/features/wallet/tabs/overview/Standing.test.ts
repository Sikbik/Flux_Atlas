import { describe, expect, it } from 'vitest';
import { standingFraction, topShareText } from './Standing';

describe('standingFraction', () => {
  it('runs from the smallest operator (0) to the largest (1)', () => {
    expect(standingFraction(1, 10)).toBe(1);
    expect(standingFraction(10, 10)).toBe(0);
    expect(standingFraction(5, 9)).toBe(0.5);
  });

  it('puts the only operator at the top', () => {
    expect(standingFraction(1, 1)).toBe(1);
  });

  it('is unknown without a rank or a count, or for a rank that cannot exist', () => {
    expect(standingFraction(null, 10)).toBeNull();
    expect(standingFraction(1, 0)).toBeNull();
    expect(standingFraction(0, 10)).toBeNull();
    expect(standingFraction(-2, 10)).toBeNull();
  });

  it('never leaves the ruler, even for a rank past the count', () => {
    expect(standingFraction(12, 10)).toBe(0);
  });
});

describe('topShareText', () => {
  it('reads a rank in the top half as the share of operators at or above it', () => {
    expect(topShareText(1, 5000)).toBe('Top 0.1% by nodes');
    expect(topShareText(3, 847)).toBe('Top 0.4% by nodes');
    expect(topShareText(50, 847)).toBe('Top 5.9% by nodes');
    expect(topShareText(100, 847)).toBe('Top 12% by nodes');
    expect(topShareText(423, 847)).toBe('Top 50% by nodes');
  });

  it('reads a rank in the bottom half as the share of operators it is ahead of, never as "Top 88%"', () => {
    expect(topShareText(746, 847)).toBe('Ahead of 12% of operators by nodes');
    expect(topShareText(600, 847)).toBe('Ahead of 29% of operators by nodes');
  });

  it('says so for the smallest operators and for the only one', () => {
    expect(topShareText(847, 847)).toBe('Among the smallest operators by nodes');
    expect(topShareText(1, 1)).toBe('The only operator');
  });

  it('is unknown without a rank or a count', () => {
    expect(topShareText(null, 847)).toBeNull();
    expect(topShareText(3, 0)).toBeNull();
    expect(topShareText(0, 847)).toBeNull();
  });
});
