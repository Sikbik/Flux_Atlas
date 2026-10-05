// Live reads for the inspectors: the payment queues derived from the node table, one node's live
// facts, tier economics and the chain clock. Everything here is a store selector or a pure read, so
// views re-render only when the facts they show change.

import { useMemo } from 'react';
import type { NodeStatus } from '../../../api/generated/NodeStatus';
import { STATUS_CODES } from '../../../api/nodesBin';
import { useNetwork, useRuntime, useTip } from '../../../app/context';
import { fluxToNumber } from '../../../lib/format';
import { useNow } from '../../../lib/useClock';
import type { NetworkStore } from '../../../store/network';
import { resolveNodeKey } from '../../../store/nodeKeys';
import { Reach } from '../../../store/nodeTable';
import { shallowEqual } from '../../../store/react';
import { tierColumn } from '../derive/percentile';
import { buildQueues, QUEUE_TIERS, type QueueSnapshot, type QueueTier } from '../derive/queue';

// ---- queues -----------------------------------------------------------------------------------------

interface QueueEntry {
  key: string;
  snap: QueueSnapshot;
}

const queueCache = new WeakMap<NetworkStore, QueueEntry>();

/**
 * The three queues for the store's current node table, rebuilt only when the nodes, the next payees
 * or the tip changed (a few milliseconds each, at most once per block). Cached per store so every
 * view that reads it shares one snapshot.
 */
export function queuesFor(store: NetworkStore): QueueSnapshot {
  const key = `${store.versions.Nodes}:${store.versions.NextPayees}:${store.tip?.height ?? 0}`;
  const hit = queueCache.get(store);
  if (hit && hit.key === key) return hit.snap;
  const snap = buildQueues(store.nodes, store.nextPayees, store.tip?.height ?? null);
  queueCache.set(store, { key, snap });
  return snap;
}

export const useQueues = (): QueueSnapshot => useNetwork(queuesFor);

// ---- tier benchmark columns --------------------------------------------------------------------------

export interface TierColumns {
  cores: Float64Array;
  ramGb: Float64Array;
  ssdGb: Float64Array;
}

const columnCache = new WeakMap<NetworkStore, Map<string, { key: number; cols: TierColumns }>>();

/** Sorted cores, RAM and SSD of every benchmarked node of a tier, cached per node-slice version. */
export function tierColumnsFor(store: NetworkStore, tier: string): TierColumns | null {
  const code = tier === 'cumulus' ? 1 : tier === 'nimbus' ? 2 : tier === 'stratus' ? 3 : 0;
  if (!code) return null;
  let perStore = columnCache.get(store);
  if (!perStore) {
    perStore = new Map();
    columnCache.set(store, perStore);
  }
  const hit = perStore.get(tier);
  if (hit && hit.key === store.versions.Nodes) return hit.cols;
  const t = store.nodes;
  const cols = {
    cores: tierColumn(t, code, 'cores'),
    ramGb: tierColumn(t, code, 'ramGb'),
    ssdGb: tierColumn(t, code, 'ssdGb'),
  };
  perStore.set(tier, { key: store.versions.Nodes, cols });
  return cols;
}

// ---- a node's live facts ----------------------------------------------------------------------------

export interface NodeLive {
  id: number;
  tier: QueueTier | 'unknown';
  status: NodeStatus;
  reachable: boolean | null;
  lastPaid: number;
  /** Height of the last check-in seen live; 0 when none has been seen since load. */
  lastConfirmed: number;
  endpoint: string;
  appCount: number;
  cores: number;
  ramGb: number;
  ssdGb: number;
  fluxOs: string;
  country: string;
  org: string;
  lat: number | null;
  lon: number | null;
}

const TIER_NAMES = ['unknown', ...QUEUE_TIERS] as const;

export function readNodeLive(store: NetworkStore, id: number | null): NodeLive | null {
  if (id === null) return null;
  const t = store.nodes;
  const i = t.indexOf(id);
  if (i < 0) return null;
  const reach = t.reachable[i]!;
  const lat = t.lat[i]!;
  const lon = t.lon[i]!;
  return {
    id,
    tier: TIER_NAMES[t.tier[i]!] ?? 'unknown',
    status: STATUS_CODES[t.status[i]!] ?? 'unknown',
    reachable: reach === Reach.Yes ? true : reach === Reach.No ? false : null,
    lastPaid: t.lastPaid[i]!,
    lastConfirmed: t.lastConfirmed[i]!,
    endpoint: t.endpoint(i),
    appCount: t.appCount[i]!,
    cores: t.cores[i]!,
    ramGb: t.ramGb[i]!,
    ssdGb: t.ssdGb[i]!,
    fluxOs: t.fluxOs(i),
    country: t.countryCode(i),
    org: t.orgName(i),
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
  };
}

export const useNodeLive = (id: number | null): NodeLive | null =>
  useNetwork((s) => readNodeLive(s, id), shallowEqual);

/** The node id for a route key (an outpoint, `ip:port`, a numeric id) once the snapshot is loaded; null otherwise. */
export function useResolvedId(key: string): number | null {
  return useNetwork((s) => (s.loaded ? resolveNodeKey(s.nodes, key) : null));
}

// ---- tier economics ---------------------------------------------------------------------------------

export interface TierInfo {
  tier: QueueTier;
  count: number;
  /** FLUX paid per block to the head of the queue, on the main chain. */
  payout: number | null;
  /** What that payout accrues in parallel assets (the server's `pa_payout`). */
  paPayout: number | null;
  cycleBlocks: number;
}

const EMPTY_TIERS: readonly TierInfo[] = [];

/** Per-tier payout, node count and cycle length from the live tier stats. */
export function useTierInfo(): readonly TierInfo[] {
  const stats = useNetwork((s) => s.tierStats);
  // One array per change of the stats, so a reader may use it as a dependency.
  return useMemo(
    () =>
      stats.length === 0
        ? EMPTY_TIERS
        : QUEUE_TIERS.map((tier) => {
            const s = stats.find((x) => x.tier === tier);
            return {
              tier,
              count: s?.count ?? 0,
              payout: s ? fluxToNumber(s.payout) : null,
              paPayout: s ? fluxToNumber(s.pa_payout) : null,
              cycleBlocks: s?.cycle_blocks ?? 0,
            };
          }),
    [stats],
  );
}

export function tierPayouts(info: readonly TierInfo[]): Partial<Record<QueueTier, number>> {
  const out: Partial<Record<QueueTier, number>> = {};
  for (const t of info) if (t.payout !== null) out[t.tier] = t.payout;
  return out;
}

/** Per tier, what a payout accrues in parallel assets. */
export function tierPaPayouts(info: readonly TierInfo[]): Partial<Record<QueueTier, number>> {
  const out: Partial<Record<QueueTier, number>> = {};
  for (const t of info) if (t.paPayout !== null) out[t.tier] = t.paPayout;
  return out;
}

// ---- the chain clock --------------------------------------------------------------------------------

export interface ChainClock {
  tip: number | null;
  /** When the tip block landed (server time), the anchor for payout ETAs. */
  anchorMs: number | null;
  /** Server time of the latest 1 Hz tick. */
  nowMs: number;
}

/** Re-renders once per second: read it in small leaf components, not whole views. */
export function useChainClock(): ChainClock {
  const { clock } = useRuntime();
  const nowMs = useNow(clock);
  const tip = useTip();
  return {
    tip: tip?.height ?? null,
    anchorMs: clock.lastBlockInfo?.anchorMs ?? tip?.time_ms ?? null,
    nowMs,
  };
}

/** The tip height and anchor without the 1 Hz tick (re-renders per block). */
export function useTipAnchor(): { tip: number | null; anchorMs: number | null } {
  const { clock } = useRuntime();
  const tip = useTip();
  return { tip: tip?.height ?? null, anchorMs: clock.lastBlockInfo?.anchorMs ?? tip?.time_ms ?? null };
}
