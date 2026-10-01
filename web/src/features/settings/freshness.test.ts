import { describe, expect, it } from 'vitest';
import type { LiveMsg } from '../../api/generated/LiveMsg';
import { FRESH_SOURCES, lastSignOf } from './freshness';

describe('the sources', () => {
  it('names each ingest path once, with a cadence and the feeds that carry it', () => {
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
