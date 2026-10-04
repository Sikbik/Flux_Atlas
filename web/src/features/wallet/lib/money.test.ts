import { describe, expect, it } from 'vitest';
import type { PricePoint, PricesDto } from '../types';
import {
  convertMoney,
  DAY_MS,
  flux,
  fluxOrNull,
  formatMoney,
  formatPrice,
  historicPrice,
  isCurrency,
  priceOf,
  priceOnDay,
  toMoney,
} from './money';

const spot: PricesDto['spot'] = {
  usd: 0.0747,
  eur: 0.0687,
  gbp: 0.059,
  aud: 0.1135,
  cad: 0.1023,
  chf: 0.0657,
  jpy: 11.2,
  cny: 0.538,
  inr: 6.2,
  krw: 99.3,
  sgd: 0.1001,
  hkd: 0.5826,
  thb: 2.69,
  myr: 0.351,
  idr: 1180,
  btc: 0.00000088,
};

const history = (n: number, start = 1_700_000_000_000): PricePoint[] =>
  Array.from({ length: n }, (_, i) => ({
    day_ms: Math.floor(start / DAY_MS) * DAY_MS + i * DAY_MS,
    usd: 0.05 + i * 0.001,
  }));

describe('flux', () => {
  it('reads wire amounts and treats nothing as zero only where asked', () => {
    expect(flux('9.00000000')).toBe(9);
    expect(flux('10182875.18750000')).toBeCloseTo(10182875.1875, 4);
    expect(flux(null)).toBe(0);
    expect(fluxOrNull(null)).toBeNull();
    expect(fluxOrNull('0.50000000')).toBe(0.5);
  });
});

describe('formatMoney', () => {
  it('formats fiat with its own symbol and digits', () => {
    expect(formatMoney(1234.5, 'usd')).toBe('$1,234.50');
    expect(formatMoney(1234.5, 'eur')).toBe('€1,234.50');
    expect(formatMoney(1234, 'jpy')).toBe('¥1,234');
    expect(formatMoney(1234567, 'krw')).toBe('₩1,234,567');
  });

  it('keeps the dollar-like currencies apart', () => {
    expect(formatMoney(10, 'aud')).toBe('A$10.00');
    expect(formatMoney(10, 'cad')).toBe('CA$10.00');
    expect(formatMoney(10, 'hkd')).toBe('HK$10.00');
  });

  it('compacts large headline figures and leaves small ones exact', () => {
    expect(formatMoney(13_715_000, 'usd', { compact: true })).toBe('$13.7M');
    expect(formatMoney(12.34, 'usd', { compact: true })).toBe('$12.34');
    expect(formatMoney(2_345, 'usd', { compact: true })).toBe('$2.3K');
  });

  it('writes bitcoin with trimmed places', () => {
    expect(formatMoney(0.00123456, 'btc')).toBe('0.00123456 BTC');
    expect(formatMoney(0.5, 'btc')).toBe('0.50 BTC');
    expect(formatMoney(2.5, 'btc')).toBe('2.50 BTC');
  });

  it('says Unknown for nothing and for not-a-number', () => {
    expect(formatMoney(null, 'usd')).toBe('Unknown');
    expect(formatMoney(undefined, 'usd')).toBe('Unknown');
    expect(formatMoney(Number.NaN, 'usd')).toBe('Unknown');
  });

  it('shows zero as zero', () => {
    expect(formatMoney(0, 'usd')).toBe('$0.00');
  });
});

describe('formatPrice', () => {
  it('keeps enough digits for a price under a dollar', () => {
    expect(formatPrice(0.0747, 'usd')).toBe('$0.0747');
    expect(formatPrice(0.00412, 'usd')).toBe('$0.00412');
    expect(formatPrice(1.234, 'eur')).toBe('€1.234');
    // The space after a currency code is a no-break space, so a figure never wraps from its code.
    expect(formatPrice(1180, 'idr')).toBe('IDR 1,180');
  });
});

describe('priceOf and conversions', () => {
  it('reads a price and refuses a missing or zero one', () => {
    expect(priceOf(spot, 'usd')).toBe(0.0747);
    expect(priceOf(null, 'usd')).toBeNull();
    expect(priceOf({ ...spot, eur: 0 }, 'eur')).toBeNull();
  });

  it('values FLUX at a price, or says it cannot', () => {
    expect(toMoney(100, 0.0747)).toBeCloseTo(7.47, 6);
    expect(toMoney(100, null)).toBeNull();
  });

  it('moves money between currencies through FLUX', () => {
    // $10 buys 10 / 0.0747 FLUX, which is worth 0.0687 each in euros.
    expect(convertMoney(10, 'usd', 'eur', spot)).toBeCloseTo((10 / 0.0747) * 0.0687, 8);
    expect(convertMoney(10, 'usd', 'usd', spot)).toBe(10);
    expect(convertMoney(10, 'usd', 'eur', null)).toBeNull();
  });
});

describe('priceOnDay', () => {
  const h = history(10);
  it('finds the day itself, however late in it', () => {
    expect(priceOnDay(h, (h[3] as PricePoint).day_ms + 17 * 3_600_000)).toBe((h[3] as PricePoint).usd);
  });

  it('uses the nearest earlier day for a gap, and the ends for a day outside', () => {
    const gapped = [h[0], h[2], h[5]] as PricePoint[];
    expect(priceOnDay(gapped, (h[3] as PricePoint).day_ms)).toBe((h[2] as PricePoint).usd);
    expect(priceOnDay(h, (h[0] as PricePoint).day_ms - 40 * DAY_MS)).toBe((h[0] as PricePoint).usd);
    expect(priceOnDay(h, (h[9] as PricePoint).day_ms + 40 * DAY_MS)).toBe((h[9] as PricePoint).usd);
  });

  it('has no price for no history', () => {
    expect(priceOnDay([], 1_700_000_000_000)).toBeNull();
  });
});

describe('historicPrice', () => {
  const h = history(10);
  const ms = (h[4] as PricePoint).day_ms + 1000;
  it('is exact in dollars', () => {
    expect(historicPrice(h, spot, 'usd', ms)).toEqual({
      price: (h[4] as PricePoint).usd,
      approximate: false,
    });
  });

  it("is the dollar price at today's exchange rate in any other currency, and says so", () => {
    const r = historicPrice(h, spot, 'eur', ms);
    expect(r?.approximate).toBe(true);
    expect(r?.price).toBeCloseTo(((h[4] as PricePoint).usd * 0.0687) / 0.0747, 10);
  });

  it('gives nothing without the rates', () => {
    expect(historicPrice(h, null, 'eur', ms)).toBeNull();
    expect(historicPrice([], spot, 'usd', ms)).toBeNull();
  });
});

describe('isCurrency', () => {
  it('knows the sixteen', () => {
    expect(isCurrency('usd')).toBe(true);
    expect(isCurrency('btc')).toBe(true);
    expect(isCurrency('xyz')).toBe(false);
    expect(isCurrency(3)).toBe(false);
  });
});
