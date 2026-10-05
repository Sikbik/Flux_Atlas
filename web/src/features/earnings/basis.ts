// What an earnings figure counts. Every FLUX a node earns on the Flux main chain accrues as much again in
// parallel assets, claimable through Flux Fusion; the server sends that accrual beside each main-chain amount
// (`pa_*` fields, computed by the one rule in `atlas_core::emission`). Atlas adds the two wherever it says what a
// node or an operator earns, unless the viewer chose main chain only (`includePa` in the UI store). Nothing here
// applies the rule itself: it only sums what the server sent. Pure.

import { parseFlux } from '../../lib/format';

/** `all`: main chain and parallel assets; `main`: main chain only. */
export type EarningsBasis = 'all' | 'main';

export const basisOf = (includePa: boolean): EarningsBasis => (includePa ? 'all' : 'main');

/** A main-chain amount and the parallel assets it accrued, in FLUX. */
export interface PaSplit {
  native: number;
  pa: number;
}

/** What is earned on the viewer's basis: main chain, plus the parallel assets when they count. */
export function earned(split: PaSplit, includePa: boolean): number {
  return split.native + (includePa ? split.pa : 0);
}

/**
 * The same over amounts that can be unknown: unknown when the main chain is, and, when parallel assets count,
 * when they are (the server leaves both unknown together).
 */
export function earnedOrNull(native: number | null, pa: number | null, includePa: boolean): number | null {
  if (native === null) return null;
  if (!includePa) return native;
  return pa === null ? null : native + pa;
}

/**
 * The same over the wire's exact amounts (decimal strings), in base units, for a figure that keeps every digit
 * (`Amount`, `formatFlux`).
 */
export function earnedSats(
  native: string | null | undefined,
  pa: string | null | undefined,
  includePa: boolean,
): bigint | null {
  const n = parseFlux(native);
  if (n === null) return null;
  if (!includePa) return n;
  const p = parseFlux(pa);
  return p === null ? null : n + p;
}

/** The marker's words. */
export const BASIS_LABEL: Record<EarningsBasis, string> = {
  all: 'Main chain + parallel assets',
  main: 'Main chain only',
};

/** The same in a sentence or a caption ("12.40 FLUX a day, main chain + parallel assets"). */
export const BASIS_PHRASE: Record<EarningsBasis, string> = {
  all: 'main chain + parallel assets',
  main: 'main chain only',
};

/** The rule, in one sentence. */
export const PA_RULE =
  'Each FLUX a node earns on the Flux main chain accrues as much again across 10 parallel-asset chains (10% on each), claimable through Flux Fusion.';

/** What the marker says each basis means, after the rule. */
export const BASIS_TEXT: Record<EarningsBasis, string> = {
  all: 'These figures count both, the parallel assets at the FLUX price.',
  main: 'These figures count the main chain only, as you chose. The parallel assets still accrue.',
};

/** Said beside realized figures: the parallel assets of a past payment were never paid on the main chain. */
export const REALIZED_TEXT =
  'Parallel assets are accrued, not received: they are claimed through Flux Fusion and never arrive on the main chain with the payment.';

/** Said beside a single payment's amount, which is a main-chain transaction whatever the preference. */
export const PAYMENT_TEXT =
  'Each amount is a payment on the Flux main chain. Its parallel assets accrue beside it, as much again, claimable through Flux Fusion, and count in the earnings figures.';
