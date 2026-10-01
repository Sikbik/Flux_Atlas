import { describe, expect, it } from 'vitest';
import { formatUtcStamp, isoOrUndefined } from './time';

describe('time helpers', () => {
  const ms = Date.UTC(2026, 8, 30, 19, 39, 4);

  it('formats an absolute UTC stamp with seconds', () => {
    expect(formatUtcStamp(ms)).toBe('2026-09-30 19:39:04 UTC');
  });

  it('falls back to Unknown for missing or invalid input', () => {
    expect(formatUtcStamp(null)).toBe('Unknown');
    expect(formatUtcStamp(undefined)).toBe('Unknown');
    expect(formatUtcStamp(Number.NaN)).toBe('Unknown');
  });

  it('produces an ISO string for dateTime attributes', () => {
    expect(isoOrUndefined(ms)).toBe('2026-09-30T19:39:04.000Z');
    expect(isoOrUndefined(null)).toBeUndefined();
  });
});
