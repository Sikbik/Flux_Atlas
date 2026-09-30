// Keeps TanStack Query data live: each WebSocket message invalidates (active queries only) or
// patches the keys whose server data it changed, so open views refetch the moment the network
// changes instead of polling. Chatty sources are throttled.

import type { QueryClient } from '@tanstack/react-query';
import { realScheduler, type Scheduler } from '../lib/scheduler';
import type { LiveMsg } from './generated/LiveMsg';
import { qk } from './queryKeys';

/** Above this many changed nodes, invalidate every open node view instead of one by one. */
const BULK_NODES = 200;

export function createLiveInvalidator(
  qc: QueryClient,
  opts: { scheduler?: Scheduler; throttleMs?: number } = {},
) {
  const sched = opts.scheduler ?? realScheduler;
  const throttleMs = opts.throttleMs ?? 5_000;
  const last = new Map<string, number>();

  const active = (queryKey: readonly unknown[]) => qc.invalidateQueries({ queryKey, refetchType: 'active' });
  const throttled = (key: string, queryKey: readonly unknown[]) => {
    const now = sched.now();
    if (now - (last.get(key) ?? Number.NEGATIVE_INFINITY) < throttleMs) return;
    last.set(key, now);
    void active(queryKey);
  };
  const nodeDetails = (ids: readonly number[]) => {
    if (ids.length > BULK_NODES) {
      throttled('node-details', [...qk.nodes.all(), 'detail']);
      return;
    }
    for (const id of ids) void active(qk.nodes.detail(id));
  };

  return (msg: LiveMsg): void => {
    switch (msg.t) {
      case 'block': {
        void active(qk.blocks.all());
        // Payout ETAs, last-paid and check-in gauges move every block.
        void active([...qk.nodes.all(), 'detail']);
        void active([...qk.nodes.all(), 'payments']);
        void active([...qk.all(), 'operator']);
        throttled('mempool', qk.mempool());
        break;
      }
      case 'reorg':
        void active(qk.blocks.all());
        void active([...qk.all(), 'tx']);
        void active([...qk.all(), 'address']);
        break;
      case 'nodes':
        throttled('nodes-list', [...qk.nodes.all(), 'list']);
        nodeDetails([...msg.removed, ...msg.changed.map((c) => c.id), ...msg.added.map((n) => n.id)]);
        break;
      case 'apps': {
        throttled('apps-index', qk.apps.index());
        const names = new Set([
          ...msg.upserted.map((a) => a.name),
          ...msg.removed,
          ...msg.instances.map((i) => i.app),
        ]);
        for (const name of names) {
          void active(qk.apps.detail(name));
          void active(qk.apps.history(name));
        }
        break;
      }
      case 'app_pending':
      case 'app_pending_resolved':
      case 'app_installing':
        void active(qk.apps.detail(msg.app));
        break;
      case 'stats':
        qc.setQueryData(qk.network.summary(), msg.summary);
        break;
      case 'mempool':
        throttled('mempool', qk.mempool());
        break;
      default:
        break;
    }
  };
}
