// The tracker turns what the app does into achievement events, without touching anyone else's view: it
// watches the router (every resolved navigation), the live store (blocks, connection, feed), the
// preference store (motion, performance, the watchlist) and the globe engine's own events (zoom). Other
// surfaces of mine send their own events through `track()`.
//
// It starts once, after the first paint settles, from the command layer, and lives for the page: it keeps
// counting while ambient mode has unmounted the chrome. Unlocks go through the toast policy: at most
// three toasts a session, one at a time, never while a block's relay is playing.

import type { AnyRouter } from '@tanstack/react-router';
import { createElement } from 'react';
import type { AtlasRuntime } from '../../app/runtime';
import { toast } from '../../app/toasts';
import { RELAY_MS } from '../../choreo/effects';
import type { GlobeTarget } from '../../globe';
import type { Signal } from '../../globe/context';
import { parseExtraWindows, windowForPath } from '../../shell/wm/route';
import { Slice } from '../../store/network';
import { useUi } from '../../store/ui';
import { asAmbientEngine } from '../ambient/engineAccess';
import { AchievementGlyph } from './AchievementIcon';
import { ACHIEVEMENT_COUNT, achievementById } from './catalog';
import { continentOf } from './continents';
import { evaluate } from './evaluate';
import { type AchievementEvent, onAchievementEvent, track } from './events';
import { unlockedCount, useAchievements } from './state';

export interface TrackerDeps {
  runtime: AtlasRuntime;
  router: AnyRouter;
  engine: Signal<GlobeTarget | null>;
}

/** At most this many achievement toasts a session; the rest unlock quietly and show in Settings. */
export const MAX_TOASTS = 3;
/** A block that takes this long is "late" (design 6.5). */
const LATE_MS = 35_000;
/** Pause between two toasts that unlock together. */
const TOAST_GAP_MS = 4_500;

let running: (() => void) | null = null;

function rowForNodeKey(runtime: AtlasRuntime, key: string): number {
  const t = runtime.store.nodes;
  if (/^\d+$/.test(key)) return t.indexOf(Number(key));
  for (let i = 0; i < t.count; i++) if (t.endpoint(i) === key) return i;
  return -1;
}

/** Node keys of the node windows a location shows. */
function nodeKeys(pathname: string, search: Record<string, unknown>): string[] {
  const keys: string[] = [];
  const primary = windowForPath(pathname);
  if (primary?.type === 'node' && primary.key) keys.push(primary.key);
  for (const w of parseExtraWindows(typeof search.w === 'string' ? search.w : undefined))
    if (w.type === 'node' && w.key) keys.push(w.key);
  return keys;
}

export function startTracker(deps: TrackerDeps): () => void {
  if (running) return running;
  const { runtime, router, engine } = deps;
  const store = runtime.store;

  // ---- unlocking and announcing -----------------------------------------------------------------

  let toasts = 0;
  let queue: string[] = [];
  let timer: number | null = null;

  const relayBusyMs = (): number => {
    const since = runtime.clock.beat().sinceMs;
    return since < RELAY_MS.end + 300 ? RELAY_MS.end + 300 - since : 0;
  };

  const pump = () => {
    timer = null;
    const id = queue[0];
    if (id === undefined) return;
    if (document.visibilityState !== 'visible') {
      timer = window.setTimeout(pump, 2_000);
      return;
    }
    const wait = relayBusyMs();
    if (wait > 0) {
      timer = window.setTimeout(pump, wait);
      return;
    }
    queue = queue.slice(1);
    const def = achievementById(id);
    if (def) {
      toast({
        kind: 'achievement',
        title: def.name,
        body: `${def.said} ${unlockedCount(useAchievements.getState())} of ${ACHIEVEMENT_COUNT}.`,
        to: '/settings#achievements',
        icon: ({ size }: { size?: number }) =>
          createElement(AchievementGlyph, { icon: def.icon, ...(size ? { size } : {}) }),
        ttlMs: 7_000,
      });
      toasts++;
    }
    if (queue.length > 0) timer = window.setTimeout(pump, TOAST_GAP_MS);
  };

  const announce = (ids: readonly string[]) => {
    for (const id of ids) {
      if (toasts + queue.length >= MAX_TOASTS) return;
      queue.push(id);
    }
    if (timer === null && queue.length > 0) timer = window.setTimeout(pump, 600);
  };

  const handle = (e: AchievementEvent) => {
    const a = useAchievements.getState();
    const out = evaluate(e, { unlocked: new Set(Object.keys(a.unlocked)), progress: a.progress });
    if (out.progress !== a.progress) a.setProgress(out.progress);
    const fresh = out.unlock.filter((id) => useAchievements.getState().unlock(id, Date.now()));
    if (fresh.length > 0) announce(fresh);
  };

  const offEvents = onAchievementEvent(handle);

  // ---- the route ---------------------------------------------------------------------------------

  const onRoute = () => {
    const loc = router.state.location;
    const search = loc.search as Record<string, unknown>;
    track({ type: 'route', pathname: loc.pathname, search });
    for (const key of nodeKeys(loc.pathname, search)) {
      const row = rowForNodeKey(runtime, key);
      if (row < 0) continue;
      const cc = store.nodes.countryCode(row);
      track({ type: 'node.focus', id: store.nodes.ids[row] ?? -1, continent: cc ? continentOf(cc) : null });
    }
  };
  const offRoute = router.subscribe('onResolved', onRoute);
  onRoute();

  // ---- the live store ----------------------------------------------------------------------------

  let lastHeight = store.blocks.newest()?.height ?? 0;
  const announced = new Map<number, Set<number>>();
  let hasBeenLive = store.connection.status === 'live';
  let lost = false;
  let lateTimer: number | null = null;
  let lastFeedSeq = store.feed.newest()?.seq ?? 0;

  const armLate = () => {
    if (lateTimer !== null) window.clearTimeout(lateTimer);
    const since = runtime.clock.beat().sinceMs;
    const tipAtArm = store.tip?.height ?? null;
    lateTimer = window.setTimeout(
      () => {
        lateTimer = null;
        if (
          document.visibilityState === 'visible' &&
          store.connection.status === 'live' &&
          (store.tip?.height ?? null) === tipAtArm
        )
          track({ type: 'late' });
      },
      Math.max(1_000, LATE_MS - since),
    );
  };
  armLate();

  const focusedIds = (): Set<number> => {
    const ids = new Set<number>(useUi.getState().watched);
    const loc = router.state.location;
    for (const key of nodeKeys(loc.pathname, loc.search as Record<string, unknown>)) {
      const row = rowForNodeKey(runtime, key);
      if (row >= 0) ids.add(store.nodes.ids[row] ?? -1);
    }
    return ids;
  };

  const offStore = store.subscribe((change) => {
    if (change.slices & Slice.NextPayees && store.nextPayees) {
      const ids = new Set<number>();
      for (const p of store.nextPayees.payees) if (p.node !== null) ids.add(p.node);
      announced.set(store.nextPayees.height, ids);
      for (const h of announced.keys()) if (h < store.nextPayees.height - 4) announced.delete(h);
    }

    if (change.slices & Slice.Blocks) {
      const b = store.blocks.newest();
      if (b && b.height > lastHeight) {
        lastHeight = b.height;
        if (b.live) {
          const watched = new Set(useUi.getState().watched);
          const focus = focusedIds();
          const paid = b.payouts.filter((p) => p.node !== null);
          const mine = paid.find((p) => focus.has(p.node as number));
          track({
            type: 'block',
            height: b.height,
            watching: document.visibilityState === 'visible',
            paidWatched: paid.some((p) => watched.has(p.node as number)),
            paidFocused: mine !== undefined,
            announcedFirst:
              mine !== undefined && (announced.get(b.height)?.has(mine.node as number) ?? false),
          });
          armLate();
        }
      }
    }

    if (change.slices & Slice.Connection) {
      const status = store.connection.status;
      if (status === 'live') {
        if (hasBeenLive && lost) track({ type: 'reconnected' });
        hasBeenLive = true;
        lost = false;
      } else if (hasBeenLive && (status === 'reconnecting' || status === 'offline' || status === 'closed')) {
        lost = true;
      }
    }

    if (change.slices & Slice.Feed) {
      for (const f of store.feed.toArray()) {
        if (f.seq <= lastFeedSeq) break;
        if (f.item.kind === 'reward_reduction') track({ type: 'cut' });
      }
      lastFeedSeq = store.feed.newest()?.seq ?? lastFeedSeq;
    }
  });

  // ---- preferences -------------------------------------------------------------------------------

  const offUi = useUi.subscribe((s, prev) => {
    if (s.motion !== prev.motion) track({ type: 'ui', what: 'motion', value: s.motion });
    if (s.perf !== prev.perf) track({ type: 'ui', what: 'perf', value: s.perf });
    if (s.watched.length !== prev.watched.length) track({ type: 'watched', count: s.watched.length });
  });

  // ---- the globe ---------------------------------------------------------------------------------

  let offZoom: (() => void) | null = null;
  const attach = () => {
    offZoom?.();
    offZoom = null;
    const eng = asAmbientEngine(engine.get());
    if (eng) offZoom = eng.on('zoomBand', ({ band }) => track({ type: 'zoom', band }));
  };
  const offEngine = engine.subscribe(attach);
  attach();

  const stop = () => {
    offEvents();
    offRoute();
    offStore();
    offUi();
    offEngine();
    offZoom?.();
    if (timer !== null) window.clearTimeout(timer);
    if (lateTimer !== null) window.clearTimeout(lateTimer);
    queue = [];
    running = null;
  };
  running = stop;
  return stop;
}
