// Realized earnings as columns for the charts and the exports: the days stacked by tier, the parallel assets
// estimated alongside, each day valued at its own price, and the expected-against-received read. Pure
// functions over the wallet's days.

import type { CurrencyCode, EarningsDay, PaClaim, PricePoint, PricesDto, WalletEarnings } from '../types';
import { type CsvCell, dateStamp, dateTimeStamp } from './csv';
import { DAY_MS, flux, historicPrice } from './money';

/**
 * The server keeps the payouts of the stored blocks, at most 30 days, so the ranges are short: a week, two weeks, or
 * all it has.
 */
export type EarningsRange = '7d' | '14d' | 'all';

export interface RangeOption {
  value: EarningsRange;
  label: string;
  days: number;
}

export const EARNINGS_RANGES: readonly RangeOption[] = [
  { value: '7d', label: '7 days', days: 7 },
  { value: '14d', label: '14 days', days: 14 },
  { value: 'all', label: 'All', days: Number.POSITIVE_INFINITY },
];

export const isEarningsRange = (v: unknown): v is EarningsRange => v === '7d' || v === '14d' || v === 'all';

/** The newest `n` days (`all` keeps them all). */
export function sliceDays(days: readonly EarningsDay[], range: EarningsRange): EarningsDay[] {
  const n = EARNINGS_RANGES.find((r) => r.value === range)?.days ?? Number.POSITIVE_INFINITY;
  return Number.isFinite(n) ? days.slice(-n) : [...days];
}

/** The ranges worth offering for `count` days of data: one as long as the data adds nothing over All. */
export function rangesFor(count: number): readonly RangeOption[] {
  return EARNINGS_RANGES.filter((r) => r.value === 'all' || count > r.days);
}

/** The chosen range, or All when the data is too short to offer it (a restarted server holds only a few days). */
export function effectiveRange(range: EarningsRange, count: number): EarningsRange {
  return rangesFor(count).some((r) => r.value === range) ? range : 'all';
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
  /** The first day is only partly covered: the stored blocks begin part way through it. */
  partialFirst: boolean;
}

export interface DailyInput {
  days: readonly EarningsDay[];
  /** When the first stored block the figures cover happened (`WalletEarnings.covered_from_ms`). */
  coveredFromMs: number | null;
  ratio: number;
  history: readonly PricePoint[];
  spot: PricesDto['spot'] | null | undefined;
  currency: CurrencyCode;
  nowMs: number;
}

/** A window that begins less than this far into its first day covers that day for every practical purpose. */
export const PARTIAL_FIRST_MS = 3_600_000;

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
    partialFirst: false,
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
  const first = out.t[0];
  const last = out.t[out.t.length - 1];
  out.partialLast = last !== undefined && i.nowMs - last < DAY_MS && i.nowMs >= last;
  out.partialFirst =
    first !== undefined &&
    i.coveredFromMs !== null &&
    i.coveredFromMs - first >= PARTIAL_FIRST_MS &&
    i.coveredFromMs - first < DAY_MS;
  return out;
}

/** Whether day `i` is a whole day: the window's first day and the running one are not. */
export function isCompleteDay(d: Pick<Daily, 't' | 'partialFirst' | 'partialLast'>, i: number): boolean {
  return !(d.partialFirst && i === 0) && !(d.partialLast && i === d.t.length - 1);
}

/**
 * The days that are whole: the window's first day is left out when the stored blocks begin part way through it, and the
 * last when it has not ended. For the figures that compare days (an average, a week against the week before).
 */
export function wholeDays<T extends { day_ms: number }>(
  days: readonly T[],
  coveredFromMs: number | null,
  nowMs: number,
): T[] {
  if (days.length === 0) return [];
  const first = (days[0] as T).day_ms;
  const last = (days[days.length - 1] as T).day_ms;
  const dropFirst =
    coveredFromMs !== null && coveredFromMs - first >= PARTIAL_FIRST_MS && coveredFromMs - first < DAY_MS;
  const dropLast = nowMs - last < DAY_MS && nowMs >= last;
  // One partial day alone leaves nothing; two partial days at the ends of a two-day window leave nothing either.
  const from = dropFirst ? 1 : 0;
  const to = dropLast ? days.length - 1 : days.length;
  return from < to ? days.slice(from, to) : [];
}

export interface DailyTotals {
  native: number;
  pa: number;
  payments: number;
  /** Over the days with a price; null with none. */
  value: number | null;
  /** Native FLUX per whole day; null while there is no whole day to average. */
  average: number | null;
  /** The best whole day; null while there is none. */
  best: { t: number; native: number } | null;
  /** How many whole days the average and the best day are over. */
  completeDays: number;
}

/**
 * Totals over the days shown. The totals count every payment received; the average and the best day count whole
 * days only, because the window's first day starts part way through and the running day has not ended, and either
 * would drag the average down.
 */
export function totalsOf(d: Daily): DailyTotals {
  let native = 0;
  let pa = 0;
  let payments = 0;
  let value = 0;
  let valued = false;
  let completeNative = 0;
  let completeDays = 0;
  let best: DailyTotals['best'] = null;
  d.t.forEach((t, i) => {
    const n = d.native[i] as number;
    native += n;
    pa += d.pa[i] as number;
    payments += d.payments[i] as number;
    const v = d.value[i];
    if (v !== null && v !== undefined) {
      value += v;
      valued = true;
    }
    if (!isCompleteDay(d, i)) return;
    completeNative += n;
    completeDays++;
    if (best === null || n > best.native) best = { t, native: n };
  });
  return {
    native,
    pa,
    payments,
    value: valued ? value : null,
    average: completeDays > 0 ? completeNative / completeDays : null,
    best,
    completeDays,
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
  history: readonly PricePoint[],
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
    'partial_day',
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
      !isCompleteDay(d, i),
    ];
  });
  return { header, rows };
}

const round = (v: number, places = 8): number => Math.round(v * 10 ** places) / 10 ** places;

/**
 * The claims export: one row per claim, newest first as the server gives them. A claim-all is paid on the Flux main
 * chain, so its row carries that transaction id too (`main_chain_txid`), empty for a claim on one chain.
 */
export function claimsCsv(claims: readonly PaClaim[]): { header: string[]; rows: CsvCell[][] } {
  return {
    header: [
      'time_utc',
      'chain',
      'amount_flux',
      'fee_flux',
      'transaction',
      'main_chain_txid',
      'to_address',
      'explorer_url',
    ],
    rows: claims.map((c) => [
      c.time_ms === null ? null : dateTimeStamp(c.time_ms),
      c.chain,
      c.amount,
      c.fee,
      c.txid,
      c.main_txid,
      c.to,
      c.explorer_url,
    ]),
  };
}
