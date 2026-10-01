// How current each live source is, by the rule the whole interface shares (design 6.5): an age against the
// source's own cadence. Under 1.5 cadences is fresh, to 3 aging, to 10 stale, beyond that dead. The status
// bar's chips and this list read the same store timestamps, so one rule explains every one of them.

import type { LiveMsg } from '../../api/generated/LiveMsg';

export type FreshState = 'fresh' | 'aging' | 'stale' | 'dead';

export function freshnessState(ageMs: number, cadenceMs: number): FreshState {
  const x = ageMs / cadenceMs;
  if (x < 1.5) return 'fresh';
  if (x < 3) return 'aging';
  if (x < 10) return 'stale';
  return 'dead';
}

export interface FreshSource {
  id: string;
  label: string;
  /** The live messages that carry this source; the newest of them is its last sign of life. */
  types: readonly LiveMsg['t'][];
  cadenceMs: number;
  /** How often it is expected to change, in words. */
  every: string;
}

const SEC = 1000;
const MIN = 60_000;

/**
 * The ingest paths a visitor can see move. Cadences are how often the live socket really delivers each one
 * (watched on the production feed: a block about every 30 s, node changes every half minute or so, app
 * activity several times a minute, peer links in a steady sweep), kept loose enough that a quiet minute is
 * never read as trouble.
 */
export const FRESH_SOURCES: readonly FreshSource[] = [
  {
    id: 'blocks',
    label: 'Blocks and payouts',
    types: ['block'],
    cadenceMs: 30 * SEC,
    every: 'a block about every 30 s',
  },
  {
    id: 'nodes',
    label: 'Node changes',
    types: ['nodes'],
    cadenceMs: 2 * MIN,
    every: 'as nodes confirm or move',
  },
  {
    id: 'apps',
    label: 'App activity',
    types: ['apps', 'app_pending', 'app_pending_resolved', 'app_installing'],
    cadenceMs: 5 * MIN,
    every: 'installs, updates and removals',
  },
  {
    id: 'stats',
    label: 'Network totals',
    types: ['stats'],
    cadenceMs: 5 * MIN,
    every: 'counts and capacity',
  },
  { id: 'mesh', label: 'Peer links', types: ['mesh'], cadenceMs: MIN, every: 'a steady sweep' },
];

/**
 * The newest sign of life across a source's feeds. A feed that has said nothing since this page connected is
 * judged from the moment it connected, so the first seconds read as "nothing yet" and only real silence ages.
 */
export function lastSignOf(
  s: FreshSource,
  lastMessageMs: ReadonlyMap<LiveMsg['t'], number>,
  connectedMs: number,
): { at: number; heard: boolean } {
  let at = Number.NEGATIVE_INFINITY;
  for (const t of s.types) {
    const v = lastMessageMs.get(t);
    if (v !== undefined && v > at) at = v;
  }
  return at === Number.NEGATIVE_INFINITY ? { at: connectedMs, heard: false } : { at, heard: true };
}

/** `4 s`, `41 s`, `12 min`, `3 h`. Seconds swap instantly; past a minute the label changes once a minute. */
export function ageLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 1) return 'now';
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h`;
}
