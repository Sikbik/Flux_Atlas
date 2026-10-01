// Time arithmetic for the time machine: reading the instant out of the URL, writing it back, how long
// ago an instant was in words, which playback speeds make sense for a span, and how coarse the curve
// under the scrubber should be. Pure functions, all in UTC and unix milliseconds.

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** The earliest unix millisecond value read as milliseconds rather than seconds (2001-09-09). */
const MS_FLOOR = 1e12;
/** The earliest unix seconds value accepted (1973); below this a bare number is not an instant. */
const S_FLOOR = 1e8;

const HAS_ZONE = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

/**
 * An instant from the URL: ISO 8601 (`2026-09-26T08:00Z`, with or without seconds, a space allowed
 * for the `T`), or unix milliseconds, or unix seconds. A time without a zone is UTC, never local.
 * Returns null for anything else.
 */
export function parseInstant(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return fromNumber(v);
  const s = v.trim();
  if (s === '') return null;
  if (/^\d+(\.\d+)?$/.test(s)) return fromNumber(Number(s));
  let iso = s.replace(' ', 'T');
  // A date alone is UTC midnight by the standard; a time without a zone would be local, so name it.
  if (iso.includes('T') && !HAS_ZONE.test(iso)) iso += 'Z';
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function fromNumber(n: number): number | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= MS_FLOOR) return Math.round(n);
  if (n >= S_FLOOR) return Math.round(n * 1000);
  return null;
}

/** The URL form of an instant: `2026-09-26T08:00:00Z` (seconds, no fraction). */
export function toUrlInstant(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 19)}Z`;
}

/** The chip form of an instant with seconds: `2026-09-26 08:00:12 UTC`. */
export function formatInstantSeconds(ms: number): string {
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

/** `2026-09-26 08:00 UTC`, the form the strip's handle carries. */
export function formatInstantMinutes(ms: number): string {
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

interface Parts {
  d: number;
  h: number;
  m: number;
  s: number;
}

function split(ms: number): Parts {
  const t = Math.max(0, Math.round(ms / SECOND));
  return {
    d: Math.floor(t / 86400),
    h: Math.floor((t % 86400) / 3600),
    m: Math.floor((t % 3600) / 60),
    s: t % 60,
  };
}

/**
 * How long before now an instant was, short, two units at most: `40 s`, `12 min`, `3 h 12 min`,
 * `4 d 11 h`. The caller appends "ago". Under a second reads `0 s`.
 */
export function ageShort(ms: number): string {
  const { d, h, m, s } = split(ms);
  if (d > 0) return h > 0 ? `${d} d ${h} h` : `${d} d`;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  if (m > 0) return `${m} min`;
  return `${s} s`;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The same age in words for a screen reader: `4 days 11 hours`, `3 hours 12 minutes`, `40 seconds`. */
export function ageLong(ms: number): string {
  const { d, h, m, s } = split(ms);
  if (d > 0) return h > 0 ? `${plural(d, 'day')} ${plural(h, 'hour')}` : plural(d, 'day');
  if (h > 0) return m > 0 ? `${plural(h, 'hour')} ${plural(m, 'minute')}` : plural(h, 'hour');
  if (m > 0) return plural(m, 'minute');
  return plural(s, 'second');
}

/** Playback speeds in recorded seconds per real second, offered for a recorded span. */
export const ALL_SPEEDS = [1, 10, 60, 600, 3600, 21600] as const;

/**
 * The speeds worth offering: at least x1, x10, x60 and x600, and faster ones only when the span is
 * long enough that x600 would still take many minutes to cross it.
 */
export function speedsFor(spanMs: number): readonly number[] {
  const base: number[] = [1, 10, 60, 600];
  if (spanMs >= 2 * DAY) base.push(3600);
  if (spanMs >= 10 * DAY) base.push(21600);
  return base;
}

/** The speed nearest to `want` in `speeds` (a URL may carry any number). */
export function nearestSpeed(want: number | undefined, speeds: readonly number[], fallback = 60): number {
  const target = want !== undefined && Number.isFinite(want) && want > 0 ? want : fallback;
  let best = speeds[0] ?? fallback;
  for (const s of speeds) if (Math.abs(Math.log(s / target)) < Math.abs(Math.log(best / target))) best = s;
  return best;
}

/**
 * The `/metrics` step for a curve over `spanMs`: the finest the server offers that keeps the curve
 * to about 400 points or fewer (one point per pixel is plenty for a 76 px strip).
 */
export function stepFor(spanMs: number): { param: string; ms: number } {
  const steps: readonly { param: string; ms: number }[] = [
    { param: '1m', ms: MINUTE },
    { param: '5m', ms: 5 * MINUTE },
    { param: '15m', ms: 15 * MINUTE },
    { param: '30m', ms: 30 * MINUTE },
    { param: '1h', ms: HOUR },
    { param: '3h', ms: 3 * HOUR },
    { param: '6h', ms: 6 * HOUR },
    { param: '12h', ms: 12 * HOUR },
    { param: '1d', ms: DAY },
  ];
  for (const s of steps) if (spanMs / s.ms <= 400) return s;
  return steps[steps.length - 1]!;
}

/** How far a keyboard key moves the playhead: Arrow a minute, Shift+Arrow an hour, Page a day. */
export const KEY_STEP = { arrow: MINUTE, shift: HOUR, page: DAY } as const;

/** Keeps `t` inside `[lo, hi]`. */
export const clampTime = (t: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, t));

/** Where `t` sits between `start` and `end`, 0 to 1 (clamped); 1 for an empty span. */
export function fractionOf(t: number, start: number, end: number): number {
  if (end <= start) return 1;
  return Math.min(1, Math.max(0, (t - start) / (end - start)));
}

/** The instant at `fraction` between `start` and `end`. */
export const instantAt = (fraction: number, start: number, end: number): number =>
  start + Math.min(1, Math.max(0, fraction)) * (end - start);
