import { describe, expect, it } from 'vitest';
import type { AppOwnerRow } from '../../../../api/generated/AppOwnerRow';
import { lockedCell, lockedFor, lockedSentence, lockedWords, ownerRows, ownersSummary } from './owners';

const owner = (over: Partial<AppOwnerRow> & { owner: string }): AppOwnerRow => ({
  apps: 2,
  instances: 10,
  cores: 8,
  ram_gb: 16,
  ssd_gb: 100,
  ...over,
});

describe('lockedFor', () => {
  it('is exact for an owner with no enterprise app', () => {
    expect(lockedFor(8, 10, 0, true)).toEqual({ kind: 'exact', value: 8 });
  });

  it('is at least what is shown for an owner that also runs enterprise apps, whose size is private', () => {
    expect(lockedFor(8, 10, 4, true)).toEqual({ kind: 'atLeast', value: 8 });
  });

  it('is unknown, not zero, for an owner whose running instances are all enterprise', () => {
    expect(lockedFor(0, 10, 10, true)).toEqual({ kind: 'unknown' });
  });

  it('is a true zero for an owner with nothing running', () => {
    expect(lockedFor(0, 0, 0, true)).toEqual({ kind: 'exact', value: 0 });
    expect(lockedFor(0, 0, null, true)).toEqual({ kind: 'exact', value: 0 });
  });

  it('without the index, takes the network-wide fact: enterprise apps exist, so a figure is a floor', () => {
    expect(lockedFor(8, 10, null, true)).toEqual({ kind: 'atLeast', value: 8 });
    expect(lockedFor(0, 10, null, true)).toEqual({ kind: 'unknown' });
  });

  it('without the index and without enterprise apps anywhere, takes the figure as exact', () => {
    expect(lockedFor(8, 10, null, false)).toEqual({ kind: 'exact', value: 8 });
  });
});

describe('ownerRows', () => {
  const owners = [
    owner({ owner: 'a', instances: 50 }),
    owner({ owner: 'b', instances: 25, cores: 0, ram_gb: 0, ssd_gb: 0 }),
  ];

  it('shares the instances out against the total, and has no share while the total is not known', () => {
    const rows = ownerRows(owners, new Map(), false, 200);
    expect(rows[0]?.share).toBeCloseTo(0.25);
    expect(ownerRows(owners, new Map(), false, null)[0]?.share).toBeNull();
    expect(ownerRows(owners, new Map(), false, 0)[0]?.share).toBeNull();
  });

  it('reads each owner against the enterprise instances the index shows for it', () => {
    const rows = ownerRows(owners, new Map([['b', { apps: 2, instances: 25 }]]), true, 200);
    expect(rows[0]?.cores).toEqual({ kind: 'exact', value: 8 });
    expect(rows[0]?.enterpriseApps).toBe(0);
    expect(rows[1]?.cores).toEqual({ kind: 'unknown' });
    expect(rows[1]?.enterpriseApps).toBe(2);
  });

  it('does not know whether an owner runs enterprise apps until the index is loaded', () => {
    const rows = ownerRows(owners, null, true, 200);
    expect(rows[0]?.enterpriseApps).toBeNull();
    expect(rows[0]?.cores).toEqual({ kind: 'atLeast', value: 8 });
  });
});

describe('ownersSummary', () => {
  it('names how many are listed, how many there are, and the largest', () => {
    const rows = ownerRows([owner({ owner: 'a', instances: 1200, apps: 3 })], new Map(), false, 5000);
    expect(ownersSummary(rows, 10, 1396)).toBe(
      'The 10 owners with the most running instances, of 1,396 in the index. The largest runs 1,200 instances in 3 apps.',
    );
  });

  it('says there are none when there are none', () => {
    expect(ownersSummary([], 0, 0)).toBe('No app owners.');
  });
});

describe('lockedCell and lockedWords', () => {
  it('shows cores as a number and memory and storage with their unit', () => {
    expect(lockedCell({ kind: 'exact', value: 1234.4 }, 'cpu')).toBe('1,234');
    expect(lockedCell({ kind: 'exact', value: 12_129 }, 'ram')).toBe('12.1 TB');
    expect(lockedCell({ kind: 'exact', value: 500 }, 'ssd')).toBe('500 GB');
  });

  it('marks a floor with a plus, and an unknown with the word', () => {
    expect(lockedCell({ kind: 'atLeast', value: 42 }, 'cpu')).toBe('42+');
    expect(lockedCell({ kind: 'unknown' }, 'cpu')).toBe('Unknown');
  });

  it('says a floor in words for a screen reader', () => {
    expect(lockedWords({ kind: 'atLeast', value: 42 }, 'cpu')).toBe('at least 42');
    expect(lockedWords({ kind: 'exact', value: 42 }, 'cpu')).toBe('42');
    expect(lockedWords({ kind: 'unknown' }, 'ram')).toBe('Unknown');
  });
});

describe('lockedSentence', () => {
  const base = { owner: 'a', apps: 2, instances: 10, share: 0.1, enterpriseApps: 0 };

  it('says what the instances lock', () => {
    const r = {
      ...base,
      cores: { kind: 'exact', value: 42 },
      ramGb: { kind: 'exact', value: 120 },
      ssdGb: { kind: 'exact', value: 1100 },
    } as const;
    expect(lockedSentence(r)).toBe('Locks 42 cores, 120 GB memory and 1.1 TB storage.');
  });

  it('says it is at least that much when the owner also runs enterprise apps', () => {
    const r = {
      ...base,
      cores: { kind: 'atLeast', value: 42 },
      ramGb: { kind: 'atLeast', value: 120 },
      ssdGb: { kind: 'atLeast', value: 1100 },
    } as const;
    expect(lockedSentence(r)).toBe(
      'Locks at least 42 cores, 120 GB memory and 1.1 TB storage; its enterprise apps keep their size private.',
    );
  });

  it('says it is not known when every instance is an enterprise app, not that it locks nothing', () => {
    const r = {
      ...base,
      cores: { kind: 'unknown' },
      ramGb: { kind: 'unknown' },
      ssdGb: { kind: 'unknown' },
    } as const;
    expect(lockedSentence(r)).toContain('Not known');
  });
});
