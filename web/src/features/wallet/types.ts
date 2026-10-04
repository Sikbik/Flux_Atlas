// The wallet workspace's vocabulary. The DTOs are the backend's: generated into `src/api/generated` and re-exported
// here under their own names, so the feature imports from one place and nothing is declared twice. What follows
// the re-exports is what a generated file cannot say: the three tiers that earn, and the currencies the price
// endpoint quotes.

export type { Amount } from '../../api/generated/Amount';
export type { BenchMetric } from '../../api/generated/BenchMetric';
export type { ConcentrationBucket } from '../../api/generated/ConcentrationBucket';
export type { ConcentrationBy } from '../../api/generated/ConcentrationBy';
export type { EarningsDay } from '../../api/generated/EarningsDay';
export type { FleetDay } from '../../api/generated/FleetDay';
export type { HealthKind } from '../../api/generated/HealthKind';
export type { HealthReason } from '../../api/generated/HealthReason';
export type { MissedPayments } from '../../api/generated/MissedPayments';
export type { MultiClaim } from '../../api/generated/MultiClaim';
export type { NodeAttention } from '../../api/generated/NodeAttention';
export type { NodeRow } from '../../api/generated/NodeRow';
export type { PaChain } from '../../api/generated/PaChain';
export type { PaClaim } from '../../api/generated/PaClaim';
export type { ParallelAssetsDto } from '../../api/generated/ParallelAssetsDto';
export type { Percentiles } from '../../api/generated/Percentiles';
export type { PricePoint } from '../../api/generated/PricePoint';
export type { PricesDto } from '../../api/generated/PricesDto';
export type { ProjectionDay } from '../../api/generated/ProjectionDay';
export type { SubsidyReduction } from '../../api/generated/SubsidyReduction';
export type { Tier } from '../../api/generated/Tier';
export type { TierCounts } from '../../api/generated/TierCounts';
export type { TierShares } from '../../api/generated/TierShares';
export type { WalletActivity } from '../../api/generated/WalletActivity';
export type { WalletApp } from '../../api/generated/WalletApp';
export type { WalletApps } from '../../api/generated/WalletApps';
export type { WalletBenchmark } from '../../api/generated/WalletBenchmark';
export type { WalletConcentration } from '../../api/generated/WalletConcentration';
export type { WalletDto } from '../../api/generated/WalletDto';
export type { WalletEarnings } from '../../api/generated/WalletEarnings';
export type { WalletHealth } from '../../api/generated/WalletHealth';
export type { WalletPayout } from '../../api/generated/WalletPayout';
export type { WalletStanding } from '../../api/generated/WalletStanding';

/** A tier that earns (the generated `Tier` also has `unknown`). */
export type PayTier = 'cumulus' | 'nimbus' | 'stratus';

export const PAY_TIERS: readonly PayTier[] = ['cumulus', 'nimbus', 'stratus'];

/** The currencies the selector offers, in the order it lists them. The server quotes the ones CoinGecko answered. */
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
