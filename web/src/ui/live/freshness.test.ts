import { describe, expect, it } from 'vitest';
import {
  ageUnit,
  freshnessAgo,
  freshnessChipText,
  freshnessInlineText,
  freshnessTitle,
  freshnessView,
  parseViewKey,
  viewKey,
} from './freshness';

const S = 1000;
const MIN = 60 * S;
const NOW = 1_790_000_000_000;

describe('freshnessView', () => {
  it('is fresh under 1.5x the cadence', () => {
    expect(freshnessView(NOW - 4 * S, NOW, 4 * S)).toEqual({ state: 'fresh', age: '4 s', word: null });
    expect(freshnessView(NOW - 5 * S, NOW, 4 * S).state).toBe('fresh');
  });

  it('is aging from 1.5x to 3x, with no word', () => {
    const v = freshnessView(NOW - 7 * S, NOW, 4 * S);
    expect(v).toEqual({ state: 'aging', age: '7 s', word: null });
  });

  it('is stale from 3x and says so', () => {
    const v = freshnessView(NOW - 13 * S, NOW, 4 * S);
    expect(v).toEqual({ state: 'stale', age: '13 s', word: 'stale' });
  });

  it('is dead from 10x and says lost', () => {
    const v = freshnessView(NOW - 6 * 60 * MIN, NOW, 30 * MIN);
    expect(v).toEqual({ state: 'dead', age: '6 h', word: 'lost' });
  });

  it('is unknown without an update time, never a zero age', () => {
    expect(freshnessView(null, NOW, 4 * S)).toEqual({ state: 'unknown', age: null, word: null });
    expect(freshnessView(undefined, NOW, 4 * S).state).toBe('unknown');
    expect(freshnessView(Number.NaN, NOW, 4 * S).state).toBe('unknown');
  });

  it('treats an update time in the future as now', () => {
    expect(freshnessView(NOW + 5 * S, NOW, 4 * S)).toEqual({ state: 'fresh', age: 'now', word: null });
  });

  it('scales the thresholds with the source cadence', () => {
    // 120 s old: stale for a 4 s source, fresh for a 90 s source.
    expect(freshnessView(NOW - 120 * S, NOW, 4 * S).state).toBe('dead');
    expect(freshnessView(NOW - 120 * S, NOW, 90 * S).state).toBe('fresh');
    expect(freshnessView(NOW - 7 * MIN, NOW, 90 * S).state).toBe('stale');
  });

  it('survives a zero or negative cadence', () => {
    expect(() => freshnessView(NOW - 5 * S, NOW, 0)).not.toThrow();
    expect(() => freshnessView(NOW - 5 * S, NOW, -10)).not.toThrow();
  });
});

describe('viewKey', () => {
  it('changes only when the visible text can', () => {
    const a = viewKey(NOW - 61 * S, NOW, 90 * S);
    const b = viewKey(NOW - 61 * S, NOW + 20 * S, 90 * S); // still "1 min"
    expect(a).toBe(b);
    expect(viewKey(NOW - 61 * S, NOW + 60 * S, 90 * S)).not.toBe(a); // "2 min"
  });

  it('changes when the state flips even though the age text does not', () => {
    const t0 = NOW - 100 * S; // 1.5x of a 60 s cadence is 90 s; "1 min" for 60..119 s
    const fresh = viewKey(t0, NOW - 15 * S, 60 * S); // 85 s old
    const aging = viewKey(t0, NOW, 60 * S); // 100 s old
    expect(fresh.split('|')[1]).toBe(aging.split('|')[1]);
    expect(fresh).not.toBe(aging);
  });

  it('round-trips through parseViewKey', () => {
    for (const ts of [NOW - 4 * S, NOW - 13 * S, NOW - 6 * 60 * MIN, null]) {
      const v = freshnessView(ts, NOW, 4 * S);
      expect(parseViewKey(viewKey(ts, NOW, 4 * S))).toEqual(v);
    }
  });
});

describe('ageUnit', () => {
  it('names the unit of an age label', () => {
    expect(ageUnit('now')).toBe('now');
    expect(ageUnit('4 s')).toBe('s');
    expect(ageUnit('41 s')).toBe('s');
    expect(ageUnit('12 min')).toBe('min');
    expect(ageUnit('3 h')).toBe('h');
    expect(ageUnit('5 d')).toBe('d');
    expect(ageUnit(null)).toBeNull();
    expect(ageUnit('4 weeks')).toBeNull();
  });
});

describe('texts', () => {
  it('freshnessAgo keeps "now" and suffixes the rest', () => {
    expect(freshnessAgo('now')).toBe('now');
    expect(freshnessAgo('4 s')).toBe('4 s ago');
  });

  it('builds chip text', () => {
    expect(freshnessChipText('nodes', freshnessView(NOW - 4 * S, NOW, 90 * S))).toBe('nodes 4 s');
    expect(freshnessChipText('nodes', freshnessView(NOW - 11 * MIN, NOW, 90 * S))).toBe('nodes 11 min stale');
    expect(freshnessChipText('mesh', freshnessView(NOW - 6 * 60 * MIN, NOW, 30 * MIN))).toBe('mesh 6 h lost');
    expect(freshnessChipText('nodes', freshnessView(null, NOW, 90 * S))).toBe('nodes Unknown');
    expect(freshnessChipText(undefined, freshnessView(NOW, NOW, 90 * S))).toBe('now');
  });

  it('builds inline text', () => {
    expect(freshnessInlineText(undefined, freshnessView(NOW - 3 * S, NOW, 4 * S))).toBe('updated 3 s ago');
    expect(freshnessInlineText(undefined, freshnessView(NOW, NOW, 4 * S))).toBe('updated now');
    expect(freshnessInlineText('nodes', freshnessView(NOW - 11 * MIN, NOW, 90 * S))).toBe(
      'nodes updated 11 min ago, stale',
    );
    expect(freshnessInlineText(undefined, freshnessView(null, NOW, 90 * S))).toBe('update time Unknown');
  });

  it('titles with the absolute UTC time', () => {
    const ts = Date.UTC(2026, 8, 30, 19, 39, 4);
    expect(freshnessTitle(ts, freshnessView(ts, ts + 5 * S, 4 * S))).toBe('Last update 19:39:04 UTC');
    expect(freshnessTitle(null, freshnessView(null, NOW, 4 * S))).toBe('No update seen yet');
  });

  it('adds the date once the update is days old', () => {
    const ts = Date.UTC(2026, 8, 20, 8, 5, 0);
    const now = Date.UTC(2026, 8, 30, 8, 5, 0);
    expect(freshnessTitle(ts, freshnessView(ts, now, 90 * S))).toBe('Last update 2026-09-20 08:05 UTC');
  });
});
