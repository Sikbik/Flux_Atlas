// What a fleet will earn, and what it costs to keep: the 365 day projection with the reward cut marked, the
// price scenario, and the profitability read (net per month, margin, yield on collateral, break-even price).
// Pure functions over the wallet's own numbers; nothing here fetches or draws.

import type { CurrencyCode, PayTier, ProjectionDay, SubsidyReduction } from '../types';
import { PAY_TIERS } from '../types';
import { DAY_MS, flux, MONTH_DAYS } from './money';

// ---- the projection -------------------------------------------------------------------------------

/** Where the daily rate steps down: the reward cut. */
export interface ProjectionStep {
  /** Index into the projection's days of the first day at the lower rate. */
  index: number;
  /** Start of that UTC day, unix ms. */
  t: number;
  /** The block height of the cut. */
  height: number;
  /** FLUX per day just before and just after (the total the chart shows). */
  before: number;
  after: number;
  /** The change in the subsidy (`-0.1` for the usual cut of one tenth). */
  change: number;
}

export interface Projection {
  /** Start of each UTC day, unix ms. */
  t: number[];
  /** FLUX per day. */
  native: number[];
  pa: number[];
  /** What the chart draws: native, plus the parallel assets when they count. */
  total: number[];
  /** The running total of `total`. */
  cumulative: number[];
  sums: { native: number; pa: number; total: number };
  step: ProjectionStep | null;
}

/** The start of the UTC day that contains `ms`. */
export const dayStart = (ms: number): number => Math.floor(ms / DAY_MS) * DAY_MS;

/**
 * The projection as columns. The step is found from the cut's own estimate (its height and time, from the
 * server) rather than guessed from the numbers, so a flat projection with a cut beyond its end has none.
 */
export function buildProjection(
  days: readonly ProjectionDay[],
  reduction: SubsidyReduction | null,
  includePa: boolean,
): Projection {
  const t: number[] = [];
  const native: number[] = [];
  const pa: number[] = [];
  const total: number[] = [];
  const cumulative: number[] = [];
  let run = 0;
  let nativeSum = 0;
  let paSum = 0;
  for (const d of days) {
    const n = flux(d.native);
    const p = flux(d.pa);
    const tot = n + (includePa ? p : 0);
    t.push(d.day_ms);
    native.push(n);
    pa.push(p);
    total.push(tot);
    run += tot;
    cumulative.push(run);
    nativeSum += n;
    paSum += p;
  }
  return {
    t,
    native,
    pa,
    total,
    cumulative,
    sums: { native: nativeSum, pa: paSum, total: nativeSum + (includePa ? paSum : 0) },
    step: reduction ? findStep(t, total, reduction) : null,
  };
}

function findStep(
  t: readonly number[],
  total: readonly number[],
  r: SubsidyReduction,
): ProjectionStep | null {
  if (t.length < 2) return null;
  const at = dayStart(r.eta_ms);
  const first = t[0] as number;
  const last = t[t.length - 1] as number;
  // A cut before the projection begins has already happened; one after its end is not on the chart.
  if (at <= first || at > last) return null;
  const index = t.findIndex((x) => x >= at);
  if (index < 1) return null;
  const before = flux(r.subsidy_before);
  const after = flux(r.subsidy_after);
  return {
    index,
    t: t[index] as number,
    height: r.height,
    before: total[index - 1] as number,
    after: total[index] as number,
    change: before > 0 ? after / before - 1 : 0,
  };
}

// ---- the price scenario ---------------------------------------------------------------------------

/** One step of the scenario slider is a twentieth of a decade: 20 steps from spot is ten times the price. */
export const SCENARIO_STEPS_PER_DECADE = 20;
export const SCENARIO_MIN = -20;
export const SCENARIO_MAX = 20;

/** The price multiple for a slider step: 0 is today's price, 20 is ten times, -20 a tenth. */
export function scenarioFactor(step: number): number {
  const s = Math.min(SCENARIO_MAX, Math.max(SCENARIO_MIN, Math.round(step)));
  return 10 ** (s / SCENARIO_STEPS_PER_DECADE);
}

/** The slider step nearest a multiple (the inverse of `scenarioFactor`). */
export function scenarioStep(factor: number): number {
  if (!(factor > 0)) return 0;
  const s = Math.round(Math.log10(factor) * SCENARIO_STEPS_PER_DECADE);
  return Math.min(SCENARIO_MAX, Math.max(SCENARIO_MIN, s));
}

/** The presets beside the slider: a multiple and how to say it. */
export const SCENARIO_PRESETS: readonly { factor: number; label: string }[] = [
  { factor: 0.5, label: 'Half' },
  { factor: 1, label: 'Today' },
  { factor: 2, label: '2x' },
  { factor: 5, label: '5x' },
  { factor: 10, label: '10x' },
];

/** `2.0x`, `0.50x`, `Today`: the multiple as it reads beside the slider. */
export function factorText(factor: number): string {
  if (Math.abs(factor - 1) < 0.005) return 'Today';
  if (factor >= 10) return `${factor.toFixed(0)}x`;
  if (factor >= 1) return `${factor.toFixed(1)}x`;
  return `${factor.toFixed(2)}x`;
}

// ---- profitability --------------------------------------------------------------------------------

/** What it costs to host one node for a month, per tier, in a currency the viewer chose. */
export interface HostingCosts {
  currency: CurrencyCode;
  perNode: Record<PayTier, number>;
}

export const NO_COSTS: HostingCosts = { currency: 'usd', perNode: { cumulus: 0, nimbus: 0, stratus: 0 } };

export interface ProfitInput {
  nativePerDay: number;
  paPerDay: number;
  /** Count the parallel assets as income (they are worth what they sell for, which is not certain). */
  includePa: boolean;
  nodes: Record<PayTier, number>;
  collateralFlux: number;
  /** Money per FLUX in the display currency (the scenario's, when one is set); null when there is no price. */
  price: number | null;
  /** Per node per month, in the display currency. */
  costs: Record<PayTier, number>;
}

export interface TierCost {
  tier: PayTier;
  nodes: number;
  /** Per month, in the display currency. */
  cost: number;
}

export interface Profit {
  /** FLUX earned per month (native, and the parallel assets when counted). */
  fluxMonthly: number;
  /** Money per month; null without a price. */
  revenue: number | null;
  cost: number;
  net: number | null;
  /** Net over revenue (a loss reads negative); null when nothing is earned or there is no price. */
  margin: number | null;
  /** Net over the year, as a share of what the collateral is worth at the price. */
  apr: number | null;
  /** The price per FLUX at which revenue just covers cost; null when no cost is entered or nothing is earned. */
  breakEven: number | null;
  /** Whether the viewer has entered any cost: with none, net is just revenue and says so. */
  costed: boolean;
  perTier: TierCost[];
}

export function profitability(i: ProfitInput): Profit {
  const fluxMonthly = (i.nativePerDay + (i.includePa ? i.paPerDay : 0)) * MONTH_DAYS;
  const perTier: TierCost[] = PAY_TIERS.map((tier) => ({
    tier,
    nodes: i.nodes[tier],
    cost: i.nodes[tier] * (i.costs[tier] ?? 0),
  }));
  const cost = perTier.reduce((s, t) => s + t.cost, 0);
  const revenue = i.price === null ? null : fluxMonthly * i.price;
  const net = revenue === null ? null : revenue - cost;
  const collateralValue = i.price === null ? null : i.collateralFlux * i.price;
  return {
    fluxMonthly,
    revenue,
    cost,
    net,
    margin: revenue !== null && net !== null && revenue > 0 ? net / revenue : null,
    apr:
      net !== null && collateralValue !== null && collateralValue > 0 ? (net * 12) / collateralValue : null,
    breakEven: cost > 0 && fluxMonthly > 0 ? cost / fluxMonthly : null,
    costed: cost > 0,
    perTier,
  };
}

/** Parses what the viewer typed into a cost field: a non-negative number, or null for text that is not one. */
export function parseCostInput(text: string): number | null {
  const t = text.trim().replace(/,/g, '');
  if (t === '') return 0;
  if (!/^\d*\.?\d*$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
