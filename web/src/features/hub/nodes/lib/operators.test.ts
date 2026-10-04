import { describe, expect, it } from 'vitest';
import type { OperatorRow } from '../../../../api/generated/OperatorRow';
import type { OperatorsDto } from '../../../../api/generated/OperatorsDto';
import {
  healthText,
  listTracks,
  OPERATORS_SHOWN,
  operatorsAside,
  operatorView,
  operatorViews,
  perDayText,
  sinceText,
  tiersText,
  visibleOperators,
} from './operators';

const WALLET = 't1AbcdefghijkmnpqrstuvwxyzABCDEFGHJ';

const row = (over: Partial<OperatorRow> = {}): OperatorRow => ({
  key: '1DFiyJUKyCCGPr3r6rU4ErNmNF3h2prRZ2',
  key_kind: 'zelid',
  rank: 1,
  nodes: 436,
  share: 0.0657,
  tiers: { cumulus: 212, nimbus: 176, stratus: 48, total: 436 },
  countries: 18,
  top_country: { code: 'FI', name: 'Finland', nodes: 188 },
  providers: 52,
  top_provider: { key: 'hetzner', label: 'Hetzner Online GmbH', nodes: 183 },
  addresses: 70,
  top_address: WALLET,
  native_per_day: '2047.64547647',
  collateral_locked: '4332000.00000000',
  healthy_pct: 0.9954128440366973,
  at_risk: 0,
  unreachable: 2,
  dos: 0,
  app_instances: 466,
  first_active_ms: Date.UTC(2025, 6, 15),
  ...over,
});

describe('operatorView', () => {
  it('shortens the key and shows the share the way the analytics tabs do', () => {
    const v = operatorView(row(), 'zelid');
    expect(v.name).toBe('1DFiyJ…rRZ2');
    expect(v.shareText).toBe('6.6%');
    expect(v.since).toBe('since Jul 2025');
  });

  it('gives the tier mix as shares of the operator and as words', () => {
    const v = operatorView(row(), 'zelid');
    expect(v.tiers.map((t) => t.tier)).toEqual(['cumulus', 'nimbus', 'stratus']);
    expect(v.tiers[0]?.share).toBeCloseTo(212 / 436);
    expect(v.tiersText).toBe('212 Cumulus, 176 Nimbus, 48 Stratus');
  });

  it('leaves a tier the operator has none of out of the words', () => {
    const v = operatorView(
      row({ tiers: { cumulus: 40, nimbus: 0, stratus: 0, total: 40 }, nodes: 40 }),
      'zelid',
    );
    expect(v.tiersText).toBe('40 Cumulus');
  });

  it('says how much of the operator its biggest country and provider hold', () => {
    const v = operatorView(row(), 'zelid');
    expect(v.topCountry).toEqual({ name: 'Finland', full: 'Finland', pct: '43%' });
    // A provider goes by the words that name it, the registered name on hover.
    expect(v.topProvider).toEqual({ name: 'Hetzner Online', full: 'Hetzner Online GmbH', pct: '42%' });
    const none = operatorView(row({ top_country: null, top_provider: null }), 'zelid');
    expect(none.topCountry).toBeNull();
    expect(none.topProvider).toBeNull();
  });

  it('labels a ZelID row that is really a payment address, and only that', () => {
    expect(operatorView(row({ key_kind: 'address' }), 'zelid').grouping).toBe('no ZelID');
    expect(operatorView(row({ key_kind: 'zelid' }), 'zelid').grouping).toBeNull();
    // Asked for by payment address, every row is one: it is said once for the list, not on each row.
    expect(operatorView(row({ key_kind: 'address' }), 'address').grouping).toBeNull();
  });

  it('only offers a wallet for an address the wallet window accepts', () => {
    expect(operatorView(row(), 'zelid').walletAddress).toBe(WALLET);
    expect(
      operatorView(row({ top_address: '1DFiyJUKyCCGPr3r6rU4ErNmNF3h2prRZ2' }), 'zelid').walletAddress,
    ).toBeNull();
    expect(operatorView(row({ top_address: null }), 'zelid').walletAddress).toBeNull();
  });

  it('lists only the problems there are, worst first', () => {
    const v = operatorView(row({ dos: 1, at_risk: 3, unreachable: 2 }), 'zelid');
    expect(v.problems.map((p) => p.text)).toEqual(['1 on the DoS list', '3 at risk', '2 unreachable']);
    // The DoS count is the only one with a short form: it rides on the health line, where the others have a line each.
    expect(v.problems.map((p) => p.short)).toEqual(['1 DoS', '3 at risk', '2 unreachable']);
    expect(operatorView(row({ unreachable: 0 }), 'zelid').problems).toEqual([]);
  });
});

describe('figures as text', () => {
  it('never rounds nearly-all up to all', () => {
    expect(healthText(1)).toBe('100%');
    expect(healthText(0.9999)).toBe('99.9%');
    expect(healthText(0.9954)).toBe('99.5%');
    expect(healthText(0)).toBe('0.0%');
  });

  it('keeps the run rate honest at both ends', () => {
    expect(perDayText(2047.6)).toBe('2,048');
    expect(perDayText(9.96)).toBe('10');
    expect(perDayText(0.85)).toBe('0.9');
    expect(perDayText(0.03)).toBe('<0.1');
    expect(perDayText(null)).toBe('Unknown');
  });

  it('dates the start by month, in UTC', () => {
    expect(sinceText(Date.UTC(2023, 2, 1, 0, 30))).toBe('since Mar 2023');
    expect(sinceText(null)).toBeNull();
    expect(sinceText(0)).toBeNull();
  });

  it('writes the tier mix without empty tiers', () => {
    expect(tiersText([])).toBe('No nodes');
  });
});

describe('the list', () => {
  const dto = (n: number, by: OperatorsDto['by'] = 'zelid'): OperatorsDto => ({
    generated_ms: 1,
    by,
    total_operators: 1205,
    total_nodes: 6848,
    operators: Array.from({ length: n }, (_, i) => row({ key: `1op${i}`, rank: i + 1 })),
  });

  it('keeps the server order and shows the top ten until asked for all', () => {
    const rows = operatorViews(dto(25));
    expect(rows).toHaveLength(25);
    expect(rows.map((r) => r.rank).slice(0, 3)).toEqual([1, 2, 3]);
    expect(visibleOperators(rows, false)).toHaveLength(OPERATORS_SHOWN);
    expect(visibleOperators(rows, true)).toHaveLength(25);
    expect(visibleOperators(rows.slice(0, 4), false)).toHaveLength(4);
  });

  it('is empty without an answer', () => {
    expect(operatorViews(undefined)).toEqual([]);
  });

  it('says how many operators run how many nodes', () => {
    expect(operatorsAside(dto(1))).toBe('1,205 operators run 6,848 nodes');
    expect(operatorsAside({ total_operators: 1, total_nodes: 1 })).toBe('1 operator runs 1 node');
  });
});

describe('listTracks', () => {
  const columns = [
    { width: 'A' },
    { width: 'B', hide: 'compact' as const },
    { width: 'C', hide: 'narrow' as const },
    { width: 'D', mid: 'D-mid', low: 'D-low' },
    { width: 'E', low: 'E-low' },
  ];
  const head = '2.25rem minmax(0, 1.5fr)';

  it('lays out every column between the name and the link', () => {
    expect(listTracks(columns)).toBe(`${head} A B C D E auto`);
  });

  it('takes out the columns marked compact when a medium list drops them, and uses the medium widths', () => {
    expect(listTracks(columns, ['compact'])).toBe(`${head} A C D-mid E auto`);
  });

  it('takes out both kinds when the list is at its narrowest, and uses the narrowest widths', () => {
    expect(listTracks(columns, ['compact', 'narrow'])).toBe(`${head} A D-low E-low auto`);
  });
});
