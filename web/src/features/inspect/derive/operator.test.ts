import { describe, expect, it } from 'vitest';
import { encodeSyntheticNodesBin, type SyntheticNode } from '../../../api/bin/writer';
import type { NodeRow } from '../../../api/generated/NodeRow';
import { decodeNodesBin } from '../../../api/nodesBin';
import { NodeTable, Reach } from '../../../store/nodeTable';
import {
  buildFleet,
  concentration,
  type FleetNode,
  hardwareMix,
  sortByNextPayout,
  stragglers,
  summarizeFleet,
  sumSince,
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
  });

  it('falls back to the roster row for nodes the table does not know', () => {
    const t = tableOf(syn);
    const q = buildQueues(t);
    const [n] = buildFleet([row(99, { last_confirmed_height: 990, reachable: false })], t, q, 1_000, {
      stratus: 9,
    });
    expect(n).toMatchObject({ id: 99, position: null, perDay: null, sinceConfirm: 10, reachable: false });
    expect(n!.version).toBe('8.20.0');
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
