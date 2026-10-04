// FLUX amounts as numbers, and money in the viewer's currency. Pure functions, no DOM, no React.
//
// A price is "one FLUX in this currency" (`PricesDto.spot`). A value in FLUX becomes money by multiplying with
// the price; money in one currency becomes money in another through FLUX, so a price scenario and a hosting
// cost keep their meaning when the viewer changes currency. History is known in dollars only: the other
// currencies are drawn from it at today's exchange rate, and every place that does that says it is approximate.

import { fluxToNumber, UNKNOWN } from '../../../lib/format';
import { CURRENCIES, type CurrencyCode, type PricePoint, type PricesDto } from '../types';

export const DAY_MS = 86_400_000;
/** The average month, in days: 365.25 / 12. Run-rate figures per month use it. */
export const MONTH_DAYS = 30.4375;
export const YEAR_DAYS = 365;

type Nullable<T> = T | null | undefined;

/** A FLUX amount string as a number; 0 for nothing (use `fluxOrNull` where "unknown" matters). */
export function flux(amount: Nullable<string | number>): number {
  return fluxToNumber(amount) ?? 0;
}

export function fluxOrNull(amount: Nullable<string | number>): number | null {
  return fluxToNumber(amount);
}

// ---- currencies -----------------------------------------------------------------------------------

export interface CurrencyMeta {
  code: CurrencyCode;
  /** The short label in a selector and beside a figure (`USD`). */
  label: string;
  name: string;
  /** Digits after the point in a total (JPY, KRW and IDR have none). */
  digits: number;
}

export const CURRENCY_META: Record<CurrencyCode, CurrencyMeta> = {
  usd: { code: 'usd', label: 'USD', name: 'US dollar', digits: 2 },
  eur: { code: 'eur', label: 'EUR', name: 'Euro', digits: 2 },
  gbp: { code: 'gbp', label: 'GBP', name: 'British pound', digits: 2 },
  aud: { code: 'aud', label: 'AUD', name: 'Australian dollar', digits: 2 },
  cad: { code: 'cad', label: 'CAD', name: 'Canadian dollar', digits: 2 },
  chf: { code: 'chf', label: 'CHF', name: 'Swiss franc', digits: 2 },
  jpy: { code: 'jpy', label: 'JPY', name: 'Japanese yen', digits: 0 },
  cny: { code: 'cny', label: 'CNY', name: 'Chinese yuan', digits: 2 },
  inr: { code: 'inr', label: 'INR', name: 'Indian rupee', digits: 2 },
  krw: { code: 'krw', label: 'KRW', name: 'South Korean won', digits: 0 },
  sgd: { code: 'sgd', label: 'SGD', name: 'Singapore dollar', digits: 2 },
  hkd: { code: 'hkd', label: 'HKD', name: 'Hong Kong dollar', digits: 2 },
  thb: { code: 'thb', label: 'THB', name: 'Thai baht', digits: 2 },
  myr: { code: 'myr', label: 'MYR', name: 'Malaysian ringgit', digits: 2 },
  idr: { code: 'idr', label: 'IDR', name: 'Indonesian rupiah', digits: 0 },
  btc: { code: 'btc', label: 'BTC', name: 'Bitcoin', digits: 8 },
};

export const DEFAULT_CURRENCY: CurrencyCode = 'usd';

export function isCurrency(v: unknown): v is CurrencyCode {
  return typeof v === 'string' && (CURRENCIES as readonly string[]).includes(v);
}

const fiatFormats = new Map<string, Intl.NumberFormat>();

function fiat(code: CurrencyCode, digits: number, compact: boolean): Intl.NumberFormat {
  const key = `${code}:${digits}:${compact}`;
  let f = fiatFormats.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code.toUpperCase(),
      currencyDisplay: 'symbol',
      minimumFractionDigits: compact ? 0 : digits,
      maximumFractionDigits: compact ? Math.min(1, digits) : digits,
      ...(compact ? { notation: 'compact' as const } : null),
    });
    fiatFormats.set(key, f);
  }
  return f;
}

/** Bitcoin: eight places with the trailing zeros trimmed, never fewer than two. */
function formatBtc(v: number, compact: boolean): string {
  const abs = Math.abs(v);
  if (compact && abs >= 1000) return `${(v / 1000).toFixed(1)}K BTC`;
  if (abs >= 100) return `${v.toFixed(2)} BTC`;
  const trimmed = v.toFixed(8).replace(/0+$/, '');
  const [whole = '0', frac = ''] = trimmed.split('.');
  return `${whole}.${frac.padEnd(2, '0')} BTC`;
}

export interface MoneyOptions {
  /** `$1.2M` for a headline: compact for large figures, exact for small ones. */
  compact?: boolean;
  /** Override the currency's usual digits (a price per FLUX needs more). */
  digits?: number;
}

/** Money in a currency: `$1,234.56`, `EUR 1.2K`, `0.00123 BTC`. Unknown is the word, never zero. */
export function formatMoney(value: Nullable<number>, code: CurrencyCode, opts: MoneyOptions = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return UNKNOWN;
  if (code === 'btc') return formatBtc(value, opts.compact === true);
  const meta = CURRENCY_META[code];
  const digits = opts.digits ?? meta.digits;
  // A compact figure keeps its cents under a thousand: $12.34 reads better than $12.
  const compact = opts.compact === true && Math.abs(value) >= 1000;
  return fiat(code, digits, compact).format(value);
}

/**
 * The price of one FLUX, with enough digits to mean something: `$0.0747`, not `$0.07`. A currency with no
 * cents (yen, won, rupiah) keeps cents here only while the price is small.
 */
export function formatPrice(value: Nullable<number>, code: CurrencyCode): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return UNKNOWN;
  if (code === 'btc') return `${value.toFixed(value < 1e-4 ? 9 : 8).replace(/0+$/, '')} BTC`;
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 2 : abs >= 1 ? 3 : abs >= 0.1 ? 4 : abs >= 0.01 ? 4 : 5;
  return fiat(code, digits, false).format(value);
}

/** The price of one FLUX in `code`, or null when the prices are missing or the currency is absent. */
export function priceOf(spot: Nullable<PricesDto['spot']>, code: CurrencyCode): number | null {
  const v = spot?.[code];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/** FLUX as money at a price (one FLUX in the currency); null without a price. */
export function toMoney(fluxAmount: number, price: Nullable<number>): number | null {
  return price === null || price === undefined ? null : fluxAmount * price;
}

/**
 * Money in one currency as money in another, through FLUX: both prices are "one FLUX in that currency", so
 * `value / priceFrom` is the FLUX it buys and `x priceTo` is what that FLUX is worth in the other. Null when
 * either price is missing.
 */
export function convertMoney(
  value: number,
  from: CurrencyCode,
  to: CurrencyCode,
  spot: Nullable<PricesDto['spot']>,
): number | null {
  if (from === to) return value;
  const a = priceOf(spot, from);
  const b = priceOf(spot, to);
  return a === null || b === null ? null : (value / a) * b;
}

// ---- price history --------------------------------------------------------------------------------

/**
 * The dollar price on the UTC day that contains `ms`: the day's own entry, else the nearest earlier one, else (a
 * day before the history begins) the first. Null for an empty history. `history` is oldest first.
 */
export function priceOnDay(history: readonly PricePoint[], ms: number): number | null {
  const n = history.length;
  if (n === 0) return null;
  const day = Math.floor(ms / DAY_MS) * DAY_MS;
  let lo = 0;
  let hi = n - 1;
  if (day <= (history[0] as PricePoint).day_ms) return (history[0] as PricePoint).usd;
  if (day >= (history[hi] as PricePoint).day_ms) return (history[hi] as PricePoint).usd;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((history[mid] as PricePoint).day_ms <= day) lo = mid;
    else hi = mid - 1;
  }
  return (history[lo] as PricePoint).usd;
}

/**
 * A day's price in `code`. Only dollars are recorded: any other currency is the dollar price at today's exchange
 * rate (`spot[code] / spot.usd`), so it is approximate, and `approximate` says so for the caption.
 */
export function historicPrice(
  history: readonly PricePoint[],
  spot: Nullable<PricesDto['spot']>,
  code: CurrencyCode,
  ms: number,
): { price: number; approximate: boolean } | null {
  const usd = priceOnDay(history, ms);
  if (usd === null) return null;
  if (code === 'usd') return { price: usd, approximate: false };
  const to = priceOf(spot, code);
  const base = priceOf(spot, 'usd');
  if (to === null || base === null) return null;
  return { price: (usd * to) / base, approximate: true };
}
