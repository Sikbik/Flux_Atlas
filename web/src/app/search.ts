// URL state (design section 2.6): search-param validators. Everything is optional; unknown or
// malformed values are dropped rather than throwing, so a hand-edited URL never breaks the app.

import type { Tier } from '../api/generated/Tier';

const MAX = 512;

export function str(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t && t.length <= MAX ? t : undefined;
}

/**
 * The palette's text (`q`): cleared of leading space, and kept as given at the end. The launchers open the
 * palette on a kind's prefix (`app `, `operator `), and a prefix is only a prefix with its space, which `str`
 * would trim away on the first navigation. An empty text is dropped here, like any other value (the palette is
 * open with nothing typed while `q` is in the raw search string, see features/command/paletteUrl.ts).
 */
export function text(v: unknown): string | undefined {
  if (typeof v !== 'string') return str(v);
  const t = v.trimStart();
  return t.trim() && t.length <= MAX ? t : undefined;
}

export function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
}

export function flag(v: unknown): boolean | undefined {
  if (v === true || v === 'true' || v === '1' || v === 1) return true;
  if (v === false || v === 'false' || v === '0' || v === 0) return false;
  return undefined;
}

function compact<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

/** Query parameters every route understands. */
export interface GlobalSearch {
  /** Camera: `lat,lon,size`. */
  c?: string;
  /** Layers: `nodes,mesh.sel,-labels`. */
  l?: string;
  tier?: string;
  cc?: string;
  org?: string;
  asn?: string;
  ver?: string;
  arcane?: boolean;
  hosting?: string;
  watched?: boolean;
  /** Selected nodes: `ip:port,...` (at most 50). */
  sel?: string;
  /** Extra windows in stack order: `queue,app:BitcoinWhitepaper`. */
  w?: string;
  /** Palette text. */
  q?: string;
  popout?: boolean;
}

export function validateGlobalSearch(s: Record<string, unknown>): GlobalSearch {
  return compact({
    c: str(s.c),
    l: str(s.l),
    tier: str(s.tier),
    cc: str(s.cc),
    org: str(s.org),
    asn: str(s.asn),
    ver: str(s.ver),
    arcane: flag(s.arcane),
    hosting: str(s.hosting),
    watched: flag(s.watched),
    sel: str(s.sel),
    w: str(s.w),
    q: text(s.q),
    popout: flag(s.popout),
  });
}

export interface TimeSearch {
  /** Instant (ISO 8601 UTC or unix ms). */
  t?: string;
  speed?: number;
}

export function validateTimeSearch(s: Record<string, unknown>): TimeSearch {
  return compact({ t: str(s.t), speed: num(s.speed) });
}

export interface OperatorSearch {
  /** Several addresses: `a,b`. */
  addr?: string;
}

export function validateOperatorSearch(s: Record<string, unknown>): OperatorSearch {
  return compact({ addr: str(s.addr) });
}

export interface TerminalSearch {
  /** Prefills the prompt; never auto-runs. */
  cmd?: string;
}

export function validateTerminalSearch(s: Record<string, unknown>): TerminalSearch {
  return compact({ cmd: str(s.cmd) });
}

export const QUEUE_TIERS = ['cumulus', 'nimbus', 'stratus'] as const satisfies readonly Tier[];
export type QueueTier = (typeof QUEUE_TIERS)[number];

export const ANALYTICS_TABS = [
  'overview',
  'geography',
  'hosting',
  'capacity',
  'versions',
  'churn',
  'archaeology',
] as const;
export type AnalyticsTab = (typeof ANALYTICS_TABS)[number];
