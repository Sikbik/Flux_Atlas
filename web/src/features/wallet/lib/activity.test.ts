import { describe, expect, it } from 'vitest';
import type { FleetDay, WalletActivity } from '../types';
import {
  ACTIVITY_GROUPS,
  type ActivityGroup,
  activityWindow,
  countByGroup,
  dailyChange,
  describeFleet,
  filterActivity,
  fleetChange,
  fleetSeries,
  groupOfKind,
  kindLabel,
  newestFirst,
  paymentAmount,
  paymentSummary,
  paymentTier,
  rhythm,
  searchActivity,
  tiersPresent,
  toneOfKind,
  trimLeadingEmpty,
} from './activity';

const item = (t: number, kind: string, detail = ''): WalletActivity => ({
  t_ms: t,
  kind,
  node_key: 'a:0',
  height: 3_000_000 + t,
  detail,
});

const feed = [
  item(5, 'paid', 'Paid 9.00000000 FLUX (stratus)'),
  item(4, 'ip_changed', 'Endpoint changed from 1.2.3.4:16127 to 5.6.7.8:16127'),
  item(3, 'paid', 'Paid 9.00000000 FLUX (stratus)'),
  item(2, 'apps', '2 apps running'),
  item(1, 'at_risk', '600 blocks without a confirmation'),
  item(0, 'surprise_kind', 'Something new'),
];

describe('groups', () => {
  it('puts each kind under one filter, and an unknown kind under node changes', () => {
    expect(groupOfKind('paid')).toBe('payments');
    expect(groupOfKind('dos')).toBe('health');
    expect(groupOfKind('benchmark')).toBe('health');
    expect(groupOfKind('ip_changed')).toBe('nodes');
    expect(groupOfKind('version')).toBe('nodes');
    expect(groupOfKind('apps')).toBe('apps');
    expect(groupOfKind('surprise_kind')).toBe('nodes');
  });

  it('lists four filters', () => {
    expect(ACTIVITY_GROUPS.map((g) => g.id)).toEqual(['payments', 'health', 'nodes', 'apps']);
  });

  it('labels a kind in words, and makes up words for a new one', () => {
    expect(kindLabel('paid')).toBe('Payment');
    expect(kindLabel('ip_changed')).toBe('Endpoint changed');
    expect(kindLabel('surprise_kind')).toBe('Surprise kind');
  });

  it('gives a kind a colour role', () => {
    expect(toneOfKind('paid')).toBe('pay');
    expect(toneOfKind('recovered')).toBe('ok');
    expect(toneOfKind('at_risk')).toBe('warn');
    expect(toneOfKind('dos')).toBe('crit');
    expect(toneOfKind('apps')).toBe('info');
  });

  it('reads a benchmark row for its news', () => {
    expect(toneOfKind('benchmark', 'Benchmark passed (stratus): 900 EPS')).toBe('ok');
    expect(toneOfKind('benchmark', 'Benchmark failed: 120 EPS')).toBe('warn');
    expect(toneOfKind('benchmark', 'Benchmark running: 0 EPS')).toBe('info');
  });
});

describe('filterActivity', () => {
  it('keeps everything while no filter is on', () => {
    expect(filterActivity(feed, new Set())).toHaveLength(6);
  });

  it('keeps the groups that are on', () => {
    const on = new Set<ActivityGroup>(['payments']);
    expect(filterActivity(feed, on).map((i) => i.t_ms)).toEqual([5, 3]);
    expect(filterActivity(feed, new Set<ActivityGroup>(['payments', 'apps'])).map((i) => i.t_ms)).toEqual([
      5, 3, 2,
    ]);
  });

  it('counts each group', () => {
    expect(countByGroup(feed)).toEqual({ payments: 2, health: 1, nodes: 2, apps: 1 });
  });

  it('sorts newest first without touching the input', () => {
    const shuffled = [feed[2], feed[0], feed[4]] as WalletActivity[];
    expect(newestFirst(shuffled).map((i) => i.t_ms)).toEqual([5, 3, 1]);
    expect(shuffled.map((i) => i.t_ms)).toEqual([3, 5, 1]);
  });
});

describe('payments', () => {
  it('reads the amount back out of the sentence', () => {
    expect(paymentAmount('Paid 9.00000000 FLUX (stratus)')).toBe(9);
    expect(paymentAmount('Paid 1,234.50 FLUX at block 3,006,000')).toBe(1234.5);
    expect(paymentAmount('Payment received')).toBeNull();
  });

  it('reads the tier out of the brackets', () => {
    expect(paymentTier('Paid 9.00000000 FLUX (stratus)')).toBe('stratus');
    expect(paymentTier('Paid 1.00000000 FLUX (Cumulus)')).toBe('cumulus');
    expect(paymentTier('Paid 1.00000000 FLUX')).toBeNull();
    expect(paymentTier('Paid 1.00000000 FLUX (unknown)')).toBeNull();
  });

  it('adds up the payments with an amount and counts those without', () => {
    expect(paymentSummary(feed)).toEqual({ count: 2, flux: 18 });
    expect(paymentSummary([item(1, 'paid', 'Payment received')])).toEqual({ count: 1, flux: 0 });
    expect(paymentSummary([])).toEqual({ count: 0, flux: 0 });
  });
});

describe('searchActivity', () => {
  const named = (key: string | null) => (key === 'a:0' ? '65.108.120.172:16127' : '');

  it('keeps every row for no text', () => {
    expect(searchActivity(feed, '   ', named)).toHaveLength(6);
    expect(searchActivity(feed, '', named)).not.toBe(feed);
  });

  it('finds a row by its sentence, its kind or its node, ignoring case', () => {
    expect(searchActivity(feed, 'endpoint', named).map((i) => i.t_ms)).toEqual([4]);
    expect(searchActivity(feed, 'AT RISK', named).map((i) => i.t_ms)).toEqual([1]);
    expect(searchActivity(feed, '65.108', named)).toHaveLength(6);
    expect(searchActivity(feed, '65.108', () => 'elsewhere')).toHaveLength(0);
  });

  it('needs every word, in any order', () => {
    expect(searchActivity(feed, 'stratus paid', named).map((i) => i.t_ms)).toEqual([5, 3]);
    expect(searchActivity(feed, 'stratus apps', named)).toEqual([]);
  });
});

describe('activityWindow', () => {
  it('spans the oldest to the newest row, whatever order they come in', () => {
    expect(activityWindow(feed)).toEqual({ from: 0, to: 5, count: 6 });
    expect(activityWindow([...feed].reverse())).toEqual({ from: 0, to: 5, count: 6 });
  });

  it('has nothing to span for no rows', () => {
    expect(activityWindow([])).toBeNull();
  });
});

describe('rhythm', () => {
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const at = (t: number, kind: string): WalletActivity => ({
    t_ms: t,
    kind,
    node_key: 'a:0',
    height: null,
    detail: '',
  });

  it('counts the rows into equal slices of time, one count per group', () => {
    const base = Date.UTC(2026, 9, 3, 12, 0);
    const r = rhythm([at(base, 'paid'), at(base + 2 * MIN, 'paid'), at(base + 40 * MIN, 'unreachable')]);
    expect(r).not.toBeNull();
    const out = r as NonNullable<typeof r>;
    expect(out.total.reduce((s, v) => s + v, 0)).toBe(3);
    expect(out.counts.payments.reduce((s, v) => s + v, 0)).toBe(2);
    expect(out.counts.health.reduce((s, v) => s + v, 0)).toBe(1);
    expect(out.counts.nodes.reduce((s, v) => s + v, 0)).toBe(0);
  });

  it('picks the finest slice that leaves no more than the target', () => {
    const base = Date.UTC(2026, 9, 3, 0, 0);
    // Three hours of events: a 5 minute slice would make 37 buckets, so it takes 15 minutes.
    const r = rhythm([at(base, 'paid'), at(base + 3 * HOUR, 'paid')], 36) as NonNullable<
      ReturnType<typeof rhythm>
    >;
    expect(r.bucketMs).toBe(15 * MIN);
    expect(r.t.length).toBeLessThanOrEqual(36);
    // Five weeks of events take the biggest slice there is.
    const long = rhythm([at(base, 'paid'), at(base + 35 * DAY, 'paid')], 4) as NonNullable<
      ReturnType<typeof rhythm>
    >;
    expect(long.bucketMs).toBe(7 * DAY);
  });

  it('has a slice for every stretch of time between the first and the last row, empty ones too', () => {
    const base = Date.UTC(2026, 9, 3, 0, 0);
    const r = rhythm([at(base, 'paid'), at(base + 5 * HOUR + 30 * MIN, 'paid')], 12) as NonNullable<
      ReturnType<typeof rhythm>
    >;
    for (let i = 1; i < r.t.length; i++) expect((r.t[i] as number) - (r.t[i - 1] as number)).toBe(r.bucketMs);
    expect(r.total.some((v) => v === 0)).toBe(true);
    expect(r.total[0]).toBe(1);
    expect(r.total.at(-1)).toBe(1);
    // The slices sit on the clock, not on the first row.
    expect((r.t[0] as number) % r.bucketMs).toBe(0);
  });

  it('is one slice when everything happened at once, and nothing for no rows', () => {
    const r = rhythm([at(1_000, 'paid'), at(1_000, 'apps')]) as NonNullable<ReturnType<typeof rhythm>>;
    expect(r.t).toHaveLength(1);
    expect(r.total).toEqual([2]);
    expect(rhythm([])).toBeNull();
  });

  it('files an unknown kind under node changes, like the filters do', () => {
    const r = rhythm([at(5_000, 'brand_new_kind')]) as NonNullable<ReturnType<typeof rhythm>>;
    expect(r.counts.nodes[0]).toBe(1);
  });
});

describe('the fleet over time', () => {
  const history: FleetDay[] = [
    { day_ms: 1, cumulus: 0, nimbus: 0, stratus: 180 },
    { day_ms: 2, cumulus: 0, nimbus: 0, stratus: 200 },
    { day_ms: 3, cumulus: 0, nimbus: 0, stratus: 208 },
  ];

  it('lays the days out as columns with a total', () => {
    const s = fleetSeries(history);
    expect(s.t).toEqual([1, 2, 3]);
    expect(s.stratus).toEqual([180, 200, 208]);
    expect(s.total).toEqual([180, 200, 208]);
  });

  it('reads the change over the history', () => {
    expect(fleetChange(fleetSeries(history))).toEqual({ from: 180, to: 208, net: 28 });
    expect(fleetChange(fleetSeries(history.slice(0, 1)))).toBeNull();
    expect(fleetChange(fleetSeries([]))).toBeNull();
  });

  it('cuts the days before the first node, and keeps the rest as they were', () => {
    const young = fleetSeries([
      { day_ms: 1, cumulus: 0, nimbus: 0, stratus: 0 },
      { day_ms: 2, cumulus: 0, nimbus: 0, stratus: 0 },
      { day_ms: 3, cumulus: 0, nimbus: 1, stratus: 0 },
      { day_ms: 4, cumulus: 0, nimbus: 0, stratus: 0 },
      { day_ms: 5, cumulus: 2, nimbus: 1, stratus: 0 },
    ]);
    const cut = trimLeadingEmpty(young);
    expect(cut.t).toEqual([3, 4, 5]);
    expect(cut.total).toEqual([1, 0, 3]);
    expect(cut.nimbus).toEqual([1, 0, 1]);
    // A zero day after the first node is part of the story, not leading emptiness.
    expect(trimLeadingEmpty(fleetSeries(history))).toEqual(fleetSeries(history));
  });

  it('keeps the last day when no day ever had a node', () => {
    const none = fleetSeries([
      { day_ms: 1, cumulus: 0, nimbus: 0, stratus: 0 },
      { day_ms: 2, cumulus: 0, nimbus: 0, stratus: 0 },
    ]);
    expect(trimLeadingEmpty(none).t).toEqual([2]);
    expect(trimLeadingEmpty(fleetSeries([])).t).toEqual([]);
  });

  it('reads how many nodes each day added or lost', () => {
    expect(dailyChange(fleetSeries(history))).toEqual([null, 20, 8]);
    expect(
      dailyChange(
        fleetSeries([
          { day_ms: 1, cumulus: 0, nimbus: 0, stratus: 5 },
          { day_ms: 2, cumulus: 0, nimbus: 0, stratus: 3 },
        ]),
      ),
    ).toEqual([null, -2]);
    expect(dailyChange(fleetSeries([]))).toEqual([]);
  });

  it('says the history in a sentence', () => {
    const day = (d: number) => Date.UTC(2026, 9, d);
    const series = fleetSeries([
      { day_ms: day(1), cumulus: 0, nimbus: 0, stratus: 180 },
      { day_ms: day(2), cumulus: 0, nimbus: 0, stratus: 208 },
    ]);
    expect(describeFleet(series)).toBe(
      'Confirmed nodes over 2 days, 1 Oct 2026 to 2 Oct 2026: 180 at the start and 208 nodes on the last day, 28 more.',
    );
    expect(
      describeFleet(
        fleetSeries([
          { day_ms: day(1), cumulus: 0, nimbus: 0, stratus: 5 },
          { day_ms: day(2), cumulus: 0, nimbus: 0, stratus: 1 },
        ]),
      ),
    ).toContain('1 node on the last day, 4 fewer.');
    expect(describeFleet(fleetSeries([{ day_ms: day(1), cumulus: 1, nimbus: 0, stratus: 0 }]))).toBe(
      'One day of fleet history so far, 1 Oct 2026: 1 node.',
    );
    expect(describeFleet(fleetSeries([]))).toBe('The fleet has no history yet.');
    expect(
      describeFleet(
        fleetSeries([
          { day_ms: day(1), cumulus: 2, nimbus: 0, stratus: 0 },
          { day_ms: day(2), cumulus: 2, nimbus: 0, stratus: 0 },
        ]),
      ),
    ).toContain('2 nodes on the last day, no change.');
  });

  it('names the tiers that ever had a node, in stacking order', () => {
    expect(tiersPresent(fleetSeries(history))).toEqual(['stratus']);
    expect(
      tiersPresent(
        fleetSeries([
          { day_ms: 1, cumulus: 3, nimbus: 0, stratus: 1 },
          { day_ms: 2, cumulus: 3, nimbus: 2, stratus: 1 },
        ]),
      ),
    ).toEqual(['cumulus', 'nimbus', 'stratus']);
  });
});
