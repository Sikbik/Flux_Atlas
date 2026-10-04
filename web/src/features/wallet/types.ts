// The wallet workspace's data contract: `GET /api/v1/wallet/{addr}`, `GET /api/v1/wallet/{addr}/parallel-assets`
// and `GET /api/v1/prices`.
//
// TODO(B11): these mirror the DTOs the backend generates into `src/api/generated` (`WalletDto`,
// `ParallelAssetsDto`, `PricesDto` and their parts). When that lands, delete the interfaces below and re-export
// the generated ones from here, so the feature keeps importing from one place. `Amount`, `Tier`, `TierCounts`
// and `NodeRow` are generated already and are used as they are.

import type { Amount } from '../../api/generated/Amount';
import type { NodeRow } from '../../api/generated/NodeRow';
import type { Tier } from '../../api/generated/Tier';
import type { TierCounts } from '../../api/generated/TierCounts';

export type { Amount, NodeRow, Tier, TierCounts };

/** A tier that earns (the generated `Tier` also has `unknown`). */
export type PayTier = 'cumulus' | 'nimbus' | 'stratus';

export const PAY_TIERS: readonly PayTier[] = ['cumulus', 'nimbus', 'stratus'];

// ---- /wallet/{addr} -----------------------------------------------------------------------------------

export interface WalletStanding {
  balance: Amount | null;
  collateral_locked: Amount;
  liquid: Amount | null;
  richlist_rank: number | null;
  operator_rank: number | null;
  operator_count: number;
  /** The share of each tier's nodes this wallet runs, 0 to 1. */
  share_of_tier: Record<PayTier, number>;
  first_active_ms: number | null;
}

export interface EarningsDay {
  /** Start of the UTC day, unix ms. */
  day_ms: number;
  native: Amount;
  payments: number;
  cumulus: Amount;
  nimbus: Amount;
  stratus: Amount;
}

export interface MissedNode {
  node_key: string;
  expected: number;
  received: number;
}

export interface ProjectionDay {
  day_ms: number;
  native: Amount;
  pa: Amount;
}

export interface RewardReduction {
  height: number;
  eta_ms: number;
  subsidy_before: Amount;
  subsidy_after: Amount;
}

export interface WalletEarnings {
  /** Realized, one entry per UTC day, oldest first. */
  days: EarningsDay[];
  covered_from_ms: number | null;
  expected_payments: number;
  received_payments: number;
  missed: MissedNode[];
  native_per_day: Amount;
  pa_per_day: Amount;
  /** 365 days from today. */
  projection: ProjectionDay[];
  reduction: RewardReduction | null;
}

/** One node's next payment. The list holds every node, soonest first. */
export interface WalletPayout {
  node_key: string;
  tier: Tier;
  height: number;
  eta_ms: number;
  amount: Amount;
}

export type HealthReasonKind =
  | 'version_outdated'
  | 'bench_failed'
  | 'bench_error'
  | 'expiring_soon'
  | 'dos'
  | 'unreachable'
  | 'low_headroom';

export interface HealthReason {
  kind: HealthReasonKind;
  detail: string;
  metric: string | null;
  value: number | null;
  threshold: number | null;
}

export interface NodeAttention {
  node_key: string;
  reasons: HealthReason[];
}

export interface WalletHealth {
  healthy: number;
  attention: NodeAttention[];
}

export type BenchMetric = 'eps' | 'disk_write_mbs' | 'down_mbps' | 'up_mbps' | 'ram_gb' | 'cores' | 'ssd_gb';

export interface BenchBand {
  tier: Tier;
  metric: BenchMetric;
  /** The network's nodes of this tier. */
  network: { p10: number; p50: number; p90: number };
  fleet_median: number;
  fleet_min: number;
  /** What the tier requires, when it states one. */
  minimum: number | null;
}

export type ConcentrationBy = 'country' | 'city' | 'provider';

export interface ConcentrationBucket {
  key: string;
  label: string;
  nodes: number;
}

export interface Concentration {
  by: ConcentrationBy;
  /** Largest first. */
  buckets: ConcentrationBucket[];
  /** Herfindahl-Hirschman index of the node shares, 0 to 1. */
  hhi: number;
  /** The largest bucket's share of the fleet, 0 to 1. */
  top_share: number;
}

export interface WalletAppRef {
  name: string;
  instances: number;
  node_keys: string[];
}

export interface WalletApps {
  instances: number;
  apps: WalletAppRef[];
}

export interface WalletActivityItem {
  t_ms: number;
  /** A feed kind (`node_paid`, `node_ip_changed`, ...). */
  kind: string;
  node_key: string | null;
  height: number | null;
  detail: string;
}

export interface FleetHistoryDay {
  day_ms: number;
  cumulus: number;
  nimbus: number;
  stratus: number;
}

export interface WalletDto {
  address: string;
  generated_ms: number;
  tip_height: number;
  standing: WalletStanding;
  tiers: TierCounts;
  nodes: NodeRow[];
  earnings: WalletEarnings;
  /** Every node's next payment, soonest first. */
  payouts: WalletPayout[];
  health: WalletHealth;
  benchmarks: BenchBand[];
  concentration: Concentration[];
  apps: WalletApps;
  /** Newest first, at most 200. */
  activity: WalletActivityItem[];
  fleet_history: FleetHistoryDay[];
}

// ---- /wallet/{addr}/parallel-assets -------------------------------------------------------------------

export interface ParallelChain {
  /** The chain's short id (`kda`, `bsc`, `eth`, `trx`, `sol`, `avax`, `erg`, `algo`, `matic`, `base`). */
  chain: string;
  name: string;
  /** False once the chain's parallel asset has ended in Fusion (ERG): it still accrues, it cannot be claimed. */
  active: boolean;
  mined: number;
  claimed: number;
  received: number;
  fees_paid: number;
  claimable: number;
  claim_fee: number;
  /** `{txid}` template. */
  explorer_tx: string | null;
  explorer_address: string | null;
}

export interface ParallelClaim {
  chain: string;
  amount: number;
  txid: string;
  to: string;
  explorer_url: string | null;
  time_ms: number | null;
}

export interface ParallelAssetsDto {
  address: string;
  fetched_ms: number;
  /** FLUX, over every chain. */
  mined: number;
  claimed: number;
  claimable: number;
  /** Claiming every chain in one go. */
  multi: { claimable: number; fees: number; net: number };
  accrual_per_day: number | null;
  chains: ParallelChain[];
  /** Newest first. */
  claims: ParallelClaim[];
}

// ---- /prices ------------------------------------------------------------------------------------------

export const CURRENCIES = [
  'usd',
  'eur',
  'gbp',
  'aud',
  'cad',
  'chf',
  'jpy',
  'cny',
  'inr',
  'krw',
  'sgd',
  'hkd',
  'thb',
  'myr',
  'idr',
  'btc',
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number];

export interface PriceDay {
  day_ms: number;
  usd: number;
}

export interface PricesDto {
  generated_ms: number;
  /** The price of one FLUX in each currency. */
  spot: Record<CurrencyCode, number>;
  change_24h_pct: number | null;
  /** 365 days, oldest first. */
  history: PriceDay[];
}
