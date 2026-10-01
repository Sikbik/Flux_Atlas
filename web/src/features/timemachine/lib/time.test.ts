import { describe, expect, it } from 'vitest';
import {
  ageLong,
  ageShort,
  clampTime,
  DAY,
  formatInstantMinutes,
  formatInstantSeconds,
  fractionOf,
  HOUR,
  instantAt,
  MINUTE,
  nearestSpeed,
  parseInstant,
  speedsFor,
  stepFor,
  toUrlInstant,
} from './time';

const T = Date.UTC(2026, 8, 26, 8, 0, 0); // 2026-09-26 08:00 UTC

describe('parseInstant', () => {
  it('reads ISO 8601 in UTC, with or without seconds', () => {
    expect(parseInstant('2026-09-26T08:00Z')).toBe(T);
    expect(parseInstant('2026-09-26T08:00:00Z')).toBe(T);
    expect(parseInstant('2026-09-26T08:00:12.500Z')).toBe(T + 12_500);
  });

  it('treats a time without a zone as UTC, never local', () => {
    expect(parseInstant('2026-09-26T08:00')).toBe(T);
    expect(parseInstant('2026-09-26 08:00')).toBe(T);
    expect(parseInstant('2026-09-26')).toBe(Date.UTC(2026, 8, 26));
  });

  it('keeps an explicit offset', () => {
    expect(parseInstant('2026-09-26T10:00+02:00')).toBe(T);
  });

  it('reads unix milliseconds and unix seconds', () => {
    expect(parseInstant(T)).toBe(T);
    expect(parseInstant(String(T))).toBe(T);
    expect(parseInstant(T / 1000)).toBe(T);
    expect(parseInstant(String(T / 1000))).toBe(T);
  });

  it('rejects what is not an instant', () => {
    for (const bad of [
      '',
      '   ',
      'yesterday',
      '2026-13-45T00:00Z',
      '0',
      '12',
      -5,
      Number.NaN,
      null,
      undefined,
    ]) {
      expect(parseInstant(bad as never)).toBeNull();
    }
  });
});

describe('writing instants', () => {
  it('round-trips through the URL form', () => {
    expect(toUrlInstant(T + 12_345)).toBe('2026-09-26T08:00:12Z');
    expect(parseInstant(toUrlInstant(T))).toBe(T);
  });

  it('formats the strip and chip forms', () => {
    expect(formatInstantMinutes(T)).toBe('2026-09-26 08:00 UTC');
    expect(formatInstantSeconds(T + 12_000)).toBe('2026-09-26 08:00:12 UTC');
  });
});

describe('age in words', () => {
  it('gives two units at most, short', () => {
    expect(ageShort(0)).toBe('0 s');
    expect(ageShort(40_000)).toBe('40 s');
    expect(ageShort(12 * MINUTE)).toBe('12 min');
    expect(ageShort(3 * HOUR + 12 * MINUTE)).toBe('3 h 12 min');
    expect(ageShort(3 * HOUR)).toBe('3 h');
    expect(ageShort(4 * DAY + 11 * HOUR + 30 * MINUTE)).toBe('4 d 11 h');
    expect(ageShort(4 * DAY)).toBe('4 d');
  });

  it('spells the same age out for a screen reader', () => {
    expect(ageLong(4 * DAY + 11 * HOUR)).toBe('4 days 11 hours');
    expect(ageLong(DAY + HOUR)).toBe('1 day 1 hour');
    expect(ageLong(HOUR + MINUTE)).toBe('1 hour 1 minute');
    expect(ageLong(2 * MINUTE)).toBe('2 minutes');
    expect(ageLong(1000)).toBe('1 second');
    expect(ageLong(45_000)).toBe('45 seconds');
  });

  it('never goes negative', () => {
    expect(ageShort(-5000)).toBe('0 s');
  });
});

describe('speeds', () => {
  it('offers faster speeds only for a long span', () => {
    expect(speedsFor(3 * HOUR)).toEqual([1, 10, 60, 600]);
    expect(speedsFor(3 * DAY)).toEqual([1, 10, 60, 600, 3600]);
    expect(speedsFor(30 * DAY)).toEqual([1, 10, 60, 600, 3600, 21600]);
  });

  it('snaps a URL speed to the nearest offered one', () => {
    const s = speedsFor(3 * HOUR);
    expect(nearestSpeed(60, s)).toBe(60);
    expect(nearestSpeed(45, s)).toBe(60);
    expect(nearestSpeed(5000, s)).toBe(600);
    expect(nearestSpeed(0, s)).toBe(60);
    expect(nearestSpeed(undefined, s)).toBe(60);
    expect(nearestSpeed(-3, s)).toBe(60);
  });
});

describe('stepFor', () => {
  it('keeps the curve to about 400 points', () => {
    expect(stepFor(3 * HOUR).param).toBe('1m');
    expect(stepFor(24 * HOUR).param).toBe('5m');
    expect(stepFor(7 * DAY).param).toBe('30m');
    expect(stepFor(30 * DAY).param).toBe('3h');
    expect(stepFor(2000 * DAY).param).toBe('1d');
    for (const span of [HOUR, 5 * HOUR, DAY, 3 * DAY, 30 * DAY]) {
      const s = stepFor(span);
      expect(span / s.ms).toBeLessThanOrEqual(400);
    }
  });
});

describe('positions', () => {
  it('maps an instant to a fraction and back', () => {
    expect(fractionOf(T, T, T + 10 * HOUR)).toBe(0);
    expect(fractionOf(T + 5 * HOUR, T, T + 10 * HOUR)).toBe(0.5);
    expect(fractionOf(T - HOUR, T, T + 10 * HOUR)).toBe(0);
    expect(fractionOf(T + 20 * HOUR, T, T + 10 * HOUR)).toBe(1);
    expect(fractionOf(T, T, T)).toBe(1);
    expect(instantAt(0.5, T, T + 10 * HOUR)).toBe(T + 5 * HOUR);
    expect(instantAt(2, T, T + 10 * HOUR)).toBe(T + 10 * HOUR);
    expect(instantAt(-1, T, T + 10 * HOUR)).toBe(T);
  });

  it('clamps', () => {
    expect(clampTime(5, 10, 20)).toBe(10);
    expect(clampTime(25, 10, 20)).toBe(20);
    expect(clampTime(15, 10, 20)).toBe(15);
  });
});
