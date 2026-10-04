import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_COLUMNS } from './lib/fleet';
import { KEY, MAX_COST, parsePrefs, useWalletPrefs } from './prefs';

describe('parsePrefs', () => {
  it('gives the defaults for nothing stored, and for what is not JSON', () => {
    for (const raw of [null, undefined, '', 'not json', '[1,2', '"just a string"']) {
      const p = parsePrefs(raw);
      expect(p.currency).toBe('usd');
      expect(p.density).toBe('comfortable');
      expect(p.groupBy).toBe('none');
      expect(p.includePa).toBe(true);
      expect(p.earningsRange).toBe('all');
      expect(p.horizon).toBe('24h');
      expect(p.columns).toEqual([...DEFAULT_COLUMNS]);
      expect(p.costs.perNode).toEqual({ cumulus: 0, nimbus: 0, stratus: 0 });
    }
  });

  it('keeps what was stored', () => {
    const p = parsePrefs(
      JSON.stringify({
        currency: 'eur',
        includePa: false,
        density: 'compact',
        groupBy: 'country',
        earningsRange: '7d',
        horizon: '72h',
        columns: ['node', 'payout', 'country'],
        costs: { currency: 'eur', perNode: { cumulus: 3, nimbus: 7.5, stratus: 20 } },
      }),
    );
    expect(p.currency).toBe('eur');
    expect(p.includePa).toBe(false);
    expect(p.density).toBe('compact');
    expect(p.groupBy).toBe('country');
    expect(p.earningsRange).toBe('7d');
    expect(p.horizon).toBe('72h');
    expect(p.columns).toEqual(['node', 'payout', 'country']);
    expect(p.costs).toEqual({ currency: 'eur', perNode: { cumulus: 3, nimbus: 7.5, stratus: 20 } });
  });

  it('falls back piece by piece: one bad field does not take the others with it', () => {
    const p = parsePrefs(
      JSON.stringify({
        currency: 'doubloons',
        density: 'huge',
        groupBy: 'zodiac',
        earningsRange: '3y',
        horizon: '1w',
        includePa: 'yes',
        columns: ['node', 'payout'],
      }),
    );
    expect(p.currency).toBe('usd');
    expect(p.density).toBe('comfortable');
    expect(p.groupBy).toBe('none');
    expect(p.earningsRange).toBe('all');
    expect(p.horizon).toBe('24h');
    expect(p.includePa).toBe(true);
    expect(p.columns).toEqual(['node', 'payout']);
  });

  it('cleans the costs: nothing negative, nothing absurd, nothing that is not a number', () => {
    const p = parsePrefs(
      JSON.stringify({
        costs: { currency: 'usd', perNode: { cumulus: -4, nimbus: 99_999_999, stratus: 'ten' } },
      }),
    );
    expect(p.costs.perNode).toEqual({ cumulus: 0, nimbus: MAX_COST, stratus: 0 });
  });

  it('keeps the costs in the currency they were entered in, else the chosen one', () => {
    expect(
      parsePrefs(JSON.stringify({ currency: 'gbp', costs: { currency: 'eur', perNode: {} } })).costs.currency,
    ).toBe('eur');
    expect(
      parsePrefs(JSON.stringify({ currency: 'gbp', costs: { currency: '??', perNode: {} } })).costs.currency,
    ).toBe('gbp');
  });

  it('cleans the column list: known columns only, once each, the node first, in the table order', () => {
    const p = parsePrefs(JSON.stringify({ columns: ['country', 'payout', 'nope', 'payout', 7] }));
    expect(p.columns[0]).toBe('node');
    expect(p.columns).toContain('country');
    expect(p.columns).toContain('payout');
    expect(p.columns).not.toContain('nope');
    expect(new Set(p.columns).size).toBe(p.columns.length);
    expect(p.columns.indexOf('payout')).toBeLessThan(p.columns.indexOf('country'));
  });

  it('gives the default columns when the stored value is not a list', () => {
    expect(parsePrefs(JSON.stringify({ columns: 'node' })).columns).toEqual([...DEFAULT_COLUMNS]);
  });

  it('does not share its default objects between reads', () => {
    const a = parsePrefs(null);
    a.costs.perNode.stratus = 99;
    a.columns.push('age');
    const b = parsePrefs(null);
    expect(b.costs.perNode.stratus).toBe(0);
    expect(b.columns).toEqual([...DEFAULT_COLUMNS]);
  });
});

describe('the preferences store', () => {
  let disk: Map<string, string>;

  beforeEach(() => {
    disk = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => disk.get(k) ?? null,
      setItem: (k: string, v: string) => void disk.set(k, v),
      removeItem: (k: string) => void disk.delete(k),
    });
    useWalletPrefs.setState(parsePrefs(null));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes every change to the browser, and the stored copy reads back the same', () => {
    useWalletPrefs.getState().setCurrency('eur');
    useWalletPrefs.getState().setDensity('compact');
    useWalletPrefs.getState().setGroupBy('provider');
    const stored = parsePrefs(disk.get(KEY));
    expect(stored.currency).toBe('eur');
    expect(stored.density).toBe('compact');
    expect(stored.groupBy).toBe('provider');
  });

  it('sets one tier cost at a time, and never a bad number', () => {
    const { setCost } = useWalletPrefs.getState();
    setCost('stratus', 40);
    setCost('nimbus', -1);
    setCost('cumulus', Number.NaN);
    const costs = useWalletPrefs.getState().costs;
    expect(costs.perNode).toEqual({ cumulus: 0, nimbus: 0, stratus: 40 });
    setCost('stratus', 5e9);
    expect(useWalletPrefs.getState().costs.perNode.stratus).toBe(MAX_COST);
  });

  it('ignores a tier that does not earn', () => {
    useWalletPrefs.getState().setCost('unknown' as never, 12);
    expect(useWalletPrefs.getState().costs.perNode).toEqual({ cumulus: 0, nimbus: 0, stratus: 0 });
  });

  it('replaces all the costs at once, and clears them', () => {
    useWalletPrefs.getState().setCosts({ currency: 'eur', perNode: { cumulus: 1, nimbus: 2, stratus: 3 } });
    expect(useWalletPrefs.getState().costs).toEqual({
      currency: 'eur',
      perNode: { cumulus: 1, nimbus: 2, stratus: 3 },
    });
    useWalletPrefs.getState().clearCosts();
    expect(useWalletPrefs.getState().costs.perNode).toEqual({ cumulus: 0, nimbus: 0, stratus: 0 });
  });

  it('keeps the node column however the columns are set', () => {
    useWalletPrefs.getState().setColumns(['country', 'provider']);
    expect(useWalletPrefs.getState().columns[0]).toBe('node');
  });

  it('carries on when the browser will not store anything', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    });
    expect(() => useWalletPrefs.getState().setIncludePa(false)).not.toThrow();
    expect(useWalletPrefs.getState().includePa).toBe(false);
  });
});
