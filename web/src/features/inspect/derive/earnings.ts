// What a fleet earned in the last 24 hours, 7 days and 30 days. Two sources: a sum of the nodes' own
// payments (exact), or the operator totals the server keeps for 24 hours and 30 days, from which the
// week is scaled when no better figure exists (an estimate, and labelled as one). Windows longer than
// our own ledger say so: the history began at our first ingest, so an unobserved day is not a zero.
// Both count on the viewer's basis: the main chain, plus the parallel assets it accrued when they count.

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
  o: {
    nowMs: number;
    firstMs: number | null;
    toFlux: (amount: string) => number | null;
    includePa?: boolean;
  },
): Earnings {
  const win = (windowMs: number): EarnedWindow => {
    const t = windowTotals(payments, {
      nowMs: o.nowMs,
      windowMs,
      firstMs: o.firstMs,
      toFlux: o.toFlux,
      includePa: o.includePa,
    });
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

export interface EarnTile {
  label: string;
  window: EarnedWindow;
  /** The ledger began inside this window, so the figure is everything since the first ingest. */
  cut: boolean;
  /** Stands for more than one window that all came to the same figure. */
  merged: boolean;
}

/**
 * A ledger younger than a window cuts that window short, so a young ledger gives the same figure for the day,
 * the week and the month. Windows cut short to the same figure collapse into one tile, so they are said once
 * (as "paid so far") rather than three times, which reads as a mistake.
 */
export function earningTiles(windows: readonly (readonly [string, EarnedWindow])[]): EarnTile[] {
  const tiles: EarnTile[] = [];
  for (const [label, window] of windows) {
    const cut = window.flux !== null && !window.estimate && !window.complete;
    const prev = tiles[tiles.length - 1];
    if (
      cut &&
      prev?.cut &&
      prev.window.flux !== null &&
      Math.abs(prev.window.flux - (window.flux ?? 0)) < 1e-9
    ) {
      prev.merged = true;
      continue;
    }
    tiles.push({ label, window, cut, merged: false });
  }
  return tiles;
}
