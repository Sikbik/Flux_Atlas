import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GLOBE_ARTS, GLOBE_BORDERS, parseUi, useUi } from './ui';

const KEY = 'atlas.ui.v1';

/** A minimal localStorage: the store only reads and writes one key. */
function fakeStorage(initial: Record<string, string> = {}): Storage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('the borders setting', () => {
  it('offers off, countries and states', () => {
    expect(GLOBE_BORDERS).toEqual(['off', 'countries', 'states']);
    // It sits next to the look picker, which keeps its three looks.
    expect(GLOBE_ARTS).toEqual(['marble', 'holo', 'neon']);
  });

  it('reads a stored value, and drops one it does not know', () => {
    expect(parseUi(JSON.stringify({ globeBorders: 'off' }))).toEqual({ globeBorders: 'off' });
    expect(parseUi(JSON.stringify({ globeBorders: 'countries' }))).toEqual({ globeBorders: 'countries' });
    expect(parseUi(JSON.stringify({ globeBorders: 'states' }))).toEqual({ globeBorders: 'states' });
    for (const bad of ['STATES', 'all', '', 1, true, null, ['states'], { v: 'states' }]) {
      expect(parseUi(JSON.stringify({ globeBorders: bad }))).toEqual({});
    }
  });

  it('keeps the other preferences when it is the only thing that is wrong', () => {
    const raw = JSON.stringify({ motion: 'reduced', perf: 'lite', globeArt: 'neon', globeBorders: 'nope' });
    expect(parseUi(raw)).toEqual({ motion: 'reduced', perf: 'lite', globeArt: 'neon' });
  });

  it('is absent from what an older client stored, so the default applies', () => {
    const old = JSON.stringify({ motion: 'full', perf: 'auto', globeArt: 'holo', watched: [] });
    expect(parseUi(old)).not.toHaveProperty('globeBorders');
    expect(parseUi(null)).toEqual({});
    expect(parseUi('not json')).toEqual({});
  });
});

describe('persistence of the borders setting', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to countries and states, with nothing stored', async () => {
    vi.stubGlobal('localStorage', fakeStorage());
    const { useUi: fresh } = await import('./ui');
    expect(fresh.getState().globeBorders).toBe('states');
  });

  it('writes the choice with the other preferences, and a fresh page reads it back', async () => {
    const storage = fakeStorage();
    vi.stubGlobal('localStorage', storage);
    const first = await import('./ui');
    first.useUi.getState().setGlobeArt('neon');
    first.useUi.getState().setGlobeBorders('countries');
    expect(first.useUi.getState().globeBorders).toBe('countries');
    const stored = JSON.parse(storage.getItem(KEY) ?? '{}');
    expect(stored).toMatchObject({ globeArt: 'neon', globeBorders: 'countries' });

    // A new page: the module loads again and finds the stored value.
    vi.resetModules();
    const second = await import('./ui');
    expect(second.useUi.getState().globeBorders).toBe('countries');
    expect(second.useUi.getState().globeArt).toBe('neon');
    second.useUi.getState().setGlobeBorders('off');
    vi.resetModules();
    const third = await import('./ui');
    expect(third.useUi.getState().globeBorders).toBe('off');
  });

  it('migrates a payload from before the setting existed: everyone gets countries and states', async () => {
    const legacy = JSON.stringify({ motion: 'reduced', perf: 'balanced', globeArt: 'holo', watched: [] });
    const storage = fakeStorage({ [KEY]: legacy });
    vi.stubGlobal('localStorage', storage);
    const { useUi: fresh } = await import('./ui');
    expect(fresh.getState()).toMatchObject({
      motion: 'reduced',
      perf: 'balanced',
      globeArt: 'holo',
      globeBorders: 'states',
    });
    // The first change writes the whole record, the new field included.
    fresh.getState().setGlobeBorders('countries');
    expect(JSON.parse(storage.getItem(KEY) ?? '{}')).toMatchObject({
      motion: 'reduced',
      perf: 'balanced',
      globeArt: 'holo',
      globeBorders: 'countries',
    });
  });

  it('ignores a damaged value and storage that throws', async () => {
    vi.stubGlobal('localStorage', fakeStorage({ [KEY]: JSON.stringify({ globeBorders: 'everything' }) }));
    const { useUi: damaged } = await import('./ui');
    expect(damaged.getState().globeBorders).toBe('states');

    vi.resetModules();
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    });
    const { useUi: blocked } = await import('./ui');
    expect(blocked.getState().globeBorders).toBe('states');
    // The choice still applies for the session when it cannot be saved.
    blocked.getState().setGlobeBorders('off');
    expect(blocked.getState().globeBorders).toBe('off');
  });

  it('is part of the shared store the page uses', () => {
    expect(useUi.getState().globeBorders).toBeDefined();
    expect(typeof useUi.getState().setGlobeBorders).toBe('function');
  });
});
