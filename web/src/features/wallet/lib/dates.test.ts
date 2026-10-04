import { describe, expect, it } from 'vitest';
import { formatDate, formatDay, formatMonth } from './dates';

describe('the wallet dates', () => {
  it('are always UTC: a late evening in the west is still that UTC day', () => {
    const ms = Date.UTC(2026, 9, 3, 23, 59, 59);
    expect(formatDate(ms)).toBe('3 Oct 2026');
    expect(formatDay(ms)).toBe('3 Oct');
    expect(formatMonth(ms)).toBe('Oct 2026');
  });

  it('read the same shape for the first and last day of a year', () => {
    expect(formatDate(Date.UTC(2026, 0, 1))).toBe('1 Jan 2026');
    expect(formatDate(Date.UTC(2026, 11, 31, 23, 59, 59, 999))).toBe('31 Dec 2026');
    expect(formatMonth(Date.UTC(2026, 11, 31))).toBe('Dec 2026');
  });

  it('handle the leap day', () => {
    expect(formatDate(Date.UTC(2028, 1, 29))).toBe('29 Feb 2028');
  });
});
