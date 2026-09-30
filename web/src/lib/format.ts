// Formatters shared by every view. Rules from the design system (section 5.6 number formats):
// nodes `6,724`; heights `2,996,914`; FLUX 2 decimals in summaries, 8 in transaction detail;
// hashes middle-truncated; percentages 1 decimal; bytes `3.4 KB`; bandwidth `949 Mbps`; durations
// `5d 3h`; ages `12 s ago`. Unknown is never shown as zero: nullish inputs render `fallback`.

export const UNKNOWN = 'Unknown';
/** U+2007 FIGURE SPACE: as wide as a digit in fonts with tabular figures. */
export const FIGURE_SPACE = ' ';
/** Class that switches on tabular figures (defined in global.css). */
export const TABULAR_CLASS = 'tabular';

const SATS_PER_FLUX = 100_000_000n;
const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const compactFmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

type Nullable<T> = T | null | undefined;

// ---------------------------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------------------------

/** `6724` -> `6,724`. */
export function formatInt(n: Nullable<number>, fallback = UNKNOWN): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return fallback;
  return intFmt.format(n);
}

/** Heights: `2996914` -> `2,996,914`. */
export const formatHeight = formatInt;

/** `6724` -> `6.7K`; small values stay exact. */
export function formatCompact(n: Nullable<number>, fallback = UNKNOWN): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return fallback;
  return Math.abs(n) < 10_000 ? intFmt.format(n) : compactFmt.format(n);
}

/** A fraction (0..1) as a percentage with one decimal: `0.2713` -> `27.1%`. */
export function formatPercent(fraction: Nullable<number>, decimals = 1, fallback = UNKNOWN): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return fallback;
  return `${(fraction * 100).toFixed(decimals)}%`;
}

/**
 * Pads a number to a fixed number of digit cells with figure spaces, so a live counter keeps its
 * width as it ticks (pair with `TABULAR_CLASS`).
 */
export function formatTabular(n: Nullable<number>, minChars: number, fallback = UNKNOWN): string {
  const s = formatInt(n, fallback);
  return s.length >= minChars ? s : FIGURE_SPACE.repeat(minChars - s.length) + s;
}

// ---------------------------------------------------------------------------------------------
// FLUX amounts (decimal strings with 8 fractional digits on the wire)
// ---------------------------------------------------------------------------------------------

/** Parses a FLUX decimal string (`"1234.56789012"`, `"-0.5"`, `"12"`) into base units. */
export function parseFlux(amount: Nullable<string | number>): bigint | null {
  if (amount === null || amount === undefined) return null;
  if (typeof amount === 'number') {
    if (!Number.isFinite(amount)) return null;
    return BigInt(Math.round(amount * 1e8));
  }
  const s = amount.trim();
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) {
    const x = Number(s);
    return Number.isFinite(x) ? BigInt(Math.round(x * 1e8)) : null;
  }
  const neg = m[1] === '-';
  const whole = BigInt(m[2] || '0');
  const fracRaw = m[3] ?? '';
  // Round half away from zero at the 8th decimal if more digits arrive.
  let frac = BigInt((fracRaw.slice(0, 8) || '0').padEnd(8, '0'));
  if (fracRaw.length > 8 && fracRaw.charCodeAt(8) - 48 >= 5) frac += 1n;
  const sats = whole * SATS_PER_FLUX + frac;
  return neg ? -sats : sats;
}

/** Approximate FLUX as a JS number (charts and sorting only; never for display of exact values). */
export function fluxToNumber(amount: Nullable<string | number>): number | null {
  const sats = parseFlux(amount);
  return sats === null ? null : Number(sats) / 1e8;
}

export interface FluxFormatOptions {
  /** Fraction digits: 2 in summaries (default), 8 in transaction detail. */
  decimals?: number;
  /** Append ` FLUX` (default true). */
  unit?: boolean;
  /** `always` prefixes `+` on positive values (payout chips: `+9.00`). */
  sign?: 'auto' | 'always';
  /** Group thousands (default true). */
  group?: boolean;
}

function groupDigits(s: string): string {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Formats base units as FLUX with exact decimal rounding (half away from zero). */
export function formatSats(sats: bigint, opts: FluxFormatOptions = {}): string {
  const decimals = Math.max(0, Math.min(8, opts.decimals ?? 2));
  const neg = sats < 0n;
  let abs = neg ? -sats : sats;
  const drop = 10n ** BigInt(8 - decimals);
  if (drop > 1n) {
    const rem = abs % drop;
    abs -= rem;
    if (rem * 2n >= drop) abs += drop;
  }
  const whole = abs / SATS_PER_FLUX;
  const fracDigits = (abs % SATS_PER_FLUX).toString().padStart(8, '0').slice(0, decimals);
  const wholeStr = opts.group === false ? whole.toString() : groupDigits(whole.toString());
  let out = decimals > 0 ? `${wholeStr}.${fracDigits}` : wholeStr;
  const isZero = abs === 0n;
  if (neg && !isZero) out = `-${out}`;
  else if (opts.sign === 'always' && !isZero) out = `+${out}`;
  return opts.unit === false ? out : `${out} FLUX`;
}

/** `"9.00000000"` -> `9.00 FLUX`; `formatFlux(a, {decimals: 8})` for transaction detail. */
export function formatFlux(
  amount: Nullable<string | number>,
  opts: FluxFormatOptions = {},
  fallback = UNKNOWN,
): string {
  const sats = parseFlux(amount);
  return sats === null ? fallback : formatSats(sats, opts);
}

// ---------------------------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------------------------

const S = 1000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;

/** Age label for freshness chips and feeds: `now`, `4 s`, `41 s`, `12 min`, `3 h`, `5 d`. */
export function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < S) return 'now';
  if (ms < M) return `${Math.floor(ms / S)} s`;
  if (ms < H) return `${Math.floor(ms / M)} min`;
  if (ms < D) return `${Math.floor(ms / H)} h`;
  return `${Math.floor(ms / D)} d`;
}

/** `12 s ago`, or `now`. */
export function formatAgo(ms: number): string {
  const a = formatAge(ms);
  return a === 'now' ? a : `${a} ago`;
}

/** Two largest units: `5d 3h`, `3h 12m`, `12m 5s`, `41 s`. */
export function formatDuration(ms: Nullable<number>, fallback = UNKNOWN): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return fallback;
  const neg = ms < 0;
  const t = Math.abs(ms);
  let out: string;
  if (t < M) out = `${Math.round(t / S)} s`;
  else if (t < H) {
    const m = Math.floor(t / M);
    const s = Math.floor((t % M) / S);
    out = s ? `${m}m ${s}s` : `${m}m`;
  } else if (t < D) {
    const h = Math.floor(t / H);
    const m = Math.floor((t % H) / M);
    out = m ? `${h}h ${m}m` : `${h}h`;
  } else {
    const d = Math.floor(t / D);
    const h = Math.floor((t % D) / H);
    out = h ? `${d}d ${h}h` : `${d}d`;
  }
  return neg ? `-${out}` : out;
}

/**
 * ETA copy for payouts and countdowns: seconds under 90 s (`in 28 s`), minutes under an hour
 * (`in 12 min`), hours under two days (`in 14.7 h`), then days (`in 25d 18h`).
 */
export function formatEta(ms: Nullable<number>, fallback = UNKNOWN): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return fallback;
  const t = Math.max(0, ms);
  if (t < 90 * S) return `in ${Math.round(t / S)} s`;
  if (t < H) return `in ${Math.round(t / M)} min`;
  if (t < 48 * H) return `in ${(t / H).toFixed(1)} h`;
  return `in ${formatDuration(t)}`;
}

export const BLOCK_MS = 30_000;

export interface HeightEta {
  /** Blocks from the tip to the target (negative when already past). */
  blocks: number;
  /** Milliseconds from `nowMs` to the expected time of the target block. */
  etaMs: number;
  /** Expected unix ms of the target block. */
  atMs: number;
}

/** Expected time of `target` given the tip, assuming the 30 s PoN cadence. */
export function heightEta(
  target: number,
  tip: { height: number; timeMs: number },
  nowMs: number,
  blockMs = BLOCK_MS,
): HeightEta {
  const blocks = target - tip.height;
  const atMs = tip.timeMs + blocks * blockMs;
  return { blocks, etaMs: atMs - nowMs, atMs };
}

/** `19:39:04 UTC`. */
export function formatUtcTime(ms: Nullable<number>, fallback = UNKNOWN): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return fallback;
  return `${new Date(ms).toISOString().slice(11, 19)} UTC`;
}

/** `2026-09-30 19:39 UTC`. */
export function formatUtcDateTime(ms: Nullable<number>, fallback = UNKNOWN): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return fallback;
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

// ---------------------------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------------------------

function threeSig(x: number): string {
  if (x >= 100) return Math.round(x).toString();
  if (x >= 10) return (Math.round(x * 10) / 10).toString();
  return (Math.round(x * 100) / 100).toString();
}

/** Decimal (SI) bytes: `3.4 KB`, `182 TB`, `3.19 PB`. */
export function formatBytes(n: Nullable<number>, fallback = UNKNOWN): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return fallback;
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
  let v = Math.abs(n);
  let u = 0;
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000;
    u++;
  }
  const s = u === 0 ? Math.round(v).toString() : threeSig(v);
  return `${n < 0 ? '-' : ''}${s} ${units[u]}`;
}

/** `949 Mbps`, `1.2 Gbps`. */
export function formatBandwidth(mbps: Nullable<number>, fallback = UNKNOWN): string {
  if (mbps === null || mbps === undefined || !Number.isFinite(mbps)) return fallback;
  return mbps >= 1000 ? `${threeSig(mbps / 1000)} Gbps` : `${Math.round(mbps)} Mbps`;
}

// ---------------------------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------------------------

export const DEFAULT_API_PORT = 16127;

export interface Endpoint {
  host: string;
  port: number | null;
  ipv6: boolean;
}

/** Parses `1.2.3.4:16127`, `[2001:db8::1]:16137`, or a bare host. */
export function parseEndpoint(s: Nullable<string>): Endpoint | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  const v6 = /^\[([0-9a-fA-F:.]+)\](?::(\d{1,5}))?$/.exec(t);
  if (v6) return { host: v6[1]!, port: v6[2] ? Number(v6[2]) : null, ipv6: true };
  const colon = t.lastIndexOf(':');
  if (colon > 0 && t.indexOf(':') === colon) {
    const port = Number(t.slice(colon + 1));
    if (Number.isInteger(port) && port > 0 && port < 65536)
      return { host: t.slice(0, colon), port, ipv6: false };
  }
  if (t.includes(':')) return { host: t, port: null, ipv6: true };
  return { host: t, port: null, ipv6: false };
}

/** `ip:port` with brackets for IPv6; `hideDefaultPort` drops `:16127`. */
export function formatEndpoint(
  e: Nullable<Endpoint | string>,
  opts: { hideDefaultPort?: boolean } = {},
  fallback = UNKNOWN,
): string {
  const ep = typeof e === 'string' ? parseEndpoint(e) : e;
  if (!ep) return fallback;
  const host = ep.ipv6 ? `[${ep.host}]` : ep.host;
  if (ep.port === null || (opts.hideDefaultPort && ep.port === DEFAULT_API_PORT)) return host;
  return `${host}:${ep.port}`;
}

/** Middle truncation for hashes and addresses: `2c9937...f7b6b` with a real ellipsis. */
export function middleTruncate(s: Nullable<string>, head = 6, tail = 5, fallback = UNKNOWN): string {
  if (!s) return fallback;
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(s.length - tail)}`;
}

export const shortHash = (h: Nullable<string>) => middleTruncate(h, 6, 5);
export const shortAddress = (a: Nullable<string>) => middleTruncate(a, 6, 4);

/** Collateral outpoint `txid:vout` -> `2c9937...f7b6b:0`. */
export function shortCollateral(outpoint: Nullable<string>, fallback = UNKNOWN): string {
  if (!outpoint) return fallback;
  const i = outpoint.lastIndexOf(':');
  if (i < 0) return middleTruncate(outpoint);
  return `${middleTruncate(outpoint.slice(0, i))}:${outpoint.slice(i + 1)}`;
}
