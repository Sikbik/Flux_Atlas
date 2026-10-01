// Payment history arithmetic: per-day sums for the payout bars and window totals for the tiles. Days
// before our first ingest are unobserved (null), never zero.

const DAY_MS = 86_400_000;

export interface PaymentLike {
  time_ms: number;
  amount: string;
}

export interface PayDay {
  dayMs: number;
  /** FLUX paid that UTC day, null when the day was not observed. */
  flux: number | null;
  count: number;
}

/** One entry per UTC day, oldest first, the last being today. */
export function paymentDays(
  payments: readonly PaymentLike[],
  opts: { nowMs: number; days: number; firstMs: number | null; toFlux: (amount: string) => number | null },
): PayDay[] {
  const today = Math.floor(opts.nowMs / DAY_MS) * DAY_MS;
  const out: PayDay[] = [];
  for (let k = opts.days - 1; k >= 0; k--) {
    const dayMs = today - k * DAY_MS;
    const observed = opts.firstMs !== null && opts.firstMs < dayMs + DAY_MS;
    out.push({ dayMs, flux: observed ? 0 : null, count: 0 });
  }
  const origin = out[0]?.dayMs ?? today;
  for (const p of payments) {
    if (p.time_ms < origin || p.time_ms >= today + DAY_MS) continue;
    const i = Math.floor((p.time_ms - origin) / DAY_MS);
    const cell = out[i];
    if (!cell) continue;
    cell.count++;
    cell.flux = (cell.flux ?? 0) + (opts.toFlux(p.amount) ?? 0);
  }
  return out;
}

export interface WindowTotals {
  count: number;
  flux: number;
  /** True when the history covers the whole window; false when it began inside it. */
  complete: boolean;
}

/** Payments inside the trailing window, and whether the history reaches back that far. */
export function windowTotals(
  payments: readonly PaymentLike[],
  opts: {
    nowMs: number;
    windowMs: number;
    firstMs: number | null;
    toFlux: (amount: string) => number | null;
  },
): WindowTotals {
  const from = opts.nowMs - opts.windowMs;
  let count = 0;
  let flux = 0;
  for (const p of payments) {
    if (p.time_ms < from) continue;
    count++;
    flux += opts.toFlux(p.amount) ?? 0;
  }
  return { count, flux, complete: opts.firstMs !== null && opts.firstMs <= from };
}
