// Dollar figures for the price chip and its card.

const USD_SMALL = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const USD_WHOLE = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** A price: four decimals under a dollar (`$0.0746`), two above (`$1.24`). */
export const formatPrice = (usd: number): string => (usd < 1 ? USD_SMALL : USD).format(usd);

/** A whole-dollar figure (market cap, volume): `$12,345,678`. */
export const formatUsd = (usd: number): string => USD_WHOLE.format(usd);
