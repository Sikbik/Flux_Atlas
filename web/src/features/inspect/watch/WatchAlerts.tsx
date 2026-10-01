import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { Coins, Network, OctagonX, TriangleAlert, WifiOff } from 'lucide-react';
import { type ComponentType, useEffect, useRef } from 'react';
import { useRuntime } from '../../../app/context';
import { toast } from '../../../app/toasts';
import { Slice } from '../../../store/network';
import { useUi } from '../../../store/ui';
import type { AlertKind } from '../derive/watch';
import { watchNodeQuery } from '../sources/watchRoster';
import { WatchEngine } from './engine';
import { type AlertText, describeGroup, groupAlerts, type WatchAlert } from './model';
import { notificationPermission, useWatchPrefs } from './prefs';

const ICONS: Record<AlertKind, ComponentType<{ size?: number }>> = {
  offline: WifiOff,
  at_risk: TriangleAlert,
  paid: Coins,
  ip_changed: Network,
  expired: OctagonX,
};

/** Alerts that need action stay up longer than the good news. */
const TTL: Record<AlertKind, number> = {
  offline: 12_000,
  at_risk: 15_000,
  paid: 6_000,
  ip_changed: 10_000,
  expired: 15_000,
};

/** The lookups for a watched node's last check-in, in flight at once. */
const BASE_BATCH = 6;

// Only one mounted instance runs the engine, so mounting this in the shell and in a view cannot raise
// an alert twice.
let owner: object | null = null;

function systemNotify(text: AlertText, kind: AlertKind, open: (to: string) => void): void {
  if (notificationPermission() !== 'granted') return;
  // In front of the user the toast is enough; the system notification is for a tab in the background.
  if (document.visibilityState === 'visible' && document.hasFocus()) return;
  try {
    const n = new Notification(text.title, {
      body: text.body,
      tag: `atlas-watch-${kind}`,
      silent: kind === 'paid',
    });
    n.onclick = () => {
      window.focus();
      open(text.to);
      n.close();
    };
  } catch {
    // Some browsers only allow notifications from a service worker; the toast still shows.
  }
}

/**
 * Raises an in-app toast for every change to a watched node (offline, at risk of expiring, paid, new
 * address, expired) and, when the user opted in, a browser notification as well. It renders nothing.
 * Mount it once, high in the tree: it follows the node table through the store subscription (no timers).
 */
export function WatchAlerts(): null {
  const { store, clock } = useRuntime();
  const qc = useQueryClient();
  const router = useRouter();
  const watched = useUi((s) => s.watched);
  const kinds = useWatchPrefs((s) => s.kinds);
  const notify = useWatchPrefs((s) => s.notify);

  // What the running engine reads, without re-creating the subscription when it changes.
  const live = useRef({ watched, kinds, notify });
  useEffect(() => {
    live.current = { watched, kinds, notify };
  });

  const engine = useRef<WatchEngine | null>(null);

  useEffect(() => {
    const token = {};
    if (owner) return undefined;
    owner = token;
    const e = new WatchEngine();
    engine.current = e;

    const open = (to: string) => router.history.push(to);
    const deliver = (alerts: WatchAlert[]) => {
      const { kinds: k, notify: n } = live.current;
      for (const g of groupAlerts(alerts, k)) {
        const text = describeGroup(g);
        toast({
          kind: 'watch',
          title: text.title,
          body: text.body,
          to: text.to,
          icon: ICONS[g.kind],
          ttlMs: TTL[g.kind],
        });
        if (n) systemNotify(text, g.kind, open);
      }
    };
    const run = (baseline: boolean) => {
      deliver(e.look(store, live.current.watched, clock.now(), baseline));
    };

    run(true);
    const off = store.subscribe((change) => {
      if (!(change.slices & (Slice.Nodes | Slice.Tip))) return;
      run(change.nodes?.reloaded === true);
    });
    return () => {
      off();
      engine.current = null;
      if (owner === token) owner = null;
    };
  }, [store, clock, router]);

  // The table starts without check-in heights; the server knows them. One lookup per watched node.
  useEffect(() => {
    const e = engine.current;
    if (!e) return undefined;
    e.prune(new Set(watched));
    let cancelled = false;
    const missing = watched.filter((id) => !e.hasBase(id));
    void (async () => {
      for (let i = 0; i < missing.length && !cancelled; i += BASE_BATCH) {
        await Promise.all(
          missing.slice(i, i + BASE_BATCH).map(async (id) => {
            try {
              const detail = await qc.fetchQuery(watchNodeQuery(id));
              if (cancelled) return;
              e.setBase(id, detail.node.last_confirmed_height ?? 0);
              // The height changes what the engine sees; record it as the new baseline, not as news.
              e.rebase(store, id);
            } catch {
              // The node is unknown to the server, or the request failed: live check-ins still count.
            }
          }),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [watched, qc, store]);

  return null;
}
