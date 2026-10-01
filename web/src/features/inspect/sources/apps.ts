// Live reads for the app inspectors: the app's index row (instance counts move on every apps delta),
// installs in progress and the newest pending message. Cached per store, name and slice versions so a
// view only re-renders when this app's facts change.

import type { AppIndexEntry } from '../../../api/generated/AppIndexEntry';
import { useNetwork } from '../../../app/context';
import type { InstallingEntry, NetworkStore, PendingApp } from '../../../store/network';

export interface AppLive {
  /** The index row, with the live running count. Null while the app is not in the index. */
  entry: AppIndexEntry | null;
  /** Installs in progress, newest first. */
  installing: InstallingEntry[];
  /** The newest pending (or just resolved) register or update message for the app. */
  pending: PendingApp | null;
}

const NONE: AppLive = { entry: null, installing: [], pending: null };
const cache = new WeakMap<NetworkStore, Map<string, { a: number; p: number; v: AppLive }>>();

export function appLiveFor(store: NetworkStore, name: string): AppLive {
  const key = name.toLowerCase();
  let per = cache.get(store);
  if (!per) {
    per = new Map();
    cache.set(store, per);
  }
  const a = store.versions.Apps;
  const p = store.versions.Pending;
  const hit = per.get(key);
  if (hit && hit.a === a && hit.p === p) return hit.v;
  const installing = [...store.installing.values()]
    .filter((e) => e.app.toLowerCase() === key)
    .sort((x, y) => y.sinceMs - x.sinceMs);
  let pending: PendingApp | null = null;
  for (const m of store.pendingApps.values()) {
    if (m.app.toLowerCase() === key && (!pending || m.receivedMs > pending.receivedMs)) pending = m;
  }
  const v: AppLive = { entry: store.apps.get(key) ?? null, installing, pending };
  per.set(key, { a, p, v });
  return v;
}

export const useAppLive = (name: string): AppLive => useNetwork((s) => appLiveFor(s, name)) ?? NONE;
