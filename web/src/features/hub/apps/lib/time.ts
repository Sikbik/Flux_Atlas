// Time as the Apps hub says it. The block times in the app lists are estimates (the server counts back from the tip at
// 30 seconds a block), so every span here is rounded and starts with "about"; the exact figure beside it is the block
// count. Pure.

import { formatInt } from '../../../../lib/format';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const MONTH = 30.44 * DAY;
const YEAR = 365.25 * DAY;

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/**
 * A span as a person says it, rounded: `less than a minute`, `about 5 minutes`, `about an hour`, `about 3 hours`,
 * `about a day`, `about 12 days`, `about 2 months`, `about a year`. The sign is ignored; callers add "ago" or "in".
 */
export function approxSpan(ms: number): string {
  const t = Math.abs(ms);
  if (!Number.isFinite(t)) return 'an unknown time';
  if (t < 45_000) return 'less than a minute';
  if (t < 59.5 * MIN) {
    const n = Math.max(1, Math.round(t / MIN));
    return n === 1 ? 'about a minute' : `about ${n} minutes`;
  }
  if (t < 36 * HOUR) {
    const n = Math.max(1, Math.round(t / HOUR));
    return n === 1 ? 'about an hour' : `about ${n} hours`;
  }
  if (t < 45 * DAY) {
    const n = Math.max(1, Math.round(t / DAY));
    return n === 1 ? 'about a day' : `about ${n} days`;
  }
  if (t < 545 * DAY) {
    const n = Math.max(1, Math.round(t / MONTH));
    return n === 1 ? 'about a month' : `about ${n} months`;
  }
  const n = Math.max(1, Math.round(t / YEAR));
  return n === 1 ? 'about a year' : `about ${n} years`;
}

/** `about 3 hours ago`; a time at or after `nowMs` (an estimate can land a little ahead) reads as just now. */
export function agoPhrase(thenMs: number, nowMs: number): string {
  return `${approxSpan(Math.max(0, nowMs - thenMs))} ago`;
}

/** `in about 3 days`; a time that has passed by the estimate (the block is still to come) reads as the next minute. */
export function inPhrase(thenMs: number, nowMs: number): string {
  return `in ${approxSpan(Math.max(0, thenMs - nowMs))}`;
}

/** `86,400 blocks left`, `1 block left`. The block count is exact; the time it stands for is not. */
export function blocksLeftText(blocks: number): string {
  return `${formatInt(blocks)} ${plural(blocks, 'block', 'blocks')} left`;
}

/**
 * An app is about to go when its estimated expiry is within `withinMs` (an hour by default). The ten that expire
 * first on a network of thousands of apps are always within hours, so a wider window would light every row.
 */
export function expiresSoon(expireMs: number, nowMs: number, withinMs = HOUR): boolean {
  return expireMs - nowMs <= withinMs;
}

/** `Estimated 2026-10-06 14:20 UTC`: the absolute time behind a "in about 3 days", for a tooltip. */
export function estimateTitle(ms: number | null): string | undefined {
  if (ms === null || !Number.isFinite(ms)) return undefined;
  const iso = new Date(ms).toISOString();
  return `Estimated ${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
