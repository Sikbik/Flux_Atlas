import { describe, expect, it } from 'vitest';
import { encodeSyntheticNodesBin, type SyntheticNode } from '../../../api/bin/writer';
import { decodeNodesBin, STATUS_CODES } from '../../../api/nodesBin';
import { NodeTable, Reach } from '../../../store/nodeTable';
import {
  breakdown,
  buildWeather,
  cellKey,
  cellTotals,
  emptyScan,
  formatLift,
  groupTotals,
  hotspots,
  type Problem,
  placeName,
  verdictOf,
} from './weather';

const code = (s: (typeof STATUS_CODES)[number]) => STATUS_CODES.indexOf(s);

function tableOf(nodes: SyntheticNode[]): NodeTable {
  return NodeTable.fromSnapshot(decodeNodesBin(encodeSyntheticNodesBin(nodes)));
}

describe('buildWeather', () => {
  const nodes: SyntheticNode[] = Array.from({ length: 8 }, (_, i) => ({
    id: i,
    tier: 1,
    status: code('confirmed'),
    lat: 50 + i * 0.1,
    lon: 10,
    rank: i + 1,
  }));

  it('counts live reachability, DoS and at-risk nodes from the table alone, and says it is partial', () => {
    const t = tableOf(nodes);
    t.reachable[t.indexOf(1)] = Reach.No;
    t.status[t.indexOf(2)] = code('dos');
    t.lastConfirmed[t.indexOf(3)] = 1_000 - 600;
    t.lastConfirmed[t.indexOf(4)] = 1_000 - 100;
    const w = buildWeather(t, null, 1_000);
    expect(w.counts).toMatchObject({
      total: 8,
      unreachable: 1,
      dos: 1,
      atRisk: 1,
      affected: 3,
      benchFailed: null,
    });
    expect(w.partial).toBe(true);
    expect(w.problems.map((p) => p.id).sort()).toEqual([1, 2, 3]);
  });

  it('takes the server scan as the baseline and lets live facts override it', () => {
    const t = tableOf(nodes);
    const scan = emptyScan(8);
    for (let i = 0; i < 8; i++) {
      scan.ids[i] = i;
      scan.index.set(i, i);
      scan.reach[i] = Reach.Yes;
      scan.lastConfirmed[i] = 900;
    }
    scan.reach[5] = Reach.No;
    scan.lastConfirmed[6] = 1_000 - 580;
    // Live: node 5 recovered, node 7 dropped off.
    t.reachable[t.indexOf(5)] = Reach.Yes;
    t.reachable[t.indexOf(7)] = Reach.No;
    const w = buildWeather(t, scan, 1_000);
    expect(w.partial).toBe(false);
    expect(w.counts.unreachable).toBe(1);
    expect(w.problems.some((p) => p.id === 5)).toBe(false);
    expect(w.problems.some((p) => p.id === 7)).toBe(true);
    expect(w.counts.atRisk).toBe(1);
  });

  it('does not call a started node at risk', () => {
    const t = tableOf(nodes);
    t.status[t.indexOf(0)] = code('started');
    t.lastConfirmed[t.indexOf(0)] = 1;
    expect(buildWeather(t, null, 1_000).counts.atRisk).toBe(0);
  });
});

describe('verdictOf', () => {
  const c = (over: Partial<Parameters<typeof verdictOf>[0]> = {}) => ({
    total: 6_726,
    unreachable: 105,
    dos: 7,
    atRisk: 11,
    affected: 120,
    benchFailed: null,
    ...over,
  });

  it('reads an ordinary day as healthy', () => {
    const v = verdictOf(c());
    expect(v.level).toBe('healthy');
    expect(v.line).toBe('Healthy, 105 unreachable, 11 at risk, 7 DoS listed');
    expect(v.reasons).toEqual([]);
  });

  it('becomes unsettled and then a storm as the shares grow, and says why', () => {
    const unsettled = verdictOf(c({ unreachable: 300 }));
    expect(unsettled.level).toBe('unsettled');
    expect(unsettled.reasons[0]).toContain('Unreachable 4.5%');
    expect(verdictOf(c({ unreachable: 800 })).level).toBe('storm');
    expect(verdictOf(c({ atRisk: 120 })).level).toBe('unsettled');
    expect(verdictOf(c({ atRisk: 400 })).level).toBe('storm');
  });

  it('waits for data instead of guessing', () => {
    expect(verdictOf(c({ total: 0 })).level).toBe('unknown');
    expect(verdictOf(c(), { known: false }).level).toBe('unknown');
  });
});

describe('hotspots and breakdowns', () => {
  const p = (id: number, lat: number, lon: number, over: Partial<Problem> = {}): Problem => ({
    id,
    lat,
    lon,
    country: 'DE',
    org: 'Hetzner',
    unreachable: true,
    dos: false,
    atRisk: false,
    ...over,
  });

  it('finds cells with many affected nodes and a rate well above the network baseline', () => {
    const problems = [p(1, 50.1, 8.2), p(2, 50.3, 8.4), p(3, 50.6, 8.9), p(4, 10, 10), p(5, -30, 100)];
    const totals = new Map([
      [cellKey(50.1, 8.2), 20],
      [cellKey(10, 10), 500],
      [cellKey(-30, 100), 50],
    ]);
    const spots = hotspots(problems, totals, 0.02);
    expect(spots).toHaveLength(1);
    expect(spots[0]).toMatchObject({ bad: 3, total: 20, unreachable: 3, level: 'unsettled' });
    expect(spots[0]!.lat).toBeCloseTo(50.333, 2);
    expect(spots[0]!.lift).toBeCloseTo(0.15 / 0.02, 6);
  });

  it('names a hotspot by the provider and country most of its affected nodes share', () => {
    const problems = [
      p(1, 50.1, 8.2, { org: 'Hetzner', country: 'DE' }),
      p(2, 50.3, 8.4, { org: 'Hetzner', country: 'DE' }),
      p(3, 50.6, 8.9, { org: 'OVH', country: 'FR' }),
    ];
    const spots = hotspots(problems, new Map([[cellKey(50.1, 8.2), 12]]), 0.02);
    expect(spots[0]).toMatchObject({ org: 'Hetzner', country: 'DE' });
  });

  it('calls a dense, severe cell a storm', () => {
    const problems = Array.from({ length: 6 }, (_, i) => p(i, 40.1 + i * 0.05, 3.1));
    const spots = hotspots(problems, new Map([[cellKey(40.1, 3.1), 24]]), 0.02);
    expect(spots[0]!.level).toBe('storm');
  });

  it('ignores problems with no position and cells at the network rate', () => {
    const problems = [p(1, Number.NaN, Number.NaN), p(2, 1, 1), p(3, 1.1, 1.1), p(4, 1.2, 1.2)];
    const totals = new Map([[cellKey(1, 1), 4]]);
    expect(hotspots(problems, totals, 0.9)).toEqual([]);
  });

  it('ranks groups by affected count with their own rate', () => {
    const problems = [
      p(1, 0, 0, { org: 'A', country: 'DE' }),
      p(2, 0, 0, { org: 'A', country: 'DE' }),
      p(3, 0, 0, { org: 'B', country: 'FR' }),
    ];
    const totals = new Map([
      ['A', 10],
      ['B', 2],
    ]);
    const rows = breakdown(problems, totals, (x) => x.org);
    expect(rows.map((r) => r.key)).toEqual(['A', 'B']);
    expect(rows[0]).toMatchObject({ bad: 2, total: 10, rate: 0.2 });
    expect(rows[1]).toMatchObject({ rate: 0.5 });
  });

  it('counts the table by country and organisation', () => {
    const t = tableOf([
      { id: 0, lat: 1, lon: 1 },
      { id: 1, lat: 1.001, lon: 1.001 },
    ]);
    expect(groupTotals(t).byCountry.size).toBe(0);
    expect(cellTotals(t).get(cellKey(1, 1))).toBe(2);
  });
});

describe('placeName and formatLift', () => {
  it('names a place by provider and country, and falls back to coordinates', () => {
    expect(placeName({ org: 'Hetzner', country: 'DE', lat: 50, lon: 8 })).toBe('Hetzner, Germany');
    expect(placeName({ org: '', country: 'DE', lat: 50, lon: 8 })).toBe('Germany');
    expect(placeName({ org: '', country: '', lat: -33.86, lon: 151.2 })).toBe('33.9S 151.2E');
  });

  it('writes a rate against the network as a short multiple', () => {
    expect(formatLift(6.234)).toBe('6.2x');
    expect(formatLift(24.6)).toBe('25x');
    expect(formatLift(Number.POSITIVE_INFINITY)).toBe('far above');
  });
});
