import { describe, expect, it } from 'vitest';
import { sortRows } from '../../../ui/table/sorting';
import type { FleetNode } from '../../inspect/derive/operator';
import type { NodeAttention, NodeRow, WalletPayout } from '../types';
import {
  activeFilters,
  BUCKET_LABEL,
  blocksLong,
  blocksText,
  bucketOf,
  buildFleetRows,
  COLUMN_SPECS,
  cityKey,
  columnSpec,
  DEFAULT_COLUMNS,
  DEFAULT_SORT,
  type FleetFilter,
  type FleetRow,
  facetsOf,
  filterCount,
  filterFleet,
  filterForGroup,
  groupFleet,
  groupInFilter,
  groupOf,
  isFiltered,
  isGroupBy,
  NO_FILTER,
  nodesCsvHeader,
  nodesCsvRows,
  normalizeColumns,
  rowsInBucket,
  sameProvider,
  sortFleet,
  summarizeRows,
} from './fleet';

const op = (i: number) => `${String(i).padStart(64, '0')}:0`;

function node(i: number, over: Partial<FleetNode> = {}): FleetNode {
  return {
    id: i,
    outpoint: op(i),
    endpoint: `10.0.0.${i}:16127`,
    ip: `10.0.0.${i}`,
    port: 16127,
    tier: 'stratus',
    status: 'confirmed',
    reachable: true,
    sinceConfirm: 120,
    atRisk: false,
    position: i,
    lastPaid: 3_000_000 + i,
    version: '8.20.0',
    cores: 16,
    ramGb: 64,
    ssdGb: 960,
    appCount: 3,
    country: 'DE',
    org: 'Hetzner Online GmbH',
    lat: 50,
    lon: 10,
    perDay: 14.5,
    paPerDay: 14.5,
    paymentAddress: 't3c4Ef',
    present: true,
    ...over,
  };
}

function rosterRow(i: number, over: Partial<NodeRow> = {}): NodeRow {
  return {
    id: i,
    outpoint: op(i),
    endpoint: `10.0.0.${i}:16127`,
    tier: 'stratus',
    status: 'confirmed',
    rank: i,
    payment_address: 't3c4Ef',
    country_code: 'DE',
    country: 'Germany',
    city: 'Nuremberg',
    region: 'Bavaria',
    org: 'Hetzner Online GmbH',
    lat: 50,
    lon: 10,
    app_count: 3,
    added_height: 2_700_000 + i,
    last_paid_height: 3_000_000 + i,
    last_confirmed_height: 3_005_000,
    flux_os: '8.20.0',
    arcane: true,
    reachable: true,
    ...over,
  };
}

const pay = (i: number, eta: number, amount = '9.00000000'): WalletPayout => ({
  node_key: op(i),
  tier: 'stratus',
  height: 3_006_100 + i,
  eta_ms: eta,
  amount,
});

const attn = (i: number, kind: NodeAttention['reasons'][number]['kind']): NodeAttention => ({
  node_key: op(i),
  reasons: [{ kind, detail: 'x', metric: null, value: null, threshold: null }],
});

function rows(): FleetRow[] {
  const nodes = [
    node(1),
    node(2, { country: 'FI', org: 'Hetzner', version: '8.19.1', tier: 'nimbus', perDay: 6, paPerDay: 6 }),
    node(3, { status: 'dos', sinceConfirm: 300 }),
    node(4, { country: 'FI', reachable: false }),
    node(5, { present: false }),
  ];
  const roster = [
    rosterRow(1),
    rosterRow(2, { country: 'Finland', country_code: 'FI', city: 'Helsinki', arcane: false }),
    rosterRow(3),
    rosterRow(4, { country: 'Finland', country_code: 'FI', city: 'Helsinki' }),
    rosterRow(5),
  ];
  return buildFleetRows(
    nodes,
    roster,
    [pay(2, 2000), pay(1, 1000), pay(4, 3000, '3.50000000')],
    [attn(2, 'version_outdated')],
  );
}

describe('buildFleetRows', () => {
  const r = rows();
  it('makes a row per node, keyed by outpoint', () => {
    expect(r).toHaveLength(5);
    expect(r[0]?.key).toBe(op(1));
    expect(r[0]?.id).toBe(1);
  });

  it('joins the next payment, the findings and the roster record by outpoint', () => {
    expect(r[0]?.etaMs).toBe(1000);
    expect(r[0]?.amount).toBe(9);
    expect(r[3]?.amount).toBe(3.5);
    expect(r[2]?.etaMs).toBeNull();
    expect(r[1]?.issues).toEqual(['version_outdated']);
    expect(r[1]?.severity).toBe('info');
    expect(r[0]?.issues).toEqual([]);
    expect(r[1]?.city).toBe('Helsinki');
    expect(r[1]?.country).toBe('Finland');
    expect(r[1]?.arcane).toBe(false);
    expect(r[0]?.addedHeight).toBe(2_700_001);
  });

  it('counts the queue place from one', () => {
    expect(r[0]?.place).toBe(2);
  });

  it('gives a node with no outpoint a key of its own', () => {
    const out = buildFleetRows([node(7, { outpoint: '' })], [], [], []);
    expect(out[0]?.key).toBe('#7');
    expect(out[0]?.city).toBe('');
  });
});

describe('bucketOf', () => {
  const r = rows();
  it('sorts nodes into healthy, attention and down', () => {
    expect(bucketOf(r[0] as FleetRow)).toBe('healthy');
    expect(bucketOf(r[1] as FleetRow)).toBe('attention');
    expect(bucketOf(r[2] as FleetRow)).toBe('down');
    expect(bucketOf(r[3] as FleetRow)).toBe('attention');
    expect(bucketOf(r[4] as FleetRow)).toBe('down');
    expect(BUCKET_LABEL.down).toBe('Down or gone');
  });
});

describe('filterFleet', () => {
  const r = rows();
  const f = (over: Partial<FleetFilter>): FleetFilter => ({ ...NO_FILTER, ...over });
  const keys = (list: FleetRow[]) => list.map((x) => x.id);

  it('passes everything when nothing is set', () => {
    expect(keys(filterFleet(r, NO_FILTER))).toEqual([1, 2, 3, 4, 5]);
    expect(isFiltered(NO_FILTER)).toBe(false);
    expect(filterCount(NO_FILTER)).toBe(0);
  });

  it('filters by tier, state, country, provider and version', () => {
    expect(keys(filterFleet(r, f({ tiers: ['nimbus'] })))).toEqual([2]);
    expect(keys(filterFleet(r, f({ buckets: ['down'] })))).toEqual([3, 5]);
    expect(keys(filterFleet(r, f({ buckets: ['healthy', 'attention'] })))).toEqual([1, 2, 4]);
    expect(keys(filterFleet(r, f({ country: 'FI' })))).toEqual([2, 4]);
    expect(keys(filterFleet(r, f({ provider: 'Hetzner' })))).toEqual([2]);
    expect(keys(filterFleet(r, f({ version: '8.19.1' })))).toEqual([2]);
  });

  it('adds filters up: a node must pass them all', () => {
    expect(keys(filterFleet(r, f({ country: 'FI', buckets: ['attention'], tiers: ['stratus'] })))).toEqual([
      4,
    ]);
    expect(filterCount(f({ country: 'FI', buckets: ['attention'], tiers: ['stratus'], text: 'x' }))).toBe(4);
  });

  it('searches endpoint, place, provider and version, ignoring case', () => {
    expect(keys(filterFleet(r, f({ text: '10.0.0.3' })))).toEqual([3]);
    expect(keys(filterFleet(r, f({ text: 'HELSINKI' })))).toEqual([2, 4]);
    expect(keys(filterFleet(r, f({ text: '  8.19 ' })))).toEqual([2]);
    expect(keys(filterFleet(r, f({ text: 'nowhere' })))).toEqual([]);
    expect(isFiltered(f({ text: 'a' }))).toBe(true);
    expect(isFiltered(f({ text: '   ' }))).toBe(false);
  });

  it('never mutates the input', () => {
    const before = [...r];
    filterFleet(r, f({ country: 'FI' }));
    expect(r).toEqual(before);
  });
});

describe('facetsOf', () => {
  const r = rows();
  it('counts each choice, biggest first', () => {
    const fx = facetsOf(r);
    expect(fx.country).toEqual([
      { value: 'DE', label: 'Germany', count: 3 },
      { value: 'FI', label: 'Finland', count: 2 },
    ]);
    expect(fx.provider[0]).toEqual({ value: 'Hetzner Online GmbH', label: 'Hetzner Online GmbH', count: 4 });
    expect(fx.version.map((v) => v.value)).toEqual(['8.20.0', '8.19.1']);
  });

  it('leaves out a node with no value', () => {
    const out = facetsOf(buildFleetRows([node(1, { version: null })], [], [], []));
    expect(out.version).toEqual([]);
  });
});

describe('groupFleet', () => {
  const r = rows();
  it('is empty for no grouping', () => {
    expect(groupFleet(r, 'none')).toEqual([]);
  });

  it('groups by a dimension, biggest first, with the totals of each', () => {
    const g = groupFleet(r, 'country');
    expect(g.map((x) => [x.label, x.nodes])).toEqual([
      ['Germany', 3],
      ['Finland', 2],
    ]);
    const fi = g[1];
    expect(fi?.healthy).toBe(0);
    expect(fi?.trouble).toBe(2);
    expect(fi?.nextEtaMs).toBe(2000);
    expect(fi?.due).toBeCloseTo(12.5, 9);
    expect(fi?.apps).toBe(6);
    expect(fi?.perDay).toBeCloseTo(20.5, 9);
    expect(fi?.paPerDay).toBeCloseTo(20.5, 9);
  });

  it('groups by state and tier with their own words', () => {
    expect(groupFleet(r, 'state').map((x) => x.label)).toEqual([
      'Down or gone',
      'Needs attention',
      'Healthy',
    ]);
    expect(groupFleet(r, 'tier').map((x) => x.label)).toEqual(['Stratus', 'Nimbus']);
  });

  it('keeps rows in their given order inside a group', () => {
    expect(groupFleet(r, 'country')[0]?.rows.map((x) => x.id)).toEqual([1, 3, 5]);
  });

  it('names a node with no value Unknown', () => {
    const [x] = buildFleetRows([node(1, { org: '' })], [], [], []);
    expect(groupOf(x as FleetRow, 'provider')).toEqual(['?', 'Unknown provider']);
    expect(groupOf(x as FleetRow, 'city')).toEqual(['?', 'Unknown city']);
  });

  it('knows the groupings', () => {
    expect(isGroupBy('provider')).toBe(true);
    expect(isGroupBy('zone')).toBe(false);
  });
});

describe('columns', () => {
  it('keeps the node column first and drops what it does not know', () => {
    expect(normalizeColumns(['version', 'bogus', 'node', 'apps', 'apps'])).toEqual([
      'node',
      'version',
      'apps',
    ]);
    expect(normalizeColumns(['apps'])).toEqual(['node', 'apps']);
  });

  it('falls back to the defaults for anything that is not a list', () => {
    expect(normalizeColumns(undefined)).toEqual([...DEFAULT_COLUMNS]);
    expect(normalizeColumns('node')).toEqual([...DEFAULT_COLUMNS]);
  });

  it('keeps columns in the table order whatever order they are stored in', () => {
    expect(normalizeColumns(['apps', 'version', 'payout'])).toEqual(['node', 'payout', 'version', 'apps']);
  });

  it('sorts by the value a viewer expects, missing last', () => {
    const r = rows();
    const byPayout = sortRows(r, columnSpec('payout').sort, 'asc');
    expect(byPayout.map((x) => x.id)).toEqual([1, 2, 4, 3, 5]);
    const byCountry = sortRows(r, columnSpec('country').sort, 'asc');
    expect(byCountry[0]?.country).toBe('Finland');
    const byApps = sortRows(r, columnSpec('apps').sort, 'desc');
    expect(byApps).toHaveLength(5);
  });

  it('has a spec for every column id once', () => {
    const ids = COLUMN_SPECS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DEFAULT_COLUMNS.every((d) => ids.includes(d))).toBe(true);
  });
});

describe('nodes CSV', () => {
  const r = rows();
  it('has a header per column and a row of the same width per node', () => {
    const header = nodesCsvHeader();
    const body = nodesCsvRows(r);
    expect(body).toHaveLength(5);
    expect(body.every((x) => x.length === header.length)).toBe(true);
    expect(header[0]).toBe('node_outpoint');
  });

  it('writes the whole record of a node', () => {
    const header = nodesCsvHeader();
    const row = nodesCsvRows(r)[0] as (string | number | boolean | null)[];
    const at = (h: string) => row[header.indexOf(h)];
    expect(at('endpoint')).toBe('10.0.0.1:16127');
    expect(at('tier')).toBe('stratus');
    expect(at('state')).toBe('healthy');
    expect(at('next_payout_utc')).toBe('1970-01-01 00:00:01');
    expect(at('next_payout_flux')).toBe(9);
    expect(at('country')).toBe('Germany');
    expect(at('provider')).toBe('Hetzner Online GmbH');
    expect(at('arcane')).toBe(true);
    expect(at('ram_gb')).toBe(64);
    expect(at('apps')).toBe(3);
    // The run rate as main chain, parallel assets and the two together, whatever the viewer counts.
    expect(at('est_flux_per_day')).toBe(14.5);
    expect(at('est_parallel_assets_flux_per_day')).toBe(14.5);
    expect(at('est_main_chain_and_parallel_assets_flux_per_day')).toBe(29);
  });

  it('leaves a missing value empty, not zero', () => {
    const header = nodesCsvHeader();
    const row = nodesCsvRows(r)[2] as (string | number | boolean | null)[];
    expect(row[header.indexOf('next_payout_utc')]).toBeNull();
    expect(row[header.indexOf('next_payout_flux')]).toBeNull();
    const down = nodesCsvRows(r)[4] as (string | number | boolean | null)[];
    expect(down[header.indexOf('state')]).toBe('down');
  });

  it("lists a node's findings", () => {
    const header = nodesCsvHeader();
    const row = nodesCsvRows(r)[1] as (string | number | boolean | null)[];
    expect(row[header.indexOf('issues')]).toBe('version_outdated');
  });
});

describe('sortFleet', () => {
  const r = rows();
  const ids = (list: FleetRow[]) => list.map((x) => x.id);

  it('opens on the next payment, soonest first, with the nodes that are not queued last', () => {
    expect(DEFAULT_SORT).toEqual({ id: 'payout', dir: 'asc' });
    expect(ids(sortFleet(r, DEFAULT_SORT))).toEqual([1, 2, 4, 3, 5]);
  });

  it('puts a missing value last in both directions', () => {
    expect(ids(sortFleet(r, { id: 'payout', dir: 'desc' }))).toEqual([4, 2, 1, 3, 5]);
  });

  it('lists the oldest node first when age is sorted from the top', () => {
    expect(ids(sortFleet(r, { id: 'age', dir: 'desc' }))).toEqual([1, 2, 3, 4, 5]);
    expect(ids(sortFleet(r, { id: 'age', dir: 'asc' }))).toEqual([5, 4, 3, 2, 1]);
  });

  it('keeps the order for no sort or a column it does not know, and never hands back the input', () => {
    expect(ids(sortFleet(r, null))).toEqual([1, 2, 3, 4, 5]);
    expect(ids(sortFleet(r, { id: 'bogus', dir: 'asc' }))).toEqual([1, 2, 3, 4, 5]);
    expect(sortFleet(r, null)).not.toBe(r);
  });

  it('starts the payment columns soonest first and the rest biggest first', () => {
    expect(columnSpec('payout').firstDir).toBe('asc');
    expect(columnSpec('place').firstDir).toBe('asc');
    expect(columnSpec('perDay').firstDir).toBeUndefined();
  });
});

describe('summarizeRows', () => {
  const r = rows();

  it('totals the nodes by health, tier, earning, findings and apps', () => {
    const s = summarizeRows(r);
    expect(s.nodes).toBe(5);
    expect([s.healthy, s.attention, s.down]).toEqual([1, 2, 2]);
    expect(s.tiers).toEqual({ cumulus: 0, nimbus: 1, stratus: 4 });
    expect(s.perDay).toBeCloseTo(64, 9);
    expect(s.paPerDay).toBeCloseTo(64, 9);
    expect(s.flagged).toBe(1);
    expect(s.apps).toBe(15);
    expect(s.hosts).toBe(5);
  });

  it('finds the soonest payment and who it goes to', () => {
    expect(summarizeRows(r).next).toEqual({ etaMs: 1000, amount: 9, key: op(1) });
    expect(summarizeRows([r[3] as FleetRow]).next).toEqual({ etaMs: 3000, amount: 3.5, key: op(4) });
  });

  it('says nothing is known rather than zero', () => {
    const none = summarizeRows([]);
    expect(none.nodes).toBe(0);
    expect(none.perDay).toBeNull();
    expect(none.next).toBeNull();
    expect(summarizeRows([r[2] as FleetRow]).next).toBeNull();
  });

  it('counts nodes on one host address once', () => {
    const [a, b] = buildFleetRows([node(1), node(2, { ip: '10.0.0.1' })], [], [], []);
    expect(summarizeRows([a as FleetRow, b as FleetRow]).hosts).toBe(1);
  });
});

describe('activeFilters', () => {
  const r = rows();
  const facets = facetsOf(r);

  it('is empty when nothing is set', () => {
    expect(activeFilters(NO_FILTER, facets)).toEqual([]);
  });

  it('makes one chip per choice, in the order the filters read, each with what removes it', () => {
    const f: FleetFilter = {
      text: ' abc ',
      tiers: ['nimbus', 'stratus'],
      buckets: ['down'],
      country: 'FI',
      city: 'FI:Helsinki',
      provider: 'Hetzner',
      version: '8.19.1',
      only: { label: '2 nodes close to expiring', keys: [op(1), op(2)] },
    };
    const chips = activeFilters(f, facets);
    expect(chips.map((c) => c.label)).toEqual([
      'Search: abc',
      '2 nodes close to expiring',
      'Tier: Nimbus',
      'Tier: Stratus',
      'State: Down or gone',
      'Country: Finland',
      'City: Helsinki',
      'Provider: Hetzner',
      'FluxOS: 8.19.1',
    ]);
    expect(chips.map((c) => c.clear)).toEqual([
      { text: '' },
      { only: null },
      { tiers: ['stratus'] },
      { tiers: ['nimbus'] },
      { buckets: [] },
      { country: null },
      { city: null },
      { provider: null },
      { version: null },
    ]);
    expect(new Set(chips.map((c) => c.id)).size).toBe(chips.length);
  });

  it('names a country the facets do not list by its code', () => {
    expect(activeFilters({ ...NO_FILTER, country: 'XX' }, facets)[0]?.label).toBe('Country: XX');
  });

  it('counts a city among the filters', () => {
    expect(filterCount({ ...NO_FILTER, city: 'FI:Helsinki' })).toBe(1);
    expect(isFiltered({ ...NO_FILTER, city: 'FI:Helsinki' })).toBe(true);
  });
});

describe('cities and groups as filters', () => {
  const r = rows();

  it('keys a city by country so two cities of one name stay apart', () => {
    expect(cityKey({ city: 'Helsinki', countryCode: 'FI' })).toBe('FI:Helsinki');
    expect(cityKey({ city: '', countryCode: 'FI' })).toBeNull();
    expect(groupOf(r[1] as FleetRow, 'city')[0]).toBe('FI:Helsinki');
  });

  it('filters by city', () => {
    const ids = filterFleet(r, { ...NO_FILTER, city: 'FI:Helsinki' }).map((x) => x.id);
    expect(ids).toEqual([2, 4]);
    expect(filterFleet(r, { ...NO_FILTER, city: 'DE:Helsinki' })).toEqual([]);
  });

  it('turns a group into the filter that narrows to it', () => {
    expect(filterForGroup('country', 'FI')).toEqual({ country: 'FI' });
    expect(filterForGroup('city', 'FI:Helsinki')).toEqual({ city: 'FI:Helsinki' });
    expect(filterForGroup('provider', 'Hetzner')).toEqual({ provider: 'Hetzner' });
    expect(filterForGroup('version', '8.20.0')).toEqual({ version: '8.20.0' });
    expect(filterForGroup('tier', 'stratus')).toEqual({ tiers: ['stratus'] });
    expect(filterForGroup('state', 'down')).toEqual({ buckets: ['down'] });
  });

  it('has no filter for an unknown group or a tier or state it does not know', () => {
    expect(filterForGroup('country', '?')).toBeNull();
    expect(filterForGroup('tier', 'unknown')).toBeNull();
    expect(filterForGroup('state', 'sleepy')).toBeNull();
    expect(filterForGroup('none', 'x')).toBeNull();
  });

  it('knows which group a filter has narrowed to', () => {
    expect(groupInFilter('country', { ...NO_FILTER, country: 'FI' })).toBe('FI');
    expect(groupInFilter('tier', { ...NO_FILTER, tiers: ['nimbus'] })).toBe('nimbus');
    expect(groupInFilter('tier', { ...NO_FILTER, tiers: ['nimbus', 'stratus'] })).toBeNull();
    expect(groupInFilter('state', { ...NO_FILTER, buckets: ['down'] })).toBe('down');
    expect(groupInFilter('provider', NO_FILTER)).toBeNull();
    expect(groupInFilter('none', { ...NO_FILTER, country: 'FI' })).toBeNull();
  });
});

describe('a named set of nodes', () => {
  const r = rows();
  const only = (keys: string[]) => ({ ...NO_FILTER, only: { label: 'these', keys } });

  it('keeps exactly the nodes named, and counts as one filter', () => {
    expect(filterFleet(r, only([op(2), op(4)])).map((x) => x.id)).toEqual([2, 4]);
    expect(filterFleet(r, only([])).map((x) => x.id)).toEqual([]);
    expect(filterCount(only([op(2)]))).toBe(1);
    expect(isFiltered(only([op(2)]))).toBe(true);
  });

  it('adds up with the other filters', () => {
    const f = { ...only([op(1), op(2), op(4)]), country: 'FI' };
    expect(filterFleet(r, f).map((x) => x.id)).toEqual([2, 4]);
  });
});

describe('rowsInBucket', () => {
  const r = rows();
  const ids = (list: FleetRow[]) => list.map((x) => x.id);

  it('finds a country by its code', () => {
    expect(ids(rowsInBucket(r, 'country', { key: 'FI', label: 'Finland' }))).toEqual([2, 4]);
  });

  it('finds a city by the server key, which is lower case and has the country in front', () => {
    expect(ids(rowsInBucket(r, 'city', { key: 'FI/helsinki', label: 'Helsinki' }))).toEqual([2, 4]);
    expect(ids(rowsInBucket(r, 'city', { key: 'DE/helsinki', label: 'Helsinki' }))).toEqual([]);
  });

  it('finds a provider by its name, in any of its spellings, or by its key', () => {
    expect(ids(rowsInBucket(r, 'provider', { key: 'as24940', label: 'Hetzner Online GmbH' }))).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(ids(rowsInBucket(r, 'provider', { key: 'hetzner', label: 'Something else' }))).toEqual([2]);
    expect(ids(rowsInBucket(r, 'provider', { key: 'as1', label: 'Other Company' }))).toEqual([]);
  });

  it('finds the nodes with no value in the unknown bucket', () => {
    const rs = buildFleetRows(
      [node(1, { org: '' }), node(2)],
      [rosterRow(1, { city: null }), rosterRow(2)],
      [],
      [],
    );
    expect(ids(rowsInBucket(rs, 'provider', { key: 'unknown', label: 'Unknown' }))).toEqual([1]);
    expect(ids(rowsInBucket(rs, 'city', { key: 'unknown', label: 'Unknown' }))).toEqual([1]);
    expect(ids(rowsInBucket(rs, 'country', { key: 'unknown', label: 'Unknown' }))).toEqual([]);
  });
});

describe('sameProvider', () => {
  it('takes company suffixes and punctuation off before it compares', () => {
    expect(sameProvider('Hetzner Online GmbH', 'Hetzner')).toBe(true);
    expect(sameProvider('HETZNER-DC', 'Hetzner Online GmbH')).toBe(true);
    expect(sameProvider('NEOCOM Ltd', 'Neocom')).toBe(true);
    expect(sameProvider('Stofa A/S', 'Stofa A/S')).toBe(true);
  });

  it('treats a shared long first word as one company, and a short one as nothing', () => {
    expect(sameProvider('Amazon Technologies Inc.', 'Amazon.com')).toBe(true);
    expect(sameProvider('OVH SAS', 'OVH Hosting')).toBe(false);
  });

  it('keeps different providers apart', () => {
    expect(sameProvider('Hetzner Online GmbH', 'Linode, LLC')).toBe(false);
    expect(sameProvider('', 'Hetzner')).toBe(false);
  });
});

describe('block time', () => {
  it('writes a span of blocks as short time at 30 seconds a block', () => {
    expect(blocksText(0)).toBe('now');
    expect(blocksText(-5)).toBe('now');
    expect(blocksText(2)).toBe('1 min');
    expect(blocksText(120)).toBe('1 h');
    expect(blocksText(2880)).toBe('1 d');
    expect(blocksText(365 * 2880)).toBe('1.0 y');
    expect(blocksText(2 * 365 * 2880)).toBe('2.0 y');
    expect(blocksText(Number.NaN)).toBe('');
  });

  it('writes it in two units for a tooltip', () => {
    expect(blocksLong(1)).toBe('30 s');
    expect(blocksLong(120)).toBe('1h');
    expect(blocksLong(2880 + 120)).toBe('1d 1h');
    expect(blocksLong(-3)).toBe('0 s');
  });
});
