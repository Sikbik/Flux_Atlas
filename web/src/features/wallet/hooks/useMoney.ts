// Money in the viewer's currency: the chosen currency, today's price of one FLUX in it, and the helpers that turn
// FLUX into a figure. The prices are their own query; while they load, or when they fail, every money figure is the
// word "Unknown" (never a zero), and the FLUX figures beside them carry on.
//
// The viewer's choice is kept as they made it. When the prices do not quote it right now (the server quotes only
// dollars and bitcoin when CoinGecko has never answered) the page shows dollars instead and says so, and the choice
// comes back by itself when the prices do.

import { useMemo } from 'react';
import { displayCurrency, formatMoney, formatPrice, priceOf, quotedCurrencies, toMoney } from '../lib/money';
import { useWalletPrefs } from '../prefs';
import type { CurrencyCode, PricePoint, PricesDto } from '../types';
import { usePrices } from './useWallet';

export interface Money {
  /** The currency money is shown in: the viewer's choice, or dollars while the choice is not quoted. */
  currency: CurrencyCode;
  /** What the viewer chose (it differs from `currency` only while `fellBack`). */
  preferred: CurrencyCode;
  fellBack: boolean;
  /** The currencies the prices quote now (empty while they are unknown). */
  available: readonly CurrencyCode[];
  setCurrency: (c: CurrencyCode) => void;
  /** The prices have arrived. */
  ready: boolean;
  failed: boolean;
  prices: PricesDto | undefined;
  spot: PricesDto['spot'] | undefined;
  /** One FLUX in the shown currency, or null while unknown. */
  price: number | null;
  /** The dollar history, oldest first (empty while unknown). */
  history: readonly PricePoint[];
  /** FLUX as money in the shown currency (null while unknown). */
  value: (fluxAmount: number) => number | null;
  /** FLUX as text in the shown currency: `$3,120.45`, or "Unknown". */
  text: (fluxAmount: number | null | undefined, opts?: { compact?: boolean }) => string;
  /** A money amount as text. */
  fmt: (amount: number | null | undefined, opts?: { compact?: boolean; digits?: number }) => string;
  /** One FLUX's price as text. */
  priceText: string;
  /** The 24 hour change of the price, percent. */
  change24h: number | null;
}

const NO_HISTORY: readonly PricePoint[] = [];
const NO_CURRENCIES: readonly CurrencyCode[] = [];

export function useMoney(): Money {
  const preferred = useWalletPrefs((s) => s.currency);
  const setCurrency = useWalletPrefs((s) => s.setCurrency);
  const q = usePrices();
  const prices = q.data;
  return useMemo<Money>(() => {
    const { currency, fellBack } = displayCurrency(preferred, prices?.spot);
    const price = priceOf(prices?.spot, currency);
    return {
      currency,
      preferred,
      fellBack,
      available: prices ? quotedCurrencies(prices.spot) : NO_CURRENCIES,
      setCurrency,
      ready: prices !== undefined,
      failed: q.isError && prices === undefined,
      prices,
      spot: prices?.spot,
      price,
      history: prices?.history ?? NO_HISTORY,
      value: (flux) => toMoney(flux, price),
      text: (flux, opts) =>
        flux === null || flux === undefined
          ? formatMoney(null, currency)
          : formatMoney(toMoney(flux, price), currency, opts),
      fmt: (amount, opts) => formatMoney(amount, currency, opts),
      priceText: formatPrice(price, currency),
      change24h: prices?.change_24h_pct ?? null,
    };
  }, [preferred, setCurrency, prices, q.isError]);
}
