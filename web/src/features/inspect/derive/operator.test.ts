import { describe, expect, it } from 'vitest';
import { encodeSyntheticNodesBin, type SyntheticNode } from '../../../api/bin/writer';
import type { NodeRow } from '../../../api/generated/NodeRow';
import { decodeNodesBin } from '../../../api/nodesBin';
import { NodeTable, Reach } from '../../../store/nodeTable';
import {
  attention,
  buildFleet,
  buildWatchFleet,
  concentration,
  type FleetNode,
  fleetCentroid,
  fleetState,
  flyRangeFor,
  hardwareMix,
  rowFromDetail,
  sortByNextPayout,
  stateCounts,
  stragglers,
  summarizeFleet,
  sumSince,
  tierMix,
  versionCounts,
} from './operator';
import { buildQueues } from './queue';

function tableOf(nodes: SyntheticNode[]): NodeTable {
  return NodeTable.fromSnapshot(decodeNodesBin(encodeSyntheticNodesBin(nodes)));
}

const row = (id: number, over: Partial<NodeRow> = {}): NodeRow => ({
  id,
  outpoint: `${id}:0`,
  endpoint: `10.0.0.${id}:16127`,
  tier: 'stratus',
  status: 'confirmed',
  rank: id,
  payment_address: 't1Operator',
  country_code: 'FI',
  country: 'Finland',
  org: 'Hetzner',
  lat: 60,
  lon: 25,
  app_count: 1,
  added_height: 1,
  last_paid_height: 100,
  last_confirmed_height: 900,
  flux_os: '8.20.0',
  arcane: true,
  reachable: true,
  ...over,
});

const node = (id: number, over: Partial<FleetNode> = {}): FleetNode => ({
  id,
  endpoint: `10.0.0.${id}:16127`,
  ip: `10.0.0.${id}`,
  port: 16127,
  tier: 'stratus',
  status: 'confirmed',
  reachable: true,
  sinceConfirm: 20,
  atRisk: false,
  position: id,
  lastPaid: 100,
  version: '8.20.0',
  cores: 16,
  ramGb: 64,
  ssdGb: 880,
  appCount: 1,
  country: 'FI',
  org: 'Hetzner',
  lat: 60,
  lon: 25,
  perDay: 10,
  paymentAddress: 't1Operator',
  present: true,
  ...over,
});

describe('buildFleet', () => {
  const syn: SyntheticNode[] = Array.from({ length: 10 }, (_, i) => ({
    id: i,
    tier: 3,
    rank: i + 1,
    lastPaid: 100 + i,
    ip: `10.0.0.${i}:16127`,
  }));

  it('overlays live table facts on roster rows and derives position and per-day earnings', () => {
    const t = tableOf(syn);
    t.lastConfirmed[t.indexOf(3)] = 1_000 - 580;
    t.reachable[t.indexOf(4)] = Reach.No;
    t.cores[t.indexOf(2)] = 16;
    const q = buildQueues(t);
    const fleet = buildFleet([row(2), row(3), row(4)], t, q, 1_000, { stratus: 9 });
    expect(fleet.map((n) => n.position)).toEqual([2, 3, 4]);
    expect(fleet[0]!.perDay).toBeCloseTo((9 * 2880) / 10, 6);
    expect(fleet[0]!.cores).toBe(16);
    expect(fleet[1]!.sinceConfirm).toBe(580);
    expect(fleet[1]!.atRisk).toBe(true);
    expect(fleet[2]!.reachable).toBe(false);
    expect(fleet[0]!.ip).toBe('10.0.0.2');
    expect(fleet[0]!.port).toBe(16127);
    expect(fleet[0]!.lastPaid).toBe(102);
  });

  it('falls back to the roster row for nodes the table does not know', () => {
    const t = tableOf(syn);
    const q = buildQueues(t);
    const [n] = buildFleet([row(99, { last_confirmed_height: 990, reachable: false })], t, q, 1_000, {
      stratus: 9,
    });
    expect(n).toMatchObject({ id: 99, position: null, perDay: null, sinceConfirm: 10, reachable: false });
    expect(n!.version).toBe('8.20.0');
    expect(n!.lastPaid).toBe(100);
  });

  it('leaves the check-in unknown rather than zero', () => {
    const t = tableOf(syn);
    const q = buildQueues(t);
    const [n] = buildFleet([row(1, { last_confirmed_height: null })], t, q, 1_000, {});
    expect(n!.sinceConfirm).toBeNull();
    expect(n!.atRisk).toBe(false);
    expect(n!.perDay).toBeNull();
  });
});

describe('summaries', () => {
  it('orders by next payout with tiers interleaved and unqueued nodes last', () => {
    const sorted = sortByNextPayout([
      node(1, { position: 40 }),
      node(2, { position: null }),
      node(3, { position: 3, tier: 'cumulus' }),
    ]);
    expect(sorted.map((n) => n.id)).toEqual([3, 1, 2]);
  });

  it('counts tiers, hosts, risk and the soonest payee', () => {
    const s = summarizeFleet([
      node(1, { position: 5 }),
      node(2, { position: 2, ip: '10.0.0.1', atRisk: true, sinceConfirm: 580 }),
      node(3, { position: 9, tier: 'cumulus', reachable: false }),
      node(4, { position: null, status: 'started' }),
    ]);
    expect(s.count).toBe(4);
    expect(s.hosts).toBe(3);
    expect(s.tiers).toEqual({ cumulus: 1, nimbus: 0, stratus: 3 });
    expect(s.next?.id).toBe(2);
    expect(s.atRisk.map((n) => n.id)).toEqual([2]);
    expect(s.unreachable.map((n) => n.id)).toEqual([3]);
    expect(s.notConfirmed.map((n) => n.id)).toEqual([4]);
    expect(s.perDay).toBe(40);
    expect(s.apps).toBe(4);
  });
});

describe('concentration', () => {
  it('is quiet for a single node and for a spread fleet', () => {
    expect(concentration([node(1)]).level).toBe('none');
    const spread = [1, 2, 3, 4].map((i) => node(i, { org: `Org ${i}` }));
    expect(concentration(spread).level).toBe('none');
  });

  it('goes critical when every node shares one IP', () => {
    const fleet = [1, 2, 3, 4, 5, 6, 7].map((i) => node(i, { ip: '65.109.26.93' }));
    const c = concentration(fleet);
    expect(c).toMatchObject({ level: 'crit', kind: 'host', nodes: 7, total: 7, share: 1 });
    expect(c.body).toContain('All 7 nodes share one IP in one datacenter');
    expect(c.body).toContain('100%');
    expect(c.body).toContain('halve');
  });

  it('warns when a host carries half or more, weighted by earnings', () => {
    const fleet = [
      node(1, { ip: 'a', perDay: 30, org: 'A' }),
      node(2, { ip: 'a', perDay: 30, org: 'B' }),
      node(3, { ip: 'b', perDay: 10, org: 'C' }),
      node(4, { ip: 'c', perDay: 10, org: 'D' }),
    ];
    const c = concentration(fleet);
    expect(c.level).toBe('warn');
    expect(c.share).toBeCloseTo(0.75, 6);
    expect(c.body).toContain('2 of 4 nodes share the IP a');
  });

  it('warns about one provider across many hosts', () => {
    const fleet = [1, 2, 3, 4].map((i) => node(i, { ip: `h${i}`, org: 'Hetzner' }));
    const c = concentration(fleet);
    expect(c).toMatchObject({ level: 'warn', kind: 'provider', nodes: 4 });
  });
});

describe('versions and hardware', () => {
  it('lists stragglers and counts versions', () => {
    const fleet = [
      node(1, { version: '8.20.0' }),
      node(2, { version: '8.18.0' }),
      node(3, { version: '8.9.0' }),
      node(4, { version: null }),
    ];
    expect(stragglers(fleet, '8.20.0').map((s) => s.node.id)).toEqual([3, 2]);
    expect(stragglers(fleet, null)).toEqual([]);
    expect(versionCounts(fleet)[0]).toEqual({ version: '8.20.0', count: 1 });
    expect(versionCounts(fleet).some((v) => v.version === 'Unknown')).toBe(true);
  });

  it('groups identical hardware and totals the known nodes', () => {
    const mix = hardwareMix([
      node(1),
      node(2),
      node(3, { cores: 8, ramGb: 32, ssdGb: 440 }),
      node(4, { cores: 0, ramGb: 0, ssdGb: 0 }),
    ]);
    expect(mix.groups).toHaveLength(2);
    expect(mix.groups[0]).toMatchObject({ count: 2, cores: 16 });
    expect(mix.totals).toEqual({ cores: 40, ramGb: 160, ssdGb: 2200 });
    expect(mix.unknown).toBe(1);
  });
});

describe('sumSince', () => {
  it('adds the payments inside the window', () => {
    const parse = (s: string) => Number(s);
    expect(
      sumSince(
        [
          { time_ms: 100, amount: '9' },
          { time_ms: 50, amount: '9' },
          { time_ms: 200, amount: '3.5' },
        ],
        100,
        parse,
      ),
    ).toBe(12.5);
  });
});

describe('buildWatchFleet', () => {
  const syn: SyntheticNode[] = Array.from({ length: 6 }, (_, i) => ({
    id: i + 1,
    tier: 3,
    rank: i + 1,
    lastPaid: 100 + i,
    ip: `10.0.0.${i + 1}:16127`,
  }));

  it('takes everything from the live table and keeps nodes it no longer knows as gone', () => {
    const t = tableOf(syn);
    const q = buildQueues(t);
    const fleet = buildWatchFleet([2, 99, 4], t, q, 1_000, { stratus: 9 });
    expect(fleet.map((n) => n.id)).toEqual([2, 99, 4]);
    expect(fleet[0]).toMatchObject({
      present: true,
      endpoint: '10.0.0.2:16127',
      tier: 'stratus',
      position: 1,
    });
    expect(fleet[1]).toMatchObject({ present: false, endpoint: '', position: null, perDay: null });
    expect(fleetState(fleet[1]!)).toBe('gone');
  });
});

describe('fleet health', () => {
  it('names one state per node', () => {
    expect(fleetState(node(1))).toBe('ok');
    expect(fleetState(node(1, { atRisk: true, sinceConfirm: 580 }))).toBe('risk');
    expect(fleetState(node(1, { reachable: false }))).toBe('risk');
    expect(fleetState(node(1, { status: 'offline' }))).toBe('down');
    expect(fleetState(node(1, { status: 'dos' }))).toBe('down');
    expect(fleetState(node(1, { sinceConfirm: 650, atRisk: true }))).toBe('down');
    expect(fleetState(node(1, { status: 'started' }))).toBe('pending');
    expect(fleetState(node(1, { status: 'unknown' }))).toBe('pending');
    expect(fleetState(node(1, { status: 'expired' }))).toBe('gone');
    expect(fleetState(node(1, { present: false }))).toBe('gone');
  });

  it('counts the states', () => {
    const c = stateCounts([
      node(1),
      node(2),
      node(3, { atRisk: true, sinceConfirm: 600 }),
      node(4, { status: 'offline' }),
      node(5, { status: 'started' }),
      node(6, { present: false }),
    ]);
    expect(c).toEqual({ ok: 2, risk: 1, down: 1, pending: 1, gone: 1 });
  });

  it('groups what needs a look, worst first, each node once', () => {
    const groups = attention([
      node(1),
      node(2, { atRisk: true, sinceConfirm: 570 }),
      node(3, { atRisk: true, sinceConfirm: 610 }),
      node(4, { sinceConfirm: 700, atRisk: true }),
      node(5, { reachable: false }),
      node(6, { status: 'dos' }),
      node(7, { present: false }),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(['expired', 'at_risk', 'dos', 'unreachable']);
    expect(groups[1]!.nodes.map((n) => n.id)).toEqual([3, 2]);
    expect(attention([node(1), node(2)])).toEqual([]);
  });
});

describe('fleetCentroid', () => {
  it('is null without places and the place itself for one node', () => {
    expect(fleetCentroid([{ lat: null, lon: null }])).toBeNull();
    const one = fleetCentroid([{ lat: 60, lon: 25 }])!;
    expect(one.lat).toBeCloseTo(60, 6);
    expect(one.lon).toBeCloseTo(25, 6);
    expect(one.spread).toBeCloseTo(0, 6);
    expect(one.count).toBe(1);
  });

  it('centres two places on the sphere and measures the reach', () => {
    const c = fleetCentroid([
      { lat: 0, lon: 10 },
      { lat: 0, lon: 30 },
    ])!;
    expect(c.lat).toBeCloseTo(0, 6);
    expect(c.lon).toBeCloseTo(20, 6);
    expect(c.spread).toBeCloseTo((10 * Math.PI) / 180, 6);
  });

  it('goes the short way across the antimeridian', () => {
    const c = fleetCentroid([
      { lat: 0, lon: 170 },
      { lat: 0, lon: -170 },
    ])!;
    expect(Math.abs(c.lon)).toBeCloseTo(180, 4);
  });

  it('frames a wider fleet from further away, within the camera limits', () => {
    expect(flyRangeFor(0)).toBe(0.5);
    expect(flyRangeFor(0.3)).toBeGreaterThan(flyRangeFor(0.1));
    expect(flyRangeFor(Math.PI)).toBe(3.4);
  });
});

describe('tierMix', () => {
  it('counts the nodes of each tier and skips unknown ones', () => {
    expect(tierMix([node(1), node(2, { tier: 'nimbus' }), node(3), node(4, { tier: 'unknown' })])).toEqual({
      cumulus: 0,
      nimbus: 1,
      stratus: 2,
    });
  });
});

describe('rowFromDetail', () => {
  const detail = {
    id: 7,
    outpoint: 'abc:0',
    endpoint: '10.0.0.7:16127',
    tier: 'nimbus',
    status: 'confirmed',
    rank: 3,
    payment_address: 't1X',
    app_count: 2,
    added_height: 10,
    last_paid_height: 90,
    last_confirmed_height: 95,
    arcane: true,
    reachable: false,
    geo: { lat: 60.1, lon: 24.9, country_code: 'FI', country: 'Finland', org: 'Hetzner' },
    versions: { flux_os: '8.20.0' },
  } as unknown as Parameters<typeof rowFromDetail>[0];

  it('carries what a roster row carries', () => {
    expect(rowFromDetail(detail)).toMatchObject({
      id: 7,
      endpoint: '10.0.0.7:16127',
      tier: 'nimbus',
      country_code: 'FI',
      org: 'Hetzner',
      lat: 60.1,
      flux_os: '8.20.0',
      last_confirmed_height: 95,
      reachable: false,
    });
  });

  it('leaves the place unknown when the node has no geo', () => {
    expect(rowFromDetail({ ...detail, geo: null })).toMatchObject({ lat: null, lon: null, org: null });
  });

  it('lets a watchlist keep what the server said about a node the table does not know', () => {
    const t = tableOf([{ id: 1, tier: 3, rank: 1, ip: '10.0.0.1:16127' }]);
    const q = buildQueues(t);
    const rows = new Map([[7, rowFromDetail(detail)]]);
    const [n] = buildWatchFleet([7], t, q, 1_000, {}, rows);
    expect(n).toMatchObject({ present: false, endpoint: '10.0.0.7:16127', lat: 60.1, reachable: false });
  });
});

describe('buildFleet places', () => {
  it('prefers the live table place over the roster row', () => {
    const t = tableOf([{ id: 1, tier: 3, rank: 1, ip: '10.0.0.1:16127', lat: 12.5, lon: 34.5 }]);
    const q = buildQueues(t);
    const [n] = buildFleet([row(1, { lat: 60, lon: 25 })], t, q, 1_000, {});
    expect(n!.lat).toBeCloseTo(12.5, 4);
    expect(n!.lon).toBeCloseTo(34.5, 4);
  });
});
