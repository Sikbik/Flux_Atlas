import { describe, expect, it } from 'vitest';
import type { HealthReason, NodeAttention, WalletBenchmark, WalletConcentration } from '../types';
import {
  attentionCount,
  bandScale,
  bandSentence,
  bandStatus,
  concentrationTitle,
  evenSample,
  groupIssues,
  ISSUE_COPY,
  METRIC_META,
  METRICS,
  marginText,
  medianOf,
  medianStanding,
  metricValue,
  readConcentration,
  riskLevel,
  uptimeBands,
  variantOf,
  worstSeverity,
} from './health';

const reason = (kind: HealthReason['kind'], over: Partial<HealthReason> = {}): HealthReason => ({
  kind,
  detail: `${kind} detail`,
  metric: null,
  value: null,
  threshold: null,
  ...over,
});

const attn = (key: string, ...reasons: HealthReason[]): NodeAttention => ({ node_key: key, reasons });

describe('groupIssues', () => {
  const list = [
    attn('a:0', reason('version_outdated')),
    attn(
      'b:0',
      reason('version_outdated'),
      reason('low_headroom', { metric: 'disk_write_mbs', value: 480, threshold: 450 }),
    ),
    attn('c:0', reason('dos')),
    attn('d:0', reason('version_outdated')),
    attn('e:0', reason('unreachable')),
    attn('f:0', reason('low_headroom')),
  ];

  it('makes one issue per kind, with every node that has it', () => {
    const groups = groupIssues(list);
    expect(groups.map((g) => g.kind)).toEqual(['dos', 'low_headroom', 'unreachable', 'version_outdated']);
    expect(groups.find((g) => g.kind === 'version_outdated')?.nodes.map((n) => n.key)).toEqual([
      'a:0',
      'b:0',
      'd:0',
    ]);
  });

  it('puts the worst first, and the widest first among equals', () => {
    const groups = groupIssues(list);
    expect(groups.map((g) => g.severity)).toEqual(['crit', 'warn', 'warn', 'info']);
    // unreachable (1 node) and low_headroom (2 nodes) are both warnings: the wider one leads.
    const warn = groups.filter((g) => g.severity === 'warn').map((g) => g.kind);
    expect(warn).toEqual(['low_headroom', 'unreachable']);
  });

  it('counts the nodes in the title, singular and plural', () => {
    const groups = groupIssues(list);
    expect(groups.find((g) => g.kind === 'dos')?.title).toBe('1 node on the DoS list');
    expect(groups.find((g) => g.kind === 'version_outdated')?.title).toBe('3 nodes behind on FluxOS');
  });

  it('carries what to do, never empty', () => {
    for (const g of groupIssues(list)) {
      expect(g.why.length).toBeGreaterThan(20);
      expect(g.fix.length).toBeGreaterThan(20);
    }
  });

  it('keeps the measurement a node was flagged with', () => {
    const g = groupIssues(list).find((x) => x.kind === 'low_headroom');
    expect(g?.nodes[0]).toEqual({
      key: 'b:0',
      detail: 'low_headroom detail',
      metric: 'disk_write_mbs',
      value: 480,
      threshold: 450,
    });
  });

  it('ignores a reason it has no copy for, and has no issues for an empty list', () => {
    expect(groupIssues([attn('a:0', { ...reason('dos'), kind: 'mystery' as never })])).toEqual([]);
    expect(groupIssues([])).toEqual([]);
  });

  it('has copy for every reason kind the contract names', () => {
    const kinds = [
      'version_outdated',
      'bench_failed',
      'bench_error',
      'expiring_soon',
      'dos',
      'unreachable',
      'low_headroom',
    ];
    expect(Object.keys(ISSUE_COPY).sort()).toEqual([...kinds].sort());
  });

  it('splits low headroom into below the minimum and near it', () => {
    const groups = groupIssues([
      attn('a:0', reason('low_headroom', { metric: 'ssd_gb', value: 380, threshold: 400 })),
      attn('b:0', reason('low_headroom', { metric: 'eps', value: 790, threshold: 750 })),
      attn('c:0', reason('low_headroom', { metric: 'down_mbps', value: 102, threshold: 100 })),
    ]);
    expect(groups.map((g) => g.id)).toEqual(['low_headroom:below', 'low_headroom:near']);
    expect(groups[0]?.severity).toBe('crit');
    expect(groups[0]?.title).toBe('1 node below a tier minimum');
    expect(groups[1]?.severity).toBe('warn');
    expect(groups[1]?.nodes.map((n) => n.key)).toEqual(['b:0', 'c:0']);
  });

  it('splits version reasons by what is behind', () => {
    const groups = groupIssues([
      attn('a:0', reason('version_outdated', { metric: 'flux_os' })),
      attn('b:0', reason('version_outdated', { metric: 'bench' })),
      attn('c:0', reason('version_outdated', { metric: 'bench' })),
    ]);
    expect(groups.map((g) => g.id)).toEqual(['version_outdated:bench', 'version_outdated:flux_os']);
    expect(groups[0]?.title).toBe('2 nodes behind on fluxbench');
    expect(groups[1]?.title).toBe('1 node behind on FluxOS');
  });

  it('names the variant of a reason', () => {
    expect(variantOf(reason('dos'))).toBeNull();
    expect(variantOf(reason('low_headroom', { value: 1, threshold: 2 }))).toBe('below');
    expect(variantOf(reason('low_headroom', { value: 2, threshold: 2 }))).toBe('near');
    expect(variantOf(reason('low_headroom'))).toBe('near');
    expect(variantOf(reason('version_outdated', { metric: 'bench' }))).toBe('bench');
    expect(variantOf(reason('version_outdated'))).toBe('flux_os');
  });

  it('grades a node close to expiry as critical, with the blocks left', () => {
    const groups = groupIssues([
      attn('a:0', reason('expiring_soon', { metric: 'blocks_left', value: 90, threshold: 120 })),
    ]);
    expect(groups[0]?.severity).toBe('crit');
    expect(groups[0]?.nodes[0]?.value).toBe(90);
    expect(marginText(groups[0]?.nodes[0] ?? { value: null, threshold: null }, 'blocks')).toBe(
      '90 blocks against 120 blocks (25% under)',
    );
  });
});

describe('attention helpers', () => {
  it('counts the nodes that have a reason', () => {
    expect(attentionCount([attn('a', reason('dos')), attn('b')])).toBe(1);
  });

  it('finds the worst severity of a node', () => {
    expect(worstSeverity([reason('version_outdated'), reason('dos')])).toBe('crit');
    expect(worstSeverity([reason('version_outdated')])).toBe('info');
    expect(worstSeverity([])).toBeNull();
  });

  it('writes a measurement against its threshold', () => {
    expect(marginText({ value: 480, threshold: 450 }, 'MB/s')).toBe('480 MB/s against 450 MB/s (7% over)');
    expect(marginText({ value: 400, threshold: 450 })).toBe('400 against 450 (11% under)');
    expect(marginText({ value: null, threshold: 450 })).toBeNull();
  });
});

const band = (over: Partial<WalletBenchmark> = {}): WalletBenchmark => ({
  tier: 'stratus',
  metric: 'eps',
  network: { p10: 800, p50: 1100, p90: 1700 },
  fleet_median: 1240,
  fleet_min: 910,
  minimum: 700,
  fleet_nodes: 12,
  ...over,
});

describe('benchmark bands', () => {
  it('grades the weakest node against the tier minimum', () => {
    expect(bandStatus(band({ fleet_min: 650 }))).toBe('below');
    expect(bandStatus(band({ fleet_min: 720 }))).toBe('near');
    expect(bandStatus(band({ fleet_min: 910 }))).toBe('ok');
    expect(bandStatus(band({ minimum: null }))).toBe('untested');
    expect(bandStatus(band({ minimum: 0 }))).toBe('untested');
  });

  it('calls a provisioned size near its minimum fine, as the server does, and below it a failure', () => {
    // Cores, memory and SSD are the machine's size and never drift: at the minimum is exactly right.
    expect(bandStatus(band({ metric: 'cores', minimum: 8, fleet_min: 8 }))).toBe('ok');
    expect(bandStatus(band({ metric: 'ssd_gb', minimum: 400, fleet_min: 410 }))).toBe('ok');
    expect(bandStatus(band({ metric: 'ram_gb', minimum: 32, fleet_min: 30 }))).toBe('below');
    // Measured figures drift, so within a tenth above the minimum is near.
    expect(bandStatus(band({ metric: 'disk_write_mbs', minimum: 450, fleet_min: 480 }))).toBe('near');
    expect(bandStatus(band({ metric: 'down_mbps', minimum: 100, fleet_min: 111 }))).toBe('ok');
  });

  it('compares the fleet median with the network median', () => {
    expect(medianStanding(band())).toEqual({ side: 'above', ratio: 1240 / 1100 - 1 });
    expect(medianStanding(band({ fleet_median: 1000 })).side).toBe('below');
    expect(medianStanding(band({ fleet_median: 1110 })).side).toBe('level');
    expect(medianStanding(band({ network: { p10: 0, p50: 0, p90: 0 } }))).toEqual({
      side: 'level',
      ratio: null,
    });
  });

  it('draws an axis with room around every number, never below zero', () => {
    const s = bandScale(band());
    expect(s.lo).toBeLessThan(700);
    expect(s.lo).toBeGreaterThanOrEqual(0);
    expect(s.hi).toBeGreaterThan(1700);
    expect(
      bandScale(band({ minimum: null, fleet_min: 5, network: { p10: 5, p50: 5, p90: 5 }, fleet_median: 5 }))
        .lo,
    ).toBeGreaterThanOrEqual(0);
  });

  it('says it in a sentence', () => {
    const t = bandSentence(band());
    expect(t).toContain(
      'CPU events per second: the fleet median is 1,240 EPS, 13% above the network median 1,100 EPS.',
    );
    expect(t).toContain('weakest node is 910, against a minimum of 700');
    expect(t).toContain('Measured on 12 nodes.');
    expect(bandSentence(band({ fleet_nodes: 1 }))).toContain('Measured on 1 node.');
    expect(bandSentence(band({ fleet_min: 600 }))).toContain('below the minimum of 700');
    expect(bandSentence(band({ minimum: null }))).toContain('The tier states no minimum.');
  });

  it('has a label and unit for every metric, in the order they read', () => {
    expect(METRICS).toHaveLength(7);
    for (const m of METRICS) expect(METRIC_META[m].label.length).toBeGreaterThan(2);
    expect(metricValue(1240.4, 'eps')).toBe('1,240.4');
    expect(metricValue(1240.4, 'cores')).toBe('1,240');
  });
});

/** A concentration as the server builds it: the known buckets, the index over them, an unknown bucket last. */
const conc = (
  by: WalletConcentration['by'],
  buckets: [string, number][],
  unknown = 0,
): WalletConcentration => {
  const known = buckets.reduce((s, [, n]) => s + n, 0);
  const shares = buckets.map(([, n]) => n / known);
  return {
    by,
    buckets: [
      ...buckets.map(([label, nodes]) => ({ key: label.toLowerCase(), label, nodes })),
      ...(unknown > 0 ? [{ key: 'unknown', label: 'Unknown', nodes: unknown }] : []),
    ],
    hhi: shares.reduce((s, x) => s + x * x, 0),
    top_share: Math.max(0, ...shares),
  };
};

describe('concentration', () => {
  it('bands the index', () => {
    expect(riskLevel(0.05)).toBe('low');
    expect(riskLevel(0.15)).toBe('moderate');
    expect(riskLevel(0.2499)).toBe('moderate');
    expect(riskLevel(0.25)).toBe('high');
    expect(riskLevel(1)).toBe('high');
  });

  it('says what one provider outage does to a single-provider fleet', () => {
    const r = readConcentration(conc('provider', [['Hetzner', 208]]));
    expect(r.level).toBe('high');
    expect(r.headline).toBe('One provider outage takes down 100% of this fleet.');
    expect(r.effective).toBeCloseTo(1, 12);
    expect(r.label).toBe('Concentrated');
    expect(r.total).toBe(208);
  });

  it('names the biggest group when there are several', () => {
    const c = conc('country', [
      ['Germany', 115],
      ['Finland', 93],
    ]);
    const r = readConcentration(c);
    expect(r.headline).toBe('Losing Germany would take down 55% of this fleet.');
    expect(r.top).toEqual({ label: 'Germany', nodes: 115, share: 115 / 208 });
    expect(r.effective).toBeCloseTo(1 / (0.5529 ** 2 + 0.4471 ** 2), 2);
    expect(
      readConcentration(
        conc('provider', [
          ['A', 10],
          ['B', 6],
        ]),
      ).headline,
    ).toContain('One provider outage, A, takes down 63%');
  });

  it('reads a spread fleet as diversified', () => {
    const buckets: [string, number][] = Array.from({ length: 20 }, (_, i) => [`P${i}`, 5]);
    const r = readConcentration(conc('provider', buckets));
    expect(r.level).toBe('low');
    expect(r.label).toBe('Diversified');
    expect(r.effective).toBeCloseTo(20, 9);
  });

  it('takes the share against the whole fleet and says how many nodes are not placed', () => {
    const r = readConcentration(
      conc(
        'country',
        [
          ['Germany', 60],
          ['Finland', 30],
        ],
        10,
      ),
    );
    expect(r.known).toBe(90);
    expect(r.unknown).toBe(10);
    expect(r.total).toBe(100);
    expect(r.top).toEqual({ label: 'Germany', nodes: 60, share: 0.6 });
    expect(r.headline).toBe('Losing Germany would take down 60% of this fleet.');
  });

  it('does not call a single known place the whole fleet while others are unknown', () => {
    const r = readConcentration(conc('provider', [['Hetzner', 8]], 2));
    expect(r.headline).toBe('One provider outage, Hetzner, takes down 80% of this fleet.');
  });

  it('has nothing to grade when no node has a known place', () => {
    const r = readConcentration({
      by: 'country',
      buckets: [{ key: 'unknown', label: 'Unknown', nodes: 5 }],
      hhi: 0,
      top_share: 0,
    });
    expect(r.level).toBe('unknown');
    expect(r.label).toBe('Unknown');
    expect(r.top).toBeNull();
    expect(r.headline).toBe('No node has a known country yet.');
  });

  it('copes with a fleet of no nodes', () => {
    const r = readConcentration({ by: 'city', buckets: [], hhi: 0, top_share: 0 });
    expect(r.top).toBeNull();
    expect(r.headline).toBe('No cities to compare: the fleet has no nodes.');
  });

  it('titles the three dimensions', () => {
    expect(concentrationTitle('provider')).toBe('Provider');
    expect(concentrationTitle('city')).toBe('City');
    expect(concentrationTitle('country')).toBe('Country');
  });
});

describe('uptime', () => {
  it('sorts percentages into bands, edges going up, and leaves out what was not observed', () => {
    const bands = uptimeBands([100, 99.9, 99.5, 99.4, 98, 97.9, 95, 94.9, 90, 89.9, 0, null, Number.NaN]);
    expect(bands.map((b) => b.count)).toEqual([2, 2, 2, 2, 3]);
    expect(bands.reduce((s, b) => s + b.count, 0)).toBe(11);
  });

  it('clamps a figure outside 0 to 100', () => {
    expect(uptimeBands([120, -5]).map((b) => b.count)).toEqual([1, 0, 0, 0, 1]);
  });

  it('finds the median of the known values', () => {
    expect(medianOf([99, null, 97, 100])).toBe(99);
    expect(medianOf([98, 100])).toBe(99);
    expect(medianOf([null])).toBeNull();
    expect(medianOf([])).toBeNull();
  });
});

describe('evenSample', () => {
  const items = Array.from({ length: 208 }, (_, i) => i);
  it('takes every nth so the sample spans the whole list', () => {
    const s = evenSample(items, 40);
    expect(s).toHaveLength(40);
    expect(s[0]).toBe(0);
    expect(s[39]).toBeGreaterThan(190);
    expect(new Set(s).size).toBe(40);
  });

  it('returns a copy of a list that already fits', () => {
    const small = [1, 2, 3];
    const s = evenSample(small, 40);
    expect(s).toEqual(small);
    expect(s).not.toBe(small);
  });
});
