import { describe, expect, it } from 'vitest';
import type { FleetDay, WalletActivity } from '../types';
import {
  ACTIVITY_GROUPS,
  type ActivityGroup,
  countByGroup,
  filterActivity,
  fleetChange,
  fleetSeries,
  groupOfKind,
  kindLabel,
  newestFirst,
  paymentAmount,
  paymentSummary,
  paymentTier,
  tiersPresent,
  toneOfKind,
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
