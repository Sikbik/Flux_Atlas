// Made-up rows for the loading states. A loading panel draws the real markup with these numbers (see Redact), so it has
// exactly the geometry of the loaded one at every width and nothing moves when the data arrives. None of it is ever
// shown as a figure: the markup is hidden from assistive technology and every glyph in it is drawn as a gray block. Pure.

import type { AgeModel } from './age';
import { type BenchModel, benchModel } from './benchmarks';
import { churnRow } from './churn';
import type { DecentralModel } from './decentral';
import type { Distribution } from './distributions';
import type { NewestRow } from './newest';
import { OPERATORS_SHOWN, type OperatorView } from './operators';
import type { QueueRow } from './queue';
import type { HealthModel } from './status';
import { TIER_KEYS, TIER_NAME } from './tiers';

/** The two windows of joined and left, the longer one a floor, as a young server sends them. */
export const GHOST_CHURN = [
  churnRow({ window: '24h', joined: 100, left: 40, complete: true }),
  churnRow({ window: '7d', joined: 700, left: 300, complete: false }),
];

/** Three parts of a health strip. */
export const GHOST_HEALTH: HealthModel = {
  total: 1000,
  overlap: 10,
  summary: '',
  parts: [
    { id: 'healthy', label: 'Healthy', count: 700, share: 0.7, tone: 'ok' },
    { id: 'at-risk', label: 'At risk', count: 250, share: 0.25, tone: 'warn' },
    { id: 'unreachable', label: 'Unreachable', count: 50, share: 0.05, tone: 'off' },
  ],
  items: [
    { id: 'healthy', label: 'Healthy', count: 700, share: 0.7, tone: 'ok', meaning: '' },
    { id: 'at-risk', label: 'At risk', count: 250, share: 0.25, tone: 'warn', meaning: '' },
    { id: 'unreachable', label: 'Unreachable', count: 60, share: 0.06, tone: 'off', meaning: '' },
  ],
};

/** Operators as the leaderboard draws them, the two-line cells filled the way real ones are. */
export function ghostOperators(n = OPERATORS_SHOWN): OperatorView[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `ghost-${i}`,
    rank: i + 1,
    name: '1XXXXX…XXXX',
    grouping: null,
    since: 'since Jan 2024',
    nodes: 400 - i * 30,
    share: 0.05,
    shareText: '5.0%',
    tiers: [
      { tier: 'cumulus', count: 3, share: 0.3 },
      { tier: 'nimbus', count: 3, share: 0.3 },
      { tier: 'stratus', count: 4, share: 0.4 },
    ],
    tiersText: '',
    countries: 5,
    topCountry: { name: 'Country', full: 'Country', pct: '50%' },
    providers: 5,
    topProvider: { name: 'Provider', full: 'Provider', pct: '50%' },
    perDay: 1000,
    perDayText: '1,000',
    nativePerDay: 500,
    paPerDay: 500,
    healthy: 0.99,
    healthText: '99%',
    problems: [
      { kind: 'at-risk', count: 100, text: '100 at risk', short: '100 at risk' },
      { kind: 'unreachable', count: 10, text: '10 unreachable', short: '10 unreachable' },
    ],
    walletAddress: 't1ghost',
  }));
}

/** The newest nodes as the list draws them. */
export function ghostNewest(n = 10, now = Date.now()): NewestRow[] {
  return Array.from({ length: n }, (_, i) => {
    const tier = TIER_KEYS[i % TIER_KEYS.length] ?? 'cumulus';
    return {
      key: `ghost-${i}`,
      shortKey: 'XXXXXXXX…X',
      tier,
      tierName: TIER_NAME[tier],
      country: 'Country',
      countryCode: null,
      provider: 'Provider',
      providerKey: null,
      sinceMs: now - (i + 1) * 3_600_000,
    };
  });
}

/** One metric across the three tiers, each with a minimum, so the chart has all its parts. */
export function ghostBench(): BenchModel | null {
  const spread = (tier: 'cumulus' | 'nimbus' | 'stratus', minimum: number, p50: number) => ({
    tier,
    metric: 'eps' as const,
    p10: minimum,
    p50,
    p90: p50 * 1.6,
    minimum,
    nodes: 100,
  });
  return benchModel(
    [spread('cumulus', 100, 240), spread('nimbus', 200, 380), spread('stratus', 400, 600)],
    'eps',
  );
}

/** The payment queue's three tiers. */
export const GHOST_QUEUE: QueueRow[] = TIER_KEYS.map((tier) => ({
  tier,
  name: TIER_NAME[tier],
  nodes: 1000,
  payout: '1.00',
  cycleBlocks: 1000,
  cycleText: '12 hours',
  perDay: 10,
  perDayText: '10',
  nativePerDay: 5,
  paPerDay: 5,
  next: { nodeId: null, outpoint: null, endpoint: '000.000.000.000:00000', address: null },
}));

/** The six age buckets and the unknown column. */
export const GHOST_AGE: AgeModel = {
  bars: [
    { id: '<7d', label: '<7d', long: 'Under 7 days', count: 30, share: 0.03, frac: 0.1, unknown: false },
    { id: '7-30d', label: '7-30d', long: '7 to 30 days', count: 80, share: 0.08, frac: 0.27, unknown: false },
    { id: '1-6mo', label: '1-6mo', long: '1 to 6 months', count: 300, share: 0.3, frac: 1, unknown: false },
    {
      id: '6-12mo',
      label: '6-12mo',
      long: '6 months to 1 year',
      count: 250,
      share: 0.25,
      frac: 0.8,
      unknown: false,
    },
    { id: '1-2y', label: '1-2y', long: '1 to 2 years', count: 200, share: 0.2, frac: 0.66, unknown: false },
    { id: '2y+', label: '2y+', long: 'Over 2 years', count: 100, share: 0.1, frac: 0.33, unknown: false },
    {
      id: 'unknown',
      label: 'Unknown',
      long: 'No known start',
      count: 40,
      share: 0.04,
      frac: 0.13,
      unknown: true,
    },
  ],
  total: 1000,
  unknown: 40,
  reading: 'The largest group of nodes, 39.9%, is 1 to 6 months old.',
  summary: '',
};

/** The three Nakamoto figures and the two concentration gauges. */
export const GHOST_DECENTRAL: DecentralModel = {
  nakamoto: [
    { id: 'country', n: 4, noun: 'countries', label: 'countries run more than half' },
    { id: 'provider', n: 5, noun: 'providers', label: 'providers run more than half' },
    { id: 'operator', n: 90, noun: 'operators', label: 'operators run more than half' },
  ],
  hhi: [
    {
      id: 'country',
      label: 'Countries',
      value: 0.12,
      text: '0.12',
      band: 'low',
      word: 'low concentration',
      at: 0.25,
    },
    {
      id: 'provider',
      label: 'Providers',
      value: 0.2,
      text: '0.20',
      band: 'moderate',
      word: 'moderate concentration',
      at: 0.5,
    },
  ],
  reading:
    'More than half of all nodes run in 3 countries and on 8 providers. It takes 40 operators to reach the same share. Ownership is far more spread out than hosting.',
  multiNodeHosts: 0,
  operators: 1000,
};

/** Six bars with a sentence over them, as a distribution panel draws them. */
export const GHOST_DIST: Distribution = {
  rows: Array.from({ length: 6 }, (_, i) => ({
    id: `ghost-${i}`,
    label: 'Country',
    count: 1000 - i * 120,
    share: 0.3 - i * 0.04,
    shareText: '30%',
    lead: i < 2,
    color: undefined,
    to: { kind: 'country' as const, value: 'XX' },
    title: '',
  })),
  entries: 40,
  reading: 'Germany, United States and Finland hold 53.6% of all nodes.',
};
