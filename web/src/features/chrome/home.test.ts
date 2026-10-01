import { describe, expect, it } from 'vitest';
import { describeGlobe, MOON_HINT_FLAG, markMoonHintSeen, moonHintSeen, startsMoonHint } from './home';

describe('describeGlobe', () => {
  it('says what the canvas shows, in one sentence', () => {
    expect(describeGlobe({ nodes: 6_727, countries: 60, tip: 2_997_836 })).toBe(
      'Live globe of all Flux nodes: 6,727 nodes in 60 countries; chain tip 2,997,836. Drag to rotate, scroll to zoom. Press Control K to search.',
    );
  });

  it('leaves out what is not known yet, and never writes it as zero', () => {
    const none = describeGlobe({ nodes: null, countries: null, tip: null });
    expect(none).toBe(
      'Live globe of all Flux nodes. Drag to rotate, scroll to zoom. Press Control K to search.',
    );
    expect(none).not.toMatch(/\b0\b/);
    expect(describeGlobe({ nodes: 10, countries: null, tip: null })).toContain('10 nodes');
    expect(describeGlobe({ nodes: 10, countries: null, tip: null })).not.toContain('countries');
    expect(describeGlobe({ nodes: null, countries: 5, tip: 3 })).toContain('chain tip 3');
    expect(describeGlobe({ nodes: null, countries: 5, tip: 3 })).not.toContain('countries');
  });

  it('keeps a real zero when the network really has none', () => {
    expect(describeGlobe({ nodes: 0, countries: 0, tip: 0 })).toContain('0 nodes in 0 countries');
  });
});

describe('the moon hint flag', () => {
  const fake = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    };
  };

  it('is unseen until marked, then seen', () => {
    const s = fake();
    expect(moonHintSeen(s)).toBe(false);
    markMoonHintSeen(s);
    expect(moonHintSeen(s)).toBe(true);
    expect(s.getItem(MOON_HINT_FLAG)).toBe('1');
  });

  it('survives storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(moonHintSeen(broken)).toBe(false);
    expect(() => markMoonHintSeen(broken)).not.toThrow();
    expect(moonHintSeen(null)).toBe(false);
  });
});

describe('startsMoonHint', () => {
  const base = { seen: false, booted: true, baseline: 100, height: 101, home: true };

  it('starts on the first block after the boot, on the bare globe, for a first visit', () => {
    expect(startsMoonHint(base)).toBe(true);
  });

  it('waits while the tip is still the one the boot ended on', () => {
    expect(startsMoonHint({ ...base, height: 100 })).toBe(false);
  });

  it('never starts before the boot ends or before the tip is known', () => {
    expect(startsMoonHint({ ...base, booted: false })).toBe(false);
    expect(startsMoonHint({ ...base, baseline: null })).toBe(false);
    expect(startsMoonHint({ ...base, height: null })).toBe(false);
  });

  it('never starts once seen, and not over a window', () => {
    expect(startsMoonHint({ ...base, seen: true })).toBe(false);
    expect(startsMoonHint({ ...base, home: false })).toBe(false);
  });
});
