import { describe, expect, it } from 'vitest';
import type { LiveMsg } from '../../api/generated/LiveMsg';
import { ageLabel, FRESH_SOURCES, freshnessState, lastSignOf } from './freshness';

describe('freshnessState', () => {
  it('follows the shared thresholds, 1.5x, 3x and 10x the cadence', () => {
    const c = 30_000;
    expect(freshnessState(0, c)).toBe('fresh');
    expect(freshnessState(44_000, c)).toBe('fresh');
    expect(freshnessState(45_000, c)).toBe('aging');
    expect(freshnessState(89_000, c)).toBe('aging');
    expect(freshnessState(90_000, c)).toBe('stale');
    expect(freshnessState(299_000, c)).toBe('stale');
    expect(freshnessState(300_000, c)).toBe('dead');
  });
});

describe('ageLabel', () => {
  it('reads now, seconds, minutes and hours', () => {
    expect(ageLabel(400)).toBe('now');
    expect(ageLabel(4_000)).toBe('4 s');
    expect(ageLabel(59_999)).toBe('59 s');
    expect(ageLabel(60_000)).toBe('1 min');
    expect(ageLabel(12 * 60_000 + 5_000)).toBe('12 min');
    expect(ageLabel(3 * 3_600_000)).toBe('3 h');
    expect(ageLabel(-5)).toBe('now');
  });
});

describe('the sources', () => {
  it('names each ingest path once, with a cadence', () => {
    expect(new Set(FRESH_SOURCES.map((s) => s.id)).size).toBe(FRESH_SOURCES.length);
    for (const s of FRESH_SOURCES) {
      expect(s.cadenceMs).toBeGreaterThan(0);
      expect(s.types.length).toBeGreaterThan(0);
    }
  });
});

describe('lastSignOf', () => {
  const apps = FRESH_SOURCES.find((s) => s.id === 'apps');

  it('takes the newest message across the feeds that carry a source', () => {
    if (!apps) throw new Error('apps source missing');
    const seen = new Map<LiveMsg['t'], number>([
      ['apps', 1_000],
      ['app_installing', 9_000],
      ['app_pending', 4_000],
    ]);
    expect(lastSignOf(apps, seen, 500)).toEqual({ at: 9_000, heard: true });
  });

  it('falls back to the moment the page connected when a source has said nothing yet', () => {
    if (!apps) throw new Error('apps source missing');
    expect(lastSignOf(apps, new Map(), 7_000)).toEqual({ at: 7_000, heard: false });
  });
});
