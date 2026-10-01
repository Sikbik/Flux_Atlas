// The watchlist alert engine: reads the live node table for every watched node, compares it with the
// previous look and returns what changed. It holds the memory (snapshots, the last confirmed height the
// server told us, the deduper) and nothing else; delivery (toasts, notifications) is the component's job.

import { STATUS_CODES } from '../../../api/nodesBin';
import type { NetworkStore } from '../../../store/network';
import { Reach } from '../../../store/nodeTable';
import { AlertDeduper, diffWatch, type WatchSnapshot } from '../derive/watch';
import type { WatchAlert } from './model';

type StoreView = Pick<NetworkStore, 'nodes' | 'tip' | 'loaded'>;

/** One node as the alert engine sees it. `baseConfirmed` is the check-in height the server gave us. */
export function snapshotOf(store: StoreView, id: number, baseConfirmed = 0): WatchSnapshot {
  const t = store.nodes;
  const i = t.indexOf(id);
  const tip = store.tip?.height ?? 0;
  if (i < 0) {
    return {
      tip,
      present: false,
      status: 'unknown',
      reachable: null,
      lastPaid: 0,
      lastConfirmed: baseConfirmed,
      endpoint: '',
    };
  }
  const reach = t.reachable[i]!;
  return {
    tip,
    present: true,
    status: STATUS_CODES[t.status[i]!] ?? 'unknown',
    reachable: reach === Reach.Yes ? true : reach === Reach.No ? false : null,
    lastPaid: t.lastPaid[i]!,
    // The live table only knows check-ins seen since load; the server's figure covers the time before.
    lastConfirmed: Math.max(t.lastConfirmed[i]!, baseConfirmed),
    endpoint: t.endpoint(i),
  };
}

export class WatchEngine {
  private readonly snaps = new Map<number, WatchSnapshot>();
  private readonly bases = new Map<number, number>();
  private readonly deduper = new AlertDeduper();

  /** Records a node's last confirmed height from the server (the table starts without one). */
  setBase(id: number, height: number): void {
    if (height > 0) this.bases.set(id, height);
  }

  hasBase(id: number): boolean {
    return this.bases.has(id);
  }

  /** Records the current state of one node as its baseline, without raising anything. */
  rebase(store: StoreView, id: number): void {
    if (!store.loaded) return;
    this.snaps.set(id, snapshotOf(store, id, this.bases.get(id) ?? 0));
  }

  /** Forgets every node that is no longer watched, so a node watched again starts from a fresh baseline. */
  prune(watched: ReadonlySet<number>): void {
    for (const id of [...this.snaps.keys()]) if (!watched.has(id)) this.snaps.delete(id);
    for (const id of [...this.bases.keys()]) if (!watched.has(id)) this.bases.delete(id);
  }

  /**
   * Looks at every watched node and returns the alerts raised since the previous look. Nothing is
   * raised while the table is not loaded, and `baseline` records the current state without alerting (the
   * first look, and after the table was reloaded wholesale).
   */
  look(store: StoreView, ids: readonly number[], nowMs: number, baseline = false): WatchAlert[] {
    if (!store.loaded) return [];
    const out: WatchAlert[] = [];
    for (const id of ids) {
      const prev = this.snaps.get(id) ?? null;
      const next = snapshotOf(store, id, this.bases.get(id) ?? 0);
      this.snaps.set(id, next);
      if (baseline || !prev) continue;
      for (const e of diffWatch(id, prev, next)) {
        if (!this.deduper.accept(e, nowMs)) continue;
        const endpoint = next.endpoint || prev.endpoint;
        out.push({
          ...e,
          endpoint,
          ...(e.kind === 'ip_changed' && prev.endpoint ? { from: prev.endpoint } : {}),
        });
      }
    }
    return out;
  }
}
