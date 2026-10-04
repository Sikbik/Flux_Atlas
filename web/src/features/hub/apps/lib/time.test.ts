import { describe, expect, it } from 'vitest';
import { agoPhrase, approxSpan, blocksLeftText, estimateTitle, expiresSoon, inPhrase } from './time';

const S = 1000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;

describe('approxSpan', () => {
  it('rounds, and always says it is about', () => {
    expect(approxSpan(10 * S)).toBe('less than a minute');
    expect(approxSpan(44 * S)).toBe('less than a minute');
    expect(approxSpan(60 * S)).toBe('about a minute');
    expect(approxSpan(5 * M)).toBe('about 5 minutes');
    expect(approxSpan(61 * M)).toBe('about an hour');
    expect(approxSpan(3 * H + 10 * M)).toBe('about 3 hours');
    expect(approxSpan(30 * H)).toBe('about 30 hours');
    expect(approxSpan(2 * D)).toBe('about 2 days');
    expect(approxSpan(12 * D)).toBe('about 12 days');
    expect(approxSpan(70 * D)).toBe('about 2 months');
    expect(approxSpan(400 * D)).toBe('about 13 months');
    expect(approxSpan(800 * D)).toBe('about 2 years');
  });

  it('uses the singular for one of a unit', () => {
    expect(approxSpan(35 * H)).toBe('about 35 hours');
    expect(approxSpan(37 * H)).toBe('about 2 days');
    expect(approxSpan(45 * D)).toBe('about a month');
    expect(approxSpan(545 * D)).toBe('about a year');
  });

  it('does not care about the sign, so a span before and after now read alike', () => {
    expect(approxSpan(-3 * H)).toBe(approxSpan(3 * H));
  });

  it('does not invent a time for a span that is not a number', () => {
    expect(approxSpan(Number.NaN)).toBe('an unknown time');
  });
});

describe('agoPhrase and inPhrase', () => {
  const now = 1_700_000_000_000;

  it('says how long ago, and how long until', () => {
    expect(agoPhrase(now - 3 * H, now)).toBe('about 3 hours ago');
    expect(inPhrase(now + 3 * D, now)).toBe('in about 3 days');
  });

  it('reads an estimate that is a little ahead of the clock as just now', () => {
    expect(agoPhrase(now + 20 * S, now)).toBe('less than a minute ago');
  });

  it('reads an expiry the estimate has already passed as the next minute, because its block is still to come', () => {
    expect(inPhrase(now - 5 * M, now)).toBe('in less than a minute');
  });
});

describe('blocksLeftText', () => {
  it('is exact and grouped', () => {
    expect(blocksLeftText(86_400)).toBe('86,400 blocks left');
    expect(blocksLeftText(1)).toBe('1 block left');
  });
});

describe('expiresSoon', () => {
  const now = 1_700_000_000_000;

  it('is an hour by default', () => {
    expect(expiresSoon(now + 0.9 * H, now)).toBe(true);
    expect(expiresSoon(now + 1.1 * H, now)).toBe(false);
  });

  it('takes a window', () => {
    expect(expiresSoon(now + 2 * D, now, 3 * D)).toBe(true);
  });
});

describe('estimateTitle', () => {
  it('names the estimate in UTC', () => {
    expect(estimateTitle(Date.UTC(2026, 9, 6, 14, 20))).toBe('Estimated 2026-10-06 14:20 UTC');
  });

  it('has none for a time that is not known', () => {
    expect(estimateTitle(null)).toBeUndefined();
  });
});
