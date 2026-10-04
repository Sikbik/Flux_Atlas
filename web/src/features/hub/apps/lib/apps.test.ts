import { describe, expect, it } from 'vitest';
import {
  type AppRank,
  appLabel,
  appsOfOwner,
  enterpriseByOwner,
  exampleApps,
  footprintOf,
  indexTotals,
  lockedBy,
  privateRunning,
  rankApps,
  rankValue,
} from './apps';
import { app, enterprise } from './fixtures';

const NETWORK = { cores: 1000, ram_gb: 2000, ssd_gb: 10_000 };

describe('lockedBy', () => {
  it('is the per-instance spec times the instances running, with memory in GiB', () => {
    const l = lockedBy(
      app({ name: 'a', per_instance: { cpu: 0.5, ram_mb: 2048, hdd_gb: 20 }, instances_running: 4 }),
    );
    expect(l).toEqual({ cores: 2, ram_gb: 8, ssd_gb: 80 });
  });

  it('counts the instances running, not the ones the spec asks for', () => {
    const l = lockedBy(app({ name: 'a', instances_target: 10, instances_running: 2 }));
    expect(l.cores).toBe(2);
  });
});

describe('indexTotals', () => {
  it('counts apps, apps with an instance up, instances, and the enterprise part of each', () => {
    const t = indexTotals([
      app({ name: 'a', instances_running: 5 }),
      app({ name: 'b', instances_running: 0 }),
      enterprise({ name: 'c', instances_running: 3 }),
      enterprise({ name: 'd', instances_running: 0 }),
    ]);
    expect(t).toEqual({
      apps: 4,
      active: 2,
      instances: 8,
      wanted: 12,
      enterpriseApps: 2,
      enterpriseInstances: 3,
    });
  });

  it('is all zeros for an empty index, which is a real count of nothing', () => {
    expect(indexTotals([])).toEqual({
      apps: 0,
      active: 0,
      instances: 0,
      wanted: 0,
      enterpriseApps: 0,
      enterpriseInstances: 0,
    });
  });
});

describe('footprintOf', () => {
  it('is the mean of the shares of the network cores, memory and storage', () => {
    const f = footprintOf({ cores: 10, ram_gb: 20, ssd_gb: 100 }, NETWORK);
    expect(f?.cpu).toBeCloseTo(0.01);
    expect(f?.ram).toBeCloseTo(0.01);
    expect(f?.ssd).toBeCloseTo(0.01);
    expect(f?.share).toBeCloseTo(0.01);
  });

  it('weighs the three resources equally', () => {
    const f = footprintOf({ cores: 1000, ram_gb: 0, ssd_gb: 0 }, NETWORK);
    expect(f?.share).toBeCloseTo(1 / 3);
  });

  it('is unknown, not zero, while any total of the network is not known', () => {
    expect(footprintOf({ cores: 1, ram_gb: 1, ssd_gb: 1 }, null)).toBeNull();
    expect(
      footprintOf({ cores: 1, ram_gb: 1, ssd_gb: 1 }, { cores: 100, ram_gb: 0, ssd_gb: 100 }),
    ).toBeNull();
    expect(
      footprintOf({ cores: 1, ram_gb: 1, ssd_gb: 1 }, { cores: Number.NaN, ram_gb: 1, ssd_gb: 1 }),
    ).toBeNull();
  });
});

describe('rankApps', () => {
  const apps = [
    app({ name: 'small', instances_running: 2, per_instance: { cpu: 1, ram_mb: 1024, hdd_gb: 10 } }),
    app({ name: 'wide', instances_running: 50, per_instance: { cpu: 0.1, ram_mb: 128, hdd_gb: 1 } }),
    app({ name: 'heavy', instances_running: 5, per_instance: { cpu: 8, ram_mb: 16_384, hdd_gb: 500 } }),
    enterprise({ name: 'secret', instances_running: 80 }),
    app({ name: 'idle', instances_running: 0 }),
  ];

  it('ranks by instances, enterprise apps included, and leaves out an app with none running', () => {
    expect(rankApps(apps, 'instances', NETWORK).map((r) => r.name)).toEqual([
      'secret',
      'wide',
      'heavy',
      'small',
    ]);
  });

  it('ranks by footprint, which is not the order of the instances', () => {
    expect(rankApps(apps, 'footprint', NETWORK).map((r) => r.name)).toEqual(['heavy', 'wide', 'small']);
  });

  it('leaves an enterprise app out of the footprint ranking: its size is private, not zero', () => {
    const r = rankApps(apps, 'instances', NETWORK).find((x) => x.name === 'secret');
    expect(r?.locked).toBeNull();
    expect(r?.footprint).toBeNull();
    expect(rankApps(apps, 'footprint', NETWORK).some((x) => x.name === 'secret')).toBe(false);
    expect(privateRunning(apps)).toBe(1);
  });

  it('has no footprint ranking while the network capacity is not known', () => {
    expect(rankApps(apps, 'footprint', null)).toEqual([]);
    expect(rankApps(apps, 'instances', null)).toHaveLength(4);
  });

  it('breaks a tie by the name, so the order does not move between renders', () => {
    const tie = [app({ name: 'b', instances_running: 4 }), app({ name: 'a', instances_running: 4 })];
    expect(rankApps(tie, 'instances', NETWORK).map((r) => r.name)).toEqual(['a', 'b']);
  });

  it('sizes a ranking by the value it is ranked by', () => {
    const first = rankApps(apps, 'instances', NETWORK)[0] as AppRank;
    const heavy = rankApps(apps, 'footprint', NETWORK)[0] as AppRank;
    expect(rankValue(first, 'instances')).toBe(80);
    expect(rankValue(heavy, 'footprint')).toBeCloseTo((40 / 1000 + 80 / 2000 + 2500 / 10_000) / 3);
  });
});

describe('enterpriseByOwner', () => {
  it('counts the enterprise apps of each owner and the instances of them that are running', () => {
    const m = enterpriseByOwner([
      enterprise({ name: 'a', owner: 'x', instances_running: 3 }),
      enterprise({ name: 'b', owner: 'x', instances_running: 2 }),
      enterprise({ name: 'c', owner: 'y', instances_running: 0 }),
      app({ name: 'd', owner: 'y', instances_running: 9 }),
    ]);
    expect(m.get('x')).toEqual({ apps: 2, instances: 5 });
    expect(m.get('y')).toEqual({ apps: 1, instances: 0 });
  });

  it('has no entry for an owner without an enterprise app', () => {
    expect(enterpriseByOwner([app({ name: 'd', owner: 'z', instances_running: 9 })]).has('z')).toBe(false);
  });
});

describe('appsOfOwner', () => {
  const apps = [
    app({ name: 'a1', owner: 'x', instances_running: 1 }),
    app({ name: 'a2', owner: 'x', instances_running: 9 }),
    app({ name: 'a3', owner: 'x', instances_running: 5 }),
    app({ name: 'b1', owner: 'y', instances_running: 99 }),
  ];

  it('lists the owner apps with the most instances first, and says how many more there are', () => {
    const o = appsOfOwner(apps, 'x', 2, NETWORK);
    expect(o.top.map((r) => r.name)).toEqual(['a2', 'a3']);
    expect(o.more).toBe(1);
  });

  it('has nothing for an owner the index does not know', () => {
    expect(appsOfOwner(apps, 'z', 5, NETWORK)).toEqual({ top: [], more: 0 });
  });
});

describe('appLabel', () => {
  it('shows the display name, else the registered name', () => {
    expect(appLabel({ name: 'abc', display_name: 'AbC' })).toBe('AbC');
    expect(appLabel({ name: 'abc', display_name: '' })).toBe('abc');
  });
});

describe('exampleApps', () => {
  const apps = [
    app({ name: 'foldingatrunonflux29', instances_running: 101 }),
    app({ name: 'foldingatrunonflux12', instances_running: 100 }),
    app({ name: 'blockbookbitcoincash23344', instances_running: 99 }),
    app({ name: 'explorer', display_name: 'Explorer', instances_running: 40 }),
    app({ name: 'idle', instances_running: 0 }),
    app({ name: 'wordpress', display_name: 'WordPress', instances_running: 30 }),
  ];

  it('offers the biggest apps, one from each family of similar names', () => {
    expect(exampleApps(apps, 2).map((a) => a.name)).toEqual(['foldingatrunonflux29', 'explorer']);
  });

  it('skips a name too long for a chip, and an app with nothing running', () => {
    const names = exampleApps(apps, 5).map((a) => a.name);
    expect(names).not.toContain('blockbookbitcoincash23344');
    expect(names).not.toContain('idle');
    expect(names).toEqual(['foldingatrunonflux29', 'explorer', 'wordpress']);
  });

  it('has none for an empty index', () => {
    expect(exampleApps([], 2)).toEqual([]);
  });
});
