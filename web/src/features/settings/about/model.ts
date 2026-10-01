// The numbers About Flux explains, worked out from what the app already has. Pure: no React, no store, so
// each rule is a test. The moon's anatomy is the Flux symbol read as the chain (design 8.19): four pieces,
// each one a payout the block's coinbase makes, listed largest first (the relay itself fires them the
// other way round, small to large, in the order the chain lists them).

import type { CapacityDto } from '../../../api/generated/CapacityDto';
import type { DataAttribution } from '../../../api/generated/DataAttribution';
import type { TierStats } from '../../../api/generated/TierStats';
import { BLOCK_MS, formatBytes, formatFlux, formatInt, formatSats, parseFlux } from '../../../lib/format';

export type TierKey = 'cumulus' | 'nimbus' | 'stratus';
export type PieceKey = 'cap' | 'big' | 'small' | 'bar';

/** Which piece of the symbol a tier is paid through. */
export const PIECE_OF_TIER: Readonly<Record<TierKey, PieceKey>> = {
  stratus: 'cap',
  nimbus: 'big',
  cumulus: 'small',
};

export const PIECE_NAME: Readonly<Record<PieceKey, string>> = {
  cap: 'Cap',
  big: 'Big hexagon',
  small: 'Small hexagon',
  bar: 'Bar',
};

export const TIER_NAME: Readonly<Record<TierKey, string>> = {
  cumulus: 'Cumulus',
  nimbus: 'Nimbus',
  stratus: 'Stratus',
};

/** Largest payout first: how every list in Atlas reads. */
export const READING_ORDER: readonly TierKey[] = ['stratus', 'nimbus', 'cumulus'];

export interface LegendRow {
  piece: PieceKey;
  /** The tier the piece pays, or null for the bar (the development fund). */
  tier: TierKey | null;
  name: string;
  pieceName: string;
  /** `14.7 h cycle`, or `every block`; null until the server has told us. */
  cycle: string | null;
  /** `9.00 FLUX`; null until known. */
  payout: string | null;
}

/** `14.7 h`, `28 h`: how long a tier takes to pay every node once, from its queue length in blocks. */
export function cycleLabel(blocks: number, blockMs = BLOCK_MS): string {
  const h = (blocks * blockMs) / 3_600_000;
  const t = h >= 100 ? Math.round(h) : Math.round(h * 10) / 10;
  return `${t} h`;
}

/** What a block's reward leaves once the three tiers are paid: the development fund's cut. */
export function devFundShare(reward: string | null | undefined, tiers: readonly TierStats[]): bigint | null {
  const total = parseFlux(reward);
  if (total === null || tiers.length < 3) return null;
  let paid = 0n;
  for (const t of tiers) {
    const p = parseFlux(t.payout);
    if (p === null) return null;
    paid += p;
  }
  const rest = total - paid;
  return rest > 0n ? rest : null;
}

export function legendRows(tiers: readonly TierStats[], reward: string | null | undefined): LegendRow[] {
  const rows: LegendRow[] = READING_ORDER.map((tier) => {
    const t = tiers.find((x) => x.tier === tier);
    return {
      piece: PIECE_OF_TIER[tier],
      tier,
      name: TIER_NAME[tier],
      pieceName: PIECE_NAME[PIECE_OF_TIER[tier]],
      cycle: t ? `${cycleLabel(t.cycle_blocks)} cycle` : null,
      payout: t ? formatFlux(t.payout) : null,
    };
  });
  const dev = devFundShare(reward, tiers);
  rows.push({
    piece: 'bar',
    tier: null,
    name: 'Dev fund',
    pieceName: PIECE_NAME.bar,
    cycle: 'every block',
    payout: dev === null ? null : formatSats(dev),
  });
  return rows;
}

// ---------------------------------------------------------------------------------------------
// The next reward cut
// ---------------------------------------------------------------------------------------------

const plural = (n: number, one: string): string => `${formatInt(n)} ${one}${n === 1 ? '' : 's'}`;

/**
 * A span in words, two units at most, never finer than a minute: `25 days 18 hours`, `3 hours 12 minutes`,
 * `40 minutes`. The reward cut is weeks away; the second unit is there to make the countdown feel alive.
 */
export function roughSpan(ms: number): string {
  const total = Math.max(0, Math.round(ms / 60_000));
  const d = Math.floor(total / 1440);
  const h = Math.floor((total % 1440) / 60);
  const m = total % 60;
  if (d > 0) return h > 0 ? `${plural(d, 'day')} ${plural(h, 'hour')}` : plural(d, 'day');
  if (h > 0) return m > 0 ? `${plural(h, 'hour')} ${plural(m, 'minute')}` : plural(h, 'hour');
  return plural(Math.max(1, m), 'minute');
}

// ---------------------------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------------------------

export interface CapacityRow {
  id: 'cpu' | 'ram' | 'ssd';
  label: string;
  total: string;
  locked: string;
  /** How much of the total apps hold, 0 to 1. */
  share: number;
}

const GB = 1e9;
const MB = 1e6;

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/** CPU, memory and storage across every node, and how much of each running apps hold. */
export function capacityRows(cap: CapacityDto): CapacityRow[] {
  const t = cap.total;
  const l = cap.apps_locked;
  return [
    {
      id: 'cpu',
      label: 'CPU cores',
      total: formatInt(t.cores),
      locked: formatInt(Math.round(l.cpu)),
      share: clamp01(l.cpu / t.cores),
    },
    {
      id: 'ram',
      label: 'Memory',
      total: formatBytes(t.ram_gb * GB),
      locked: formatBytes(l.ram_mb * MB),
      share: clamp01((l.ram_mb * MB) / (t.ram_gb * GB)),
    },
    {
      id: 'ssd',
      label: 'SSD storage',
      total: formatBytes(t.ssd_gb * GB),
      locked: formatBytes(l.hdd_gb * GB),
      share: clamp01(l.hdd_gb / t.ssd_gb),
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Data credits
// ---------------------------------------------------------------------------------------------

/** One credit line, ready to draw: the links are only ever http or https. */
export interface CreditLine {
  key: string;
  /** The credit line, verbatim (`IP Geolocation by DB-IP`). */
  text: string;
  href: string | null;
  /** `CC BY 4.0`. */
  license: string;
  licenseHref: string | null;
  /** What the data is used for. */
  scope: string;
  /** `2026-09`, when the server knows it. */
  version: string | null;
}

/** A link a credit may carry: web addresses only, so a bad value from a server never becomes a script. */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * The credits the server says the UI must show (licence terms), one line each, in the order sent. The list
 * is optional on older servers and empty when none applies; a line with no text is dropped, never invented.
 */
export function creditLines(list: readonly DataAttribution[] | null | undefined): CreditLine[] {
  const out: CreditLine[] = [];
  for (const a of list ?? []) {
    const text = a.text?.trim();
    if (!text) continue;
    out.push({
      key: `${a.name}:${a.license}:${a.url}`,
      text,
      href: safeHref(a.url),
      license: a.license,
      licenseHref: safeHref(a.license_url),
      scope: a.scope,
      version: a.version?.trim() || null,
    });
  }
  return out;
}
