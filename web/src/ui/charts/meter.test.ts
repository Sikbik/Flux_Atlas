import { describe, expect, it } from 'vitest';
import {
  clampToRange,
  defaultFormat,
  fractionOf,
  type MeterZoneLike,
  normalizeRange,
  readingText,
  TONE_COLOR,
  zoneAt,
  zoneBands,
} from './meter';

describe('normalizeRange', () => {
  it('defaults to 0..1 and keeps a valid range', () => {
    expect(normalizeRange(undefined, undefined)).toEqual({ min: 0, max: 1 });
    expect(normalizeRange(2_020_000, 3_071_200)).toEqual({ min: 2_020_000, max: 3_071_200 });
  });

  it('falls back to 0..1 for an empty or inverted range', () => {
    expect(normalizeRange(5, 5)).toEqual({ min: 0, max: 1 });
    expect(normalizeRange(10, 2)).toEqual({ min: 0, max: 1 });
    expect(normalizeRange(Number.NaN, 4)).toEqual({ min: 0, max: 4 });
  });
});

describe('fractionOf and clampToRange', () => {
  it('places a value in the range and clamps outside it', () => {
    expect(fractionOf(0.25, 0, 1)).toBe(0.25);
    expect(fractionOf(2_670_000, 2_020_000, 3_071_200)).toBeCloseTo(0.6183, 3);
    expect(fractionOf(-5, 0, 10)).toBe(0);
    expect(fractionOf(50, 0, 10)).toBe(1);
  });

  it('is null for a missing, non-finite or unusable reading, never zero', () => {
    expect(fractionOf(null, 0, 1)).toBeNull();
    expect(fractionOf(undefined, 0, 1)).toBeNull();
    expect(fractionOf(Number.NaN, 0, 1)).toBeNull();
    expect(fractionOf(1, 3, 3)).toBeNull();
  });

  it('keeps the reading inside the range for aria-valuenow', () => {
    expect(clampToRange(12, 0, 10)).toBe(10);
    expect(clampToRange(-1, 0, 10)).toBe(0);
    expect(clampToRange(4, 0, 10)).toBe(4);
    expect(clampToRange(null, 0, 10)).toBeNull();
  });
});

describe('zones', () => {
  const zones: MeterZoneLike[] = [
    { from: 0.6, to: 1, tone: 'crit', label: 'At risk' },
    { from: 0, to: 0.3, tone: 'ok', label: 'Healthy' },
    { from: 0.3, to: 0.6, tone: 'warn', label: 'Due' },
  ];

  it('sorts zones and expresses them as fractions of the range', () => {
    const bands = zoneBands(zones, 0, 1);
    expect(bands.map((b) => b.tone)).toEqual(['ok', 'warn', 'crit']);
    const scaled = zoneBands([{ from: 10, to: 20, tone: 'ok' }], 0, 40);
    expect(scaled).toEqual([{ from: 0.25, to: 0.5, tone: 'ok', label: undefined }]);
  });

  it('clips zones to the range and drops empty, inverted and non-finite ones', () => {
    const bands = zoneBands(
      [
        { from: -10, to: 5, tone: 'ok' },
        { from: 5, to: 5, tone: 'warn' },
        { from: 9, to: 6, tone: 'crit' },
        { from: Number.NaN, to: 8, tone: 'crit' },
      ],
      0,
      10,
    );
    expect(bands).toEqual([{ from: 0, to: 0.5, tone: 'ok', label: undefined }]);
    expect(zoneBands(undefined, 0, 1)).toEqual([]);
  });

  it('finds the zone a fraction falls in; a zone owns its start and the last zone the very end', () => {
    const bands = zoneBands(zones, 0, 1);
    expect(zoneAt(bands, 0)?.label).toBe('Healthy');
    expect(zoneAt(bands, 0.3)?.label).toBe('Due');
    expect(zoneAt(bands, 0.59)?.label).toBe('Due');
    expect(zoneAt(bands, 0.6)?.label).toBe('At risk');
    expect(zoneAt(bands, 1)?.label).toBe('At risk');
    expect(zoneAt(bands, null)).toBeUndefined();
    expect(zoneAt([], 0.5)).toBeUndefined();
  });
});

describe('readingText', () => {
  it('is the share of the range by default', () => {
    expect(defaultFormat(0.929, 0.929)).toBe('92.9%');
    expect(readingText(0.929, 0, 1)).toBe('92.9%');
    expect(readingText(2_670_000, 2_020_000, 3_071_200)).toBe('61.8%');
  });

  it('says Unknown for a missing reading', () => {
    expect(readingText(null, 0, 1)).toBe('Unknown');
    expect(readingText(undefined, 0, 1)).toBe('Unknown');
  });

  it('uses the caller format and names the zone', () => {
    const bands = zoneBands([{ from: 0, to: 1, tone: 'ok', label: 'Healthy' }], 0, 1);
    expect(readingText(0.5, 0, 1, (v) => `${Math.round(v * 100)} of 100`, bands)).toBe('50 of 100: Healthy');
  });

  it('has a colour for every tone', () => {
    expect(Object.keys(TONE_COLOR)).toEqual(['accent', 'ok', 'warn', 'crit']);
    expect(TONE_COLOR.ok).toBe('var(--status-ok)');
  });
});
