// What a fleet earned in the last 24 hours, 7 days and 30 days. Two sources: a sum of the nodes' own
// payments (exact), or the operator totals the server keeps for 24 hours and 30 days, from which the
// week is scaled when no better figure exists (an estimate, and labelled as one). Windows longer than
// our own ledger say so: the history began at our first ingest, so an unobserved day is not a zero.

import { type PaymentLike, windowTotals } from './payments';

const DAY_MS = 86_400_000;

export interface EarnedWindow {
  /** FLUX earned in the window; null when it cannot be known. */
  flux: number | null;
  /** The ledger reaches back across the whole window (false when it began inside it). */
  complete: boolean;
  /** Scaled from a longer window rather than summed from payments. */
  estimate: boolean;
}

export interface Earnings {
  h24: EarnedWindow;
  d7: EarnedWindow;
  d30: EarnedWindow;
}

const UNKNOWN: EarnedWindow = { flux: null, complete: false, estimate: false };
export const NO_EARNINGS: Earnings = { h24: UNKNOWN, d7: UNKNOWN, d30: UNKNOWN };

const covers = (firstMs: number | null, nowMs: number, windowMs: number) =>
  firstMs !== null && firstMs <= nowMs - windowMs;

/** Exact windows from payments (every node of the fleet, newest 30 days at least). */
export function earningsFromPayments(
  payments: readonly PaymentLike[],
  o: { nowMs: number; firstMs: number | null; toFlux: (amount: string) => number | null },
): Earnings {
  const win = (windowMs: number): EarnedWindow => {
    const t = windowTotals(payments, { nowMs: o.nowMs, windowMs, firstMs: o.firstMs, toFlux: o.toFlux });
    return { flux: t.flux, complete: t.complete, estimate: false };
  };
  return { h24: win(DAY_MS), d7: win(7 * DAY_MS), d30: win(30 * DAY_MS) };
}

/**
 * Windows from the operator's server totals. The week is exact when `d7` is given; otherwise it is the
 * 30 day total (when the whole ledger sits inside the week) or the 30 day rate scaled to seven days.
 */
export function earningsFromTotals(o: {
  h24: number | null;
  d30: number | null;
  d7?: number | null;
  nowMs: number;
  firstMs: number | null;
}): Earnings {
  const { nowMs, firstMs } = o;
  const h24: EarnedWindow =
    o.h24 === null ? UNKNOWN : { flux: o.h24, complete: covers(firstMs, nowMs, DAY_MS), estimate: false };
  const d30: EarnedWindow =
    o.d30 === null
      ? UNKNOWN
      : { flux: o.d30, complete: covers(firstMs, nowMs, 30 * DAY_MS), estimate: false };

  let d7: EarnedWindow = UNKNOWN;
  if (o.d7 !== undefined && o.d7 !== null) {
    d7 = { flux: o.d7, complete: covers(firstMs, nowMs, 7 * DAY_MS), estimate: false };
  } else if (o.d30 !== null && firstMs !== null) {
    const seen = Math.max(0, nowMs - firstMs);
    if (seen <= 7 * DAY_MS) {
      // Everything we have ever seen lies inside the week, so the 30 day total is the week's total.
      d7 = { flux: o.d30, complete: false, estimate: false };
    } else {
      d7 = { flux: (o.d30 * 7 * DAY_MS) / Math.min(seen, 30 * DAY_MS), complete: true, estimate: true };
    }
  }
  return { h24, d7, d30 };
}

/** The window's label for a tile: names the window, and says "since first ingest" when it is cut short. */
export function windowLabel(name: string, w: EarnedWindow): string {
  return w.complete || w.flux === null ? name : `${name}, since first ingest`;
}
