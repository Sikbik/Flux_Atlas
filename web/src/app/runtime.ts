// The live runtime: one NetworkStore, one LiveClient, one EventClock and one Choreographer for the
// whole session, wired together outside React. The globe engine attaches its EffectSink with
// `setEffectSink` and reads the store through `store.subscribe`; React reads through selectors.
//
// Data flow per WebSocket message: store.apply (state first, so a skipped animation can never leave
// the UI showing the wrong network) -> choreographer.handle (timed effects) -> query invalidation.
//
// Origins (ARCHITECTURE 8.1): a session holds snapshots, live messages and node ids of exactly one
// origin `(server.instance, server.started_ms)`. A resync loads three bodies of one origin
// (`fetchSnapshot`); when it lands on another instance than before, every id-keyed cache is dropped
// (React Query, the choreographer, and through `store.instanceSwitches` the watch alerts; a restart
// of the same instance keeps its ids). Selected and watched nodes are kept by outpoint and mapped to
// the new ids before `sub.watch` is sent.

import { QueryClient } from '@tanstack/react-query';
import { api } from '../api/endpoints';
import { isApiError } from '../api/http';
import { LiveClient, type LiveClientOptions } from '../api/live';
import { createLiveInvalidator } from '../api/liveInvalidation';
import { qk } from '../api/queryKeys';
import { Choreographer } from '../choreo/choreographer';
import { type EffectSink, nullSink, recordingSink } from '../choreo/effects';
import { EventClock } from '../lib/clock';
import { NetworkStore } from '../store/network';
import { resolveNodeKey, setNodeKeySource } from '../store/nodeKeys';
import { effectiveMotion, useUi } from '../store/ui';
import { fetchSnapshot, type SnapshotFetchers } from './snapshot';

export interface AtlasRuntime {
  store: NetworkStore;
  live: LiveClient;
  clock: EventClock;
  choreo: Choreographer;
  /** Records every effect command (the /dev/live inspector) and forwards to the active sink. */
  effects: ReturnType<typeof recordingSink>;
  queryClient: QueryClient;
  /** Attaches the renderer's sink (the globe engine); `null` detaches. */
  setEffectSink(sink: EffectSink | null): void;
  /**
   * Nodes currently selected in the UI (P1 effects, WatchProbe via `sub.watch`), by key (an
   * outpoint, or a legacy id or `ip:port`): resolved to ids now and again after every snapshot load.
   */
  setSelected(keys: readonly string[]): void;
  /** Ids the selected keys resolve to in the loaded snapshot. */
  selectedIds(): readonly number[];
  start(): void;
  stop(): void;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (count, err) => count < 3 && (!isApiError(err) || err.retryable),
        retryDelay: (n, err) =>
          isApiError(err) && err.retryAfterS ? err.retryAfterS * 1000 : Math.min(8_000, 500 * 2 ** n),
        refetchOnWindowFocus: false,
      },
    },
  });
}

const defaultFetchers: SnapshotFetchers = {
  bootstrap: (signal) => api.bootstrap({ signal }),
  nodesBin: (signal) => api.nodesBin({ signal }),
  meshBin: (signal) => api.meshBin({ signal }),
};

/** The most selected nodes resolved at once (`?sel=` is user input). */
const MAX_SELECTED = 50;

export function createRuntime(
  opts: {
    live?: Partial<LiveClientOptions>;
    queryClient?: QueryClient;
    /** Snapshot fetchers (tests); the API by default. */
    snapshot?: SnapshotFetchers;
    /** Retry timing for a mixed-origin snapshot set (tests). */
    snapshotRetry?: Parameters<typeof fetchSnapshot>[2];
  } = {},
): AtlasRuntime {
  const queryClient = opts.queryClient ?? createQueryClient();
  const clock = new EventClock();
  let live: LiveClient | null = null;
  const store = new NetworkStore({
    onGap: (topic) => live?.requestResync(`gap:${topic}`),
    // Server time, so mempool first-seen times compare with block header times.
    now: () => clock.now(),
  });
  // Link builders and the watchlist resolve node keys against this session's table.
  setNodeKeySource(() => (store.loaded ? store.nodes : null));
  let forward: EffectSink = nullSink;
  const forwarding = new Proxy({} as EffectSink, {
    get: (_t, name: keyof EffectSink) => (cmd: never) => (forward[name] as (c: never) => void)(cmd),
  });
  const effects = recordingSink(() => Date.now(), { capacity: 300, forward: forwarding });
  const invalidate = createLiveInvalidator(queryClient);

  const choreo = new Choreographer(effects, {
    serverNow: () => clock.now(),
    tierOf: (id) => {
      const i = store.nodes.indexOf(id);
      if (i < 0) return null;
      return (['unknown', 'cumulus', 'nimbus', 'stratus'] as const)[store.nodes.tier[i] ?? 0] ?? null;
    },
    motion: effectiveMotion(useUi.getState().motion),
  });

  let selectedKeys: readonly string[] = [];
  let selected: readonly number[] = [];
  const resolveSelected = () => {
    const ids: number[] = [];
    if (store.loaded) {
      for (const k of selectedKeys.slice(0, MAX_SELECTED)) {
        const id = resolveNodeKey(store.nodes, k);
        if (id !== null && !ids.includes(id)) ids.push(id);
      }
    }
    selected = ids;
  };
  const syncFocus = () => {
    const watched = useUi.getState().watched;
    choreo.setFocus([...selected, ...watched]);
    live?.setWatch([...new Set([...selected, ...watched])].slice(0, 64));
  };

  const fetchers = opts.snapshot ?? defaultFetchers;

  /** Fetches bootstrap + nodes.bin + mesh.bin of one origin, loads them, and returns the resume seq. */
  async function resync(_reason: string, signal: AbortSignal): Promise<number> {
    const { bootstrap, nodes, mesh } = await fetchSnapshot(fetchers, signal, opts.snapshotRetry);
    const switches = store.instanceSwitches;
    store.loadSnapshot({ bootstrap, nodes, mesh });
    if (store.instanceSwitches !== switches) {
      // Another instance: ids in every cache mean other nodes now. Active queries refetch, the
      // rest are dropped.
      choreo.resetOrigin();
      queryClient.removeQueries({ type: 'inactive' });
      void queryClient.resetQueries();
    }
    // Stable keys to this origin's ids, before the new subscription sends `watch`.
    useUi.getState().resolveWatched(store.nodes);
    resolveSelected();
    syncFocus();
    queryClient.setQueryData(qk.bootstrap(), bootstrap);
    queryClient.setQueryData(qk.network.summary(), bootstrap.network);
    const tip = bootstrap.network.tip ?? bootstrap.blocks[0];
    if (tip) clock.setLastBlock(tip.height, tip.time_ms);
    void queryClient.invalidateQueries({ queryKey: qk.all(), refetchType: 'active' });
    return store.seq;
  }

  live = new LiveClient({
    resync,
    getResumeSeq: () => (store.loaded ? store.seq : null),
    getSnapshotOrigin: () => (store.loaded ? store.server : null),
    onMessage: (msg, received) => {
      store.apply(msg, received + (live?.clockOffsetMs ?? 0));
      if (msg.t === 'block') clock.setLastBlock(msg.height, msg.time_ms, msg.observed_ms);
      // A replayed block the bootstrap already lists has played (or was never seen): no choreography.
      if (msg.t !== 'block' || msg.seq > store.bootstrapSeq) choreo.handle(msg);
      invalidate(msg);
    },
    onStatus: (s) =>
      store.setConnection({
        status: s.status,
        sinceMs: s.status !== store.connection.status ? Date.now() : store.connection.sinceMs,
        attempt: s.attempt,
        retryAtMs: s.retryAtMs,
        lastCloseCode: s.lastCloseCode,
        lastError: s.lastError,
        server: s.server,
      }),
    onLatency: (l) => {
      clock.setOffset(l.clockOffsetMs);
      store.setConnection({ transitMs: l.transitMs, ingestMs: l.ingestMs, clockOffsetMs: l.clockOffsetMs });
    },
    ...opts.live,
  });

  const cleanups: (() => void)[] = [];

  return {
    store,
    live,
    clock,
    choreo,
    effects,
    queryClient,
    setEffectSink(sink) {
      forward = sink ?? nullSink;
    },
    setSelected(keys) {
      selectedKeys = [...keys];
      resolveSelected();
      syncFocus();
    },
    selectedIds() {
      return selected;
    },
    start() {
      live?.start();
      const pruneTimer = setInterval(() => store.prune(), 30_000);
      cleanups.push(() => clearInterval(pruneTimer));
      cleanups.push(
        useUi.subscribe((s, prev) => {
          if (s.motion !== prev.motion) choreo.setMotion(effectiveMotion(s.motion));
          if (s.watched !== prev.watched) syncFocus();
        }),
      );
      syncFocus();
      if (typeof document !== 'undefined') {
        const onVis = () => choreo.setVisible(document.visibilityState !== 'hidden');
        document.addEventListener('visibilitychange', onVis);
        cleanups.push(() => document.removeEventListener('visibilitychange', onVis));
        onVis();
      }
      if (typeof matchMedia === 'function') {
        const mq = matchMedia('(prefers-reduced-motion: reduce)');
        const onMq = () => choreo.setMotion(effectiveMotion(useUi.getState().motion));
        mq.addEventListener('change', onMq);
        cleanups.push(() => mq.removeEventListener('change', onMq));
      }
    },
    stop() {
      live?.stop();
      choreo.dispose();
      setNodeKeySource(null);
      for (const c of cleanups.splice(0)) c();
    },
  };
}
