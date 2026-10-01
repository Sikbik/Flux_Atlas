import { beforeAll, describe, expect, it } from 'vitest';
import { NetworkStore } from '../../../store/network';
import { bootstrap, syntheticNodesBin } from '../../../testing/fixtures';
import { statusMeta } from '../../../ui/chips/statusMeta';
import {
  altForRadius,
  buildLocalIndex,
  classifyIpQuery,
  getLocalIndex,
  hostOf,
  type LocalIndex,
  matchApps,
  matchCities,
  matchCountries,
  matchEndpoints,
  matchProviders,
  matchVersions,
  nodeFacts,
  nodeSubline,
  STATUS_FACT,
  shareText,
  UNREACHABLE_FACT,
} from './local';

let store: NetworkStore;
let index: LocalIndex;

beforeAll(() => {
  store = new NetworkStore();
  store.loadSnapshot({ bootstrap: bootstrap(), nodes: syntheticNodesBin(600) });
  // The synthetic table carries no FluxOS versions: stamp two on it.
  const current = store.nodes.versions.intern('8.20.0');
  const older = store.nodes.versions.intern('8.19.2');
  for (let i = 0; i < 600; i++) store.nodes.version[i] = i < 400 ? current : older;
  index = buildLocalIndex(store);
});

describe('hostOf', () => {
  it('splits the port off IPv4 and bracketed IPv6 endpoints', () => {
    expect(hostOf('5.0.0.1:16127')).toBe('5.0.0.1');
    expect(hostOf('[2001:db8::1]:16127')).toBe('2001:db8::1');
    expect(hostOf('5.0.0.1')).toBe('5.0.0.1');
  });
});

describe('classifyIpQuery', () => {
  it('recognises IP prefixes, complete IPs and ports', () => {
    expect(classifyIpQuery('65.109')).toMatchObject({ host: '65.109', port: null, complete: false });
    expect(classifyIpQuery('65.109.1.2')).toMatchObject({ complete: true });
    expect(classifyIpQuery('65.109.1.2:16127')).toMatchObject({
      host: '65.109.1.2',
      port: '16127',
      complete: true,
    });
    expect(classifyIpQuery('[2001:db8::1]:16127')).toMatchObject({
      ipv6: true,
      host: '2001:db8::1',
      port: '16127',
    });
  });

  it('leaves words, bare numbers and hashes alone', () => {
    expect(classifyIpQuery('hetzner')).toBeNull();
    expect(classifyIpQuery('2996914')).toBeNull();
    expect(classifyIpQuery('8aa97365')).toBeNull();
    expect(classifyIpQuery('')).toBeNull();
  });
});

describe('the index', () => {
  it('counts countries, providers, versions and cities from the node table', () => {
    expect(index.total).toBe(600);
    expect(index.countries.map((c) => c.code).sort()).toEqual(['DE', 'FI', 'US']);
    expect(index.countries.every((c) => c.name.length > 2 && c.alt >= 0.45 && c.alt <= 3)).toBe(true);
    expect(index.providers.map((p) => p.lower).sort()).toEqual(['hetzner online gmbh', 'ovh sas']);
    expect(index.versions).toEqual([
      { version: '8.20.0', count: 400 },
      { version: '8.19.2', count: 200 },
    ]);
    expect(index.cities.length).toBeGreaterThan(0);
    expect(index.cities[0]?.name).toMatch(/^City \d+$/);
  });

  it('is cached until the node table changes enough', () => {
    expect(getLocalIndex(store)).toBe(getLocalIndex(store));
  });

  it('frames small countries closer than large ones', () => {
    expect(altForRadius(0.02)).toBeLessThan(altForRadius(0.5));
    expect(altForRadius(0)).toBeGreaterThanOrEqual(0.45);
    expect(altForRadius(4)).toBeLessThanOrEqual(3);
  });
});

describe('matching endpoints', () => {
  it('finds nodes by IP prefix, complete IP and IP:port, best first', () => {
    const prefix = matchEndpoints(store, index, classifyIpQuery('5.0.0.1')!);
    expect(prefix.nodes.length).toBeGreaterThan(0);
    expect(prefix.total).toBeGreaterThanOrEqual(prefix.nodes.length);
    const exact = matchEndpoints(store, index, classifyIpQuery('5.0.0.7:16127')!);
    expect(store.nodes.endpoint(exact.nodes[0]!.row)).toBe('5.0.0.7:16127');
    expect(exact.nodes[0]!.score).toBe(100);
    expect(exact.hosts[0]?.ip).toBe('5.0.0.7');
  });

  it('finds nothing for an unknown IP', () => {
    expect(matchEndpoints(store, index, classifyIpQuery('9.9.9.9')!).nodes).toEqual([]);
  });
});

describe('describing a node', () => {
  it('reads facts from the table and never invents a zero', () => {
    const row = matchEndpoints(store, index, classifyIpQuery('5.0.0.7:16127')!).nodes[0]!.row;
    const f = nodeFacts(store, row);
    expect(f.endpoint).toBe('5.0.0.7:16127');
    expect(f.tier).not.toBeNull();
    expect(nodeSubline(f)).toMatch(/^(Cumulus|Nimbus|Stratus), /);
    expect(nodeSubline({ ...f, city: '', countryCode: '', queue: null })).toContain('Unknown location');
    expect(nodeSubline({ ...f, queue: 1 })).toContain('next in line');
    expect(nodeSubline({ ...f, queue: 12 })).toContain('queue #12');
  });
});

describe('node states', () => {
  it('are worded exactly as the kit words them, so the terminal and the chips agree', () => {
    for (const f of [...STATUS_FACT, UNREACHABLE_FACT]) {
      expect(statusMeta(f.kind).label).toBe(f.label);
    }
  });
});

describe('matching names', () => {
  it('finds apps by name, with a typo allowance', () => {
    expect(matchApps(store, 'kadena').items[0]?.name).toBe('kadenanode');
    expect(matchApps(store, 'kadenanod').items[0]?.name).toBe('kadenanode');
    expect(matchApps(store, 'zzzzzz').items).toEqual([]);
    expect(matchApps(store, '').total).toBe(0);
  });

  it('finds countries by name and code', () => {
    expect(matchCountries(index, 'fin')[0]?.item.code).toBe('FI');
    expect(matchCountries(index, 'de')[0]?.item.code).toBe('DE');
    expect(matchCountries(index, 'f')).toEqual([]);
  });

  it('finds providers, versions and cities', () => {
    expect(matchProviders(index, 'hetz')[0]?.item.lower).toBe('hetzner online gmbh');
    expect(matchProviders(index, 'he')).toEqual([]);
    expect(matchVersions(index, '8.20')[0]?.item.version).toBe('8.20.0');
    expect(matchVersions(index, 'v8.20.0')[0]?.score).toBe(95);
    expect(matchVersions(index, '8')).toEqual([]);
    expect(matchCities(index, 'city 3')[0]?.item.name).toBe('City 3');
  });
});

describe('shareText', () => {
  it('rounds to whole percents and says so when under one', () => {
    expect(shareText(250, 1000)).toBe('25% of the network');
    expect(shareText(3, 1000)).toBe('under 1% of the network');
    expect(shareText(1, 0)).toBe('');
  });
});
