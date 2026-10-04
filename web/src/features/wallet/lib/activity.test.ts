import { describe, expect, it } from 'vitest';
import type { FleetHistoryDay, WalletActivityItem } from '../types';
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
  tiersPresent,
  toneOfKind,
} from './activity';

const item = (t: number, kind: string, detail = ''): WalletActivityItem => ({
  t_ms: t,
  kind,
  node_key: 'a:0',
  height: 3_000_000 + t,
  detail,
});

const feed = [
  item(5, 'node_paid', 'Paid 9.00 FLUX'),
  item(4, 'node_ip_changed', 'IP changed'),
  item(3, 'node_paid', 'Paid 9.00 FLUX'),
  item(2, 'app_deployed', 'App deployed'),
  item(1, 'node_at_risk', 'At risk'),
  item(0, 'surprise_kind', 'Something new'),
];

describe('groups', () => {
  it('puts each kind under one filter, and an unknown kind under the chain', () => {
    expect(groupOfKind('node_paid')).toBe('payments');
    expect(groupOfKind('node_dosed')).toBe('health');
    expect(groupOfKind('node_ip_changed')).toBe('nodes');
    expect(groupOfKind('app_renewed')).toBe('apps');
    expect(groupOfKind('reward_reduction')).toBe('chain');
    expect(groupOfKind('surprise_kind')).toBe('chain');
  });

  it('lists five filters', () => {
    expect(ACTIVITY_GROUPS.map((g) => g.id)).toEqual(['payments', 'health', 'nodes', 'apps', 'chain']);
  });

  it('labels a kind in words, and makes up words for a new one', () => {
    expect(kindLabel('node_paid')).toBe('Payment');
    expect(kindLabel('node_ip_changed')).toBe('IP changed');
    expect(kindLabel('surprise_kind')).toBe('Surprise kind');
  });

  it('gives a kind a colour role', () => {
    expect(toneOfKind('node_paid')).toBe('pay');
    expect(toneOfKind('node_recovered')).toBe('ok');
    expect(toneOfKind('node_at_risk')).toBe('warn');
    expect(toneOfKind('node_dosed')).toBe('crit');
    expect(toneOfKind('node_heartbeat')).toBe('muted');
    expect(toneOfKind('app_deployed')).toBe('info');
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
    expect(countByGroup(feed)).toEqual({ payments: 2, health: 1, nodes: 1, apps: 1, chain: 1 });
  });

  it('sorts newest first without touching the input', () => {
    const shuffled = [feed[2], feed[0], feed[4]] as WalletActivityItem[];
    expect(newestFirst(shuffled).map((i) => i.t_ms)).toEqual([5, 3, 1]);
    expect(shuffled.map((i) => i.t_ms)).toEqual([3, 5, 1]);
  });
});

describe('payments', () => {
  it('reads the amount back out of the sentence', () => {
    expect(paymentAmount('Paid 9.00 FLUX')).toBe(9);
    expect(paymentAmount('Paid 1,234.50 FLUX at block 3,006,000')).toBe(1234.5);
    expect(paymentAmount('Payment received')).toBeNull();
  });

  it('adds up the payments with an amount and counts those without', () => {
    expect(paymentSummary(feed)).toEqual({ count: 2, flux: 18 });
    expect(paymentSummary([item(1, 'node_paid', 'Payment received')])).toEqual({ count: 1, flux: 0 });
    expect(paymentSummary([])).toEqual({ count: 0, flux: 0 });
  });
});

describe('the fleet over time', () => {
  const history: FleetHistoryDay[] = [
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
