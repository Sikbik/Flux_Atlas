// Data for the payment queue view: who was paid lately, node search over the live table, and the block
// phase that drives the wheels and belts (one animation loop, shared, stopped when nothing is visible).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { STATUS_CODES } from '../../../api/nodesBin';
import { useChainBlocks, useNetwork, useRuntime } from '../../../app/context';
import { BLOCK_MS } from '../../../lib/format';
import type { NetworkStore } from '../../../store/network';
import { Reach } from '../../../store/nodeTable';
import { effectiveMotion, useUi } from '../../../store/ui';
import { type Payee, recentPayees } from '../derive/payees';
import type { QueueSnapshot, QueueTier } from '../derive/queue';
import { positionOf } from '../derive/queue';
import { useTipAnchor } from './live';

// ---- recent payees ----------------------------------------------------------------------------------

export type { Payee };

/** Recent payees of a tier; re-renders once per block. */
export function useRecentPayees(tier: QueueTier, limit: number): Payee[] {
  const blocks = useChainBlocks();
  return useMemo(() => recentPayees(blocks, tier, limit), [blocks, tier, limit]);
}

// ---- search -----------------------------------------------------------------------------------------

export interface NodeHit {
  id: number;
  endpoint: string;
  tier: QueueTier | 'unknown';
  /** Zero-based place in the tier's queue, null when not queued. */
  position: number | null;
  size: number;
}

/**
 * Finds nodes by id or by part of their `ip:port`, queued nodes first. A scan of the node table, a
 * millisecond for the whole network, so it runs on every keystroke without a request.
 */
export function searchNodes(store: NetworkStore, queues: QueueSnapshot, query: string, limit = 8): NodeHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const t = store.nodes;
  const hits: NodeHit[] = [];
  const asId = /^\d+$/.test(q) ? Number(q) : null;
  for (let i = 0; i < t.count && hits.length < limit * 6; i++) {
    const id = t.ids[i]!;
    const endpoint = t.endpoint(i);
    if (!(asId !== null && id === asId) && !endpoint.toLowerCase().includes(q)) continue;
    const pos = positionOf(queues, id);
    hits.push({
      id,
      endpoint,
      tier: pos?.tier ?? 'unknown',
      position: pos ? pos.position : null,
      size: pos?.size ?? 0,
    });
  }
  hits.sort((a, b) => {
    const aq = a.position === null ? 1 : 0;
    const bq = b.position === null ? 1 : 0;
    if (aq !== bq) return aq - bq;
    const exactA = a.endpoint.toLowerCase() === q ? 0 : 1;
    const exactB = b.endpoint.toLowerCase() === q ? 0 : 1;
    return exactA - exactB || a.endpoint.length - b.endpoint.length || a.endpoint.localeCompare(b.endpoint);
  });
  return hits.slice(0, limit);
}

// ---- risk beads -------------------------------------------------------------------------------------

/** Per queue position: 0 fine, 1 unreachable at the last sweep, 2 listed offline or expired. */
const riskCache = new WeakMap<NetworkStore, WeakMap<Uint32Array, { key: number; flags: Uint8Array }>>();

export function riskFlagsFor(store: NetworkStore, ids: Uint32Array): Uint8Array {
  let per = riskCache.get(store);
  if (!per) {
    per = new WeakMap();
    riskCache.set(store, per);
  }
  const hit = per.get(ids);
  if (hit && hit.key === store.versions.Nodes) return hit.flags;
  const t = store.nodes;
  const flags = new Uint8Array(ids.length);
  for (let i = 0; i < ids.length; i++) {
    const row = t.indexOf(ids[i]!);
    if (row < 0) continue;
    const status = STATUS_CODES[t.status[row]!];
    if (status === 'offline' || status === 'expired') flags[i] = 2;
    else if (t.reachable[row] === Reach.No) flags[i] = 1;
  }
  per.set(ids, { key: store.versions.Nodes, flags });
  return flags;
}

export const useRiskFlags = (ids: Uint32Array): Uint8Array => useNetwork((s) => riskFlagsFor(s, ids));

// ---- the phase loop ---------------------------------------------------------------------------------

export type PhaseListener = (phase: number, nowMs: number) => void;

export interface PhaseLoop {
  /** Calls `fn` every frame while the loop runs (and once now); returns the unsubscribe. */
  subscribe(fn: PhaseListener): () => void;
  /** The current phase of the block (0 right after one, 1 when the next is due), without waiting for a frame. */
  phase(): number;
  /** Whether frames are being driven (full motion, page visible). */
  animated: boolean;
  /** Server time of the tip block that the last render saw. */
  anchorMs: number | null;
}

/**
 * One requestAnimationFrame loop for a whole view. The phase is measured from the tip block the view last
 * rendered, so a belt resets to zero in the same frame that its tiles move up by one: the new payee
 * and the new phase always arrive together. Under reduced motion nothing animates; listeners get the
 * phase once whenever the tip changes.
 */
export function usePhaseLoop(): PhaseLoop {
  const { clock } = useRuntime();
  const { tip, anchorMs } = useTipAnchor();
  const motion = effectiveMotion(useUi((s) => s.motion));
  const animated = motion === 'full';
  const subs = useRef(new Set<PhaseListener>());
  const anchor = useRef<number | null>(anchorMs);
  const clockRef = useRef(clock);
  clockRef.current = clock;

  // The anchor is updated in the same commit that renders the new tiles, before the next frame.
  useLayoutEffect(() => {
    anchor.current = anchorMs;
  }, [anchorMs]);

  const phase = useCallback((): number => {
    const a = anchor.current;
    if (a === null) return 0;
    return Math.max(0, Math.min(1, (clockRef.current.now() - a) / BLOCK_MS));
  }, []);

  const frame = useCallback(() => {
    const now = clockRef.current.now();
    const p = phase();
    for (const fn of subs.current) fn(p, now);
  }, [phase]);

  // `tip` re-runs the one-off draw under reduced motion when a block lands.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the tip only retriggers that frame
  useEffect(() => {
    if (!animated) {
      frame();
      return undefined;
    }
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      frame();
    };
    const sync = () => {
      cancelAnimationFrame(raf);
      if (document.visibilityState === 'visible') raf = requestAnimationFrame(loop);
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [animated, frame, tip]);

  const subscribe = useCallback(
    (fn: PhaseListener) => {
      subs.current.add(fn);
      fn(animated ? phase() : 0, clockRef.current.now());
      return () => {
        subs.current.delete(fn);
      };
    },
    [animated, phase],
  );

  return useMemo(() => ({ subscribe, phase, animated, anchorMs }), [subscribe, phase, animated, anchorMs]);
}
