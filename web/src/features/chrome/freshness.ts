// Per-ingest-path freshness for the status bar (design 4.4, 6.5, 8.8): one chip per path (tip, nodes,
// apps, stats, mesh), each an age classified against the path's own cadence by the one shared rule
// (fresh under 1.5x, aging to 3x, stale to 10x, dead beyond). The age is the newest evidence we hold:
// the receipt time of the path's live messages, or the server's own job time from the last snapshot.
// Pure here; the status bar binds the store.

import type { JobFreshness } from '../../api/generated/JobFreshness';
import { type Freshness, freshness } from '../../lib/clock';

export type PathId = 'tip' | 'nodes' | 'apps' | 'stats' | 'mesh';

export interface PathDef {
  id: PathId;
  label: string;
  /** What the path is, for the hover card. */
  what: string;
  /** Expected seconds between updates (design 6.5 cadences), in ms. */
  cadenceMs: number;
  /** Live message types that refresh it. */
  messages: readonly string[];
  /** Server ingest jobs behind it (`JobFreshness.job`). */
  jobs: readonly string[];
}

export const PATHS: readonly PathDef[] = [
  {
    id: 'tip',
    label: 'tip',
    what: 'The chain tip: a block about every 30 s',
    cadenceMs: 30_000,
    messages: ['block'],
    // The tip reads as the age of the last block; the server's job times only stand in before one is known.
    jobs: ['chain_stream', 'block_decoder'],
  },
  {
    id: 'nodes',
    label: 'nodes',
    what: 'The node list and statuses',
    cadenceMs: 90_000,
    messages: ['nodes'],
    jobs: ['node_registry', 'node_count'],
  },
  {
    id: 'apps',
    label: 'apps',
    what: 'The app catalog and where apps run',
    cadenceMs: 120_000,
    messages: ['apps'],
    jobs: ['app_placement', 'app_catalog'],
  },
  {
    id: 'stats',
    label: 'stats',
    what: 'Network totals and analytics',
    cadenceMs: 450_000,
    messages: ['stats'],
    jobs: ['stats_round'],
  },
  {
    id: 'mesh',
    label: 'mesh',
    what: 'Peer links between nodes',
    cadenceMs: 2_700_000,
    messages: ['mesh'],
    jobs: ['topology_sweep'],
  },
];

export interface PathReading {
  id: PathId;
  label: string;
  /** Milliseconds since the newest evidence; null when there is none. */
  ageMs: number | null;
  state: Freshness | 'unknown';
  /** Where the evidence came from: the live stream, the server's job time at the last snapshot, or none. */
  source: 'stream' | 'snapshot' | 'none';
}

export interface FreshnessInput {
  nowMs: number;
  jobs: ReadonlyMap<string, JobFreshness>;
  /** Receipt time (server-corrected) of the last message per type. */
  lastMessage: ReadonlyMap<string, number>;
  /** Anchor time of the last block (the event clock's), for the tip path. */
  tipAnchorMs: number | null;
}

export function readPath(def: PathDef, input: FreshnessInput): PathReading {
  let streamMs: number | null = null;
  for (const m of def.messages) {
    const t = input.lastMessage.get(m);
    if (t !== undefined && (streamMs === null || t > streamMs)) streamMs = t;
  }
  if (def.id === 'tip' && input.tipAnchorMs !== null && (streamMs === null || input.tipAnchorMs > streamMs))
    streamMs = input.tipAnchorMs;
  let jobMs: number | null = null;
  const ignoreJobs = def.id === 'tip' && input.tipAnchorMs !== null;
  for (const j of ignoreJobs ? [] : def.jobs) {
    const t = input.jobs.get(j)?.last_ok_ms;
    if (t !== null && t !== undefined && (jobMs === null || t > jobMs)) jobMs = t;
  }
  const evidence = streamMs !== null && (jobMs === null || streamMs >= jobMs) ? streamMs : jobMs;
  if (evidence === null)
    return { id: def.id, label: def.label, ageMs: null, state: 'unknown', source: 'none' };
  const ageMs = Math.max(0, input.nowMs - evidence);
  return {
    id: def.id,
    label: def.label,
    ageMs,
    state: freshness(ageMs, def.cadenceMs),
    source: evidence === streamMs ? 'stream' : 'snapshot',
  };
}

export function readPaths(input: FreshnessInput): PathReading[] {
  return PATHS.map((p) => readPath(p, input));
}

/** The worst state among readings (for one summary dot). */
export function worstState(readings: readonly PathReading[]): PathReading['state'] {
  const order: PathReading['state'][] = ['fresh', 'aging', 'stale', 'dead', 'unknown'];
  let worst = 0;
  for (const r of readings) worst = Math.max(worst, order.indexOf(r.state));
  return order[worst] ?? 'fresh';
}
