// Realized earnings as columns for the charts and the exports: the days stacked by tier, the parallel assets
// estimated alongside, each day valued at its own price, and the expected-against-received read. Pure
// functions over the wallet's days.

import type { CurrencyCode, EarningsDay, ParallelClaim, PriceDay, PricesDto, WalletEarnings } from '../types';
import { type CsvCell, dateStamp, dateTimeStamp } from './csv';
import { DAY_MS, flux, historicPrice } from './money';

export type EarningsRange = '30d' | '90d' | 'all';

export const EARNINGS_RANGES: readonly { value: EarningsRange; label: string; days: number }[] = [
  { value: '30d', label: '30 days', days: 30 },
  { value: '90d', label: '90 days', days: 90 },
  { value: 'all', label: 'All', days: Number.POSITIVE_INFINITY },
];

export const isEarningsRange = (v: unknown): v is EarningsRange => v === '30d' || v === '90d' || v === 'all';

/** The newest `n` days (`all` keeps them all). */
export function sliceDays(days: readonly EarningsDay[], range: EarningsRange): EarningsDay[] {
  const n = EARNINGS_RANGES.find((r) => r.value === range)?.days ?? Number.POSITIVE_INFINITY;
  return Number.isFinite(n) ? days.slice(-n) : [...days];
}

/**
 * The parallel assets accrue alongside every native payment, so a day's parallel assets are its native earnings
 * times the ratio of the two run-rates. Only the run-rate is known, not each day: the result is an estimate.
 */
export function parallelRatio(nativePerDay: number, paPerDay: number): number {
  if (!(nativePerDay > 0) || !(paPerDay > 0)) return 0;
  return Math.min(10, paPerDay / nativePerDay);
}

export interface Daily {
  /** Start of each UTC day. */
  t: number[];
  cumulus: number[];
  nimbus: number[];
  stratus: number[];
  /** The day's native total, as the server states it. */
  native: number[];
  /** The estimated parallel assets of the day. */
  pa: number[];
  payments: number[];
  /** The price of one FLUX on the day, in the display currency; null where there is none. */
  price: (number | null)[];
  /** The native earnings valued at that price. */
  value: (number | null)[];
  /** The native and the estimated parallel assets valued at that price. */
  valueWithPa: (number | null)[];
  /** Any price that was drawn from dollars at today's exchange rate. */
  approximate: boolean;
  /** The last day is still running. */
  partialLast: boolean;
}

export interface DailyInput {
  days: readonly EarningsDay[];
  ratio: number;
  history: readonly PriceDay[];
  spot: PricesDto['spot'] | null | undefined;
  currency: CurrencyCode;
  nowMs: number;
}

export function buildDaily(i: DailyInput): Daily {
  const out: Daily = {
    t: [],
    cumulus: [],
    nimbus: [],
    stratus: [],
    native: [],
    pa: [],
    payments: [],
    price: [],
    value: [],
    valueWithPa: [],
    approximate: false,
    partialLast: false,
  };
  for (const d of i.days) {
    const native = flux(d.native);
    const pa = native * i.ratio;
    const p = historicPrice(i.history, i.spot, i.currency, d.day_ms);
    out.t.push(d.day_ms);
    out.cumulus.push(flux(d.cumulus));
    out.nimbus.push(flux(d.nimbus));
    out.stratus.push(flux(d.stratus));
    out.native.push(native);
    out.pa.push(pa);
    out.payments.push(d.payments);
    out.price.push(p ? p.price : null);
    out.value.push(p ? native * p.price : null);
    out.valueWithPa.push(p ? (native + pa) * p.price : null);
    if (p?.approximate) out.approximate = true;
  }
  const last = out.t[out.t.length - 1];
  out.partialLast = last !== undefined && i.nowMs - last < DAY_MS && i.nowMs >= last;
  return out;
}

export interface DailyTotals {
  native: number;
  pa: number;
  payments: number;
  /** Over the days with a price; null with none. */
  value: number | null;
  /** Native FLUX per day across the days counted. */
  average: number;
  best: { t: number; native: number } | null;
}

/** Totals over the days shown. A running day is left out of the average (it would drag it down). */
export function totalsOf(d: Daily): DailyTotals {
  let native = 0;
  let pa = 0;
  let payments = 0;
  let value = 0;
  let valued = false;
  let best: DailyTotals['best'] = null;
  d.t.forEach((t, i) => {
    native += d.native[i] as number;
    pa += d.pa[i] as number;
    payments += d.payments[i] as number;
    const v = d.value[i];
    if (v !== null && v !== undefined) {
      value += v;
      valued = true;
    }
    const complete = !(d.partialLast && i === d.t.length - 1);
    if (complete && (best === null || (d.native[i] as number) > best.native))
      best = { t, native: d.native[i] as number };
  });
  const complete = d.partialLast ? d.t.length - 1 : d.t.length;
  const completeNative = d.partialLast ? native - (d.native[d.t.length - 1] ?? 0) : native;
  return {
    native,
    pa,
    payments,
    value: valued ? value : null,
    average: complete > 0 ? completeNative / complete : 0,
    best,
  };
}

// ---- expected against received --------------------------------------------------------------------

export type PaymentVerdict = 'unknown' | 'ahead' | 'on-track' | 'minor' | 'attention' | 'poor';

export interface PaymentHealth {
  expected: number;
  received: number;
  /** Received over expected; null when nothing was expected. */
  rate: number | null;
  /** What the queue owed and did not pay yet, never below zero. */
  shortfall: number;
  verdict: PaymentVerdict;
}

/** A queue pays in turn, so a little luck either way is normal: only a real shortfall is news. */
export function paymentHealth(
  e: Pick<WalletEarnings, 'expected_payments' | 'received_payments'>,
): PaymentHealth {
  const expected = Math.max(0, e.expected_payments);
  const received = Math.max(0, e.received_payments);
  const rate = expected > 0 ? received / expected : null;
  const verdict: PaymentVerdict =
    rate === null
      ? 'unknown'
      : rate > 1.02
        ? 'ahead'
        : rate >= 0.99
          ? 'on-track'
          : rate >= 0.95
            ? 'minor'
            : rate >= 0.85
              ? 'attention'
              : 'poor';
  return { expected, received, rate, shortfall: Math.max(0, expected - received), verdict };
}

export const PAYMENT_VERDICT: Record<
  PaymentVerdict,
  { label: string; tone: 'ok' | 'pending' | 'warn' | 'crit' | 'off' }
> = {
  unknown: { label: 'Not enough history', tone: 'off' },
  ahead: { label: 'Paid more than expected', tone: 'ok' },
  'on-track': { label: 'Paid as expected', tone: 'ok' },
  minor: { label: 'Slightly behind', tone: 'pending' },
  attention: { label: 'Behind expectations', tone: 'warn' },
  poor: { label: 'Well behind', tone: 'crit' },
};

export interface MissedRow {
  key: string;
  expected: number;
  received: number;
  shortfall: number;
  /** Its share of the fleet's total shortfall, 0 to 1. */
  share: number;
}

/** The nodes paid less often than expected, the biggest shortfall first. */
export function missedRows(missed: WalletEarnings['missed']): MissedRow[] {
  const rows = missed
    .map((m) => ({
      key: m.node_key,
      expected: m.expected,
      received: m.received,
      shortfall: Math.max(0, m.expected - m.received),
    }))
    .filter((m) => m.shortfall > 0)
    .sort((a, b) => b.shortfall - a.shortfall || a.key.localeCompare(b.key));
  const total = rows.reduce((s, r) => s + r.shortfall, 0);
  return rows.map((r) => ({ ...r, share: total > 0 ? r.shortfall / total : 0 }));
}

// ---- CSV ------------------------------------------------------------------------------------------

/** One header and rows for the daily earnings: FLUX by tier, and what each day was worth at its own price. */
export function dailyCsv(
  d: Daily,
  currency: CurrencyCode,
  history: readonly PriceDay[],
  spot: PricesDto['spot'] | null | undefined,
): { header: string[]; rows: CsvCell[][] } {
  const cur = currency.toUpperCase();
  const showOwn = currency !== 'usd';
  const header = [
    'date_utc',
    'native_flux',
    'cumulus_flux',
    'nimbus_flux',
    'stratus_flux',
    'payments',
    'parallel_assets_flux_estimate',
    'price_usd_that_day',
    ...(showOwn ? [`price_${cur.toLowerCase()}_that_day_approximate`] : []),
    `native_value_${cur.toLowerCase()}${showOwn ? '_approximate' : ''}`,
    `native_and_parallel_value_${cur.toLowerCase()}${showOwn ? '_approximate' : ''}`,
    'running_day',
  ];
  const rows = d.t.map((t, i): CsvCell[] => {
    const usd = historicPrice(history, spot, 'usd', t);
    return [
      dateStamp(t),
      round(d.native[i] as number),
      round(d.cumulus[i] as number),
      round(d.nimbus[i] as number),
      round(d.stratus[i] as number),
      d.payments[i] as number,
      round(d.pa[i] as number),
      usd ? usd.price : null,
      ...(showOwn ? [d.price[i] ?? null] : []),
      d.value[i] === null || d.value[i] === undefined ? null : round(d.value[i] as number, 4),
      d.valueWithPa[i] === null || d.valueWithPa[i] === undefined
        ? null
        : round(d.valueWithPa[i] as number, 4),
      d.partialLast && i === d.t.length - 1,
    ];
  });
  return { header, rows };
}

const round = (v: number, places = 8): number => Math.round(v * 10 ** places) / 10 ** places;

/** The claims export: one row per claim, newest first as the server gives them. */
export function claimsCsv(claims: readonly ParallelClaim[]): { header: string[]; rows: CsvCell[][] } {
  return {
    header: ['time_utc', 'chain', 'amount_flux', 'transaction', 'to_address', 'explorer_url'],
    rows: claims.map((c) => [
      c.time_ms === null ? null : dateTimeStamp(c.time_ms),
      c.chain,
      c.amount,
      c.txid,
      c.to,
      c.explorer_url,
    ]),
  };
}
