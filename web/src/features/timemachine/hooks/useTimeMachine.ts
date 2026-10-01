// Wires the time machine's controller to the app: the server's recorded range and curve, the globe's
// binding (archive in, present out), the URL (`?t=` and `?speed=`), and the page itself (the strip's
// height token, the archive flag on the root element). One hook, called once, by the view.

import { useNavigate } from '@tanstack/react-router';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { api } from '../../../api/endpoints';
import { useTimeline } from '../../../api/queries';
import { useRuntime } from '../../../app/context';
import { type GlobeBinding, useGlobeBinding } from '../../../globe';
import { useNow } from '../../../lib/useClock';
import { NodeTable } from '../../../store/nodeTable';
import { publishArchive } from '../../chrome/archive';
import { type Commit, TimeMachine, type TmEnv, type TmState } from '../lib/controller';
import type { Curve } from '../lib/curve';
import { momentAt } from '../lib/moment';
import { DAY, MINUTE, nearestSpeed, parseInstant, speedsFor, toUrlInstant } from '../lib/time';
import { useHistoryCurve } from './useHistoryCurve';

/** The playback speed a fresh visit starts at: a minute of history per second. */
export const DEFAULT_SPEED = 60;
/** How long the URL waits for the playhead to settle before it is rewritten. */
const URL_DEBOUNCE_MS = 350;
/** History this short is not worth scrubbing: the strip says it has only just started recording. */
const MIN_HISTORY_MS = 2 * MINUTE;
/** How often the moment on screen is told to the rest of the page while the playhead moves (30 fps, as the design's counters). */
const MOMENT_EVERY_MS = 33;

export interface TimeMachineData {
  tm: TimeMachine;
  state: TmState;
  /** Server time to the second; the right end of the strip. */
  now: number;
  /** The first instant worth showing, or null while the history is unknown or empty. */
  start: number | null;
  /** True once there is enough recorded history to scrub through. */
  ready: boolean;
  curve: Curve | null;
  curveLoading: boolean;
  speeds: readonly number[];
  /** The server's index of the recording failed to load. */
  indexError: boolean;
  retryIndex: () => void;
  /** Whether a globe is there to show the archive on. */
  hasGlobe: boolean;
  /** Leaves the time machine for the live globe. */
  leave: () => void;
}

export function useTimeMachine(urlT: string | undefined, urlSpeed: number | undefined): TimeMachineData {
  const { clock } = useRuntime();
  const now = useNow(clock);
  const binding = useGlobeBinding();
  const navigate = useNavigate();
  const timeline = useTimeline();

  // The environment reaches the globe through a ref, so a rebuilt globe never rebuilds the controller.
  const bindingRef = useRef<GlobeBinding | null>(binding);
  useLayoutEffect(() => {
    bindingRef.current = binding;
  }, [binding]);
  const [tm] = useState(() => {
    const env: TmEnv = {
      now: () => clock.now(),
      fetchState: (t, signal) => api.timelineState(t, { signal }),
      apply: (table) => bindingRef.current?.setArchive(table),
      buildTable: (bin) => NodeTable.fromSnapshot(bin),
      frame: (cb) => {
        const id = requestAnimationFrame(cb);
        return () => cancelAnimationFrame(id);
      },
      timer: (cb, ms) => {
        const id = setTimeout(cb, ms);
        return () => clearTimeout(id);
      },
    };
    return new TimeMachine(env);
  });
  const state = useSyncExternalStore(tm.subscribe, tm.getState, tm.getState);

  // The recorded range. The curve, when it has one, knows where the first full recording begins: the
  // first seconds after the server started hold a partial load of the node list.
  const first = timeline.data?.first_ms ?? null;
  const { curve, isPending: curveLoading } = useHistoryCurve(first, now);
  const start = curve ? Math.max(curve.first, first ?? curve.first) : first === null ? null : first + MINUTE;
  const ready = start !== null && now - start >= MIN_HISTORY_MS;
  const span = start === null ? 0 : now - start;
  const spanTier = span >= 10 * DAY ? 2 : span >= 2 * DAY ? 1 : 0;
  const speeds = useMemo(
    () => speedsFor(spanTier === 2 ? 10 * DAY : spanTier === 1 ? 2 * DAY : 0),
    [spanTier],
  );

  useEffect(() => {
    if (start !== null) tm.setRange(start, now);
  }, [tm, start, now]);

  // Attach for the life of the view; leaving brings the present back to the globe.
  useEffect(() => {
    tm.attach();
    return () => tm.detach();
  }, [tm]);

  // A globe rebuilt after a lost context starts from the live nodes: put the archive back on it.
  useEffect(() => {
    if (binding) tm.reapply();
  }, [binding, tm]);

  // ---- the URL ----------------------------------------------------------------------------------

  // What this view last wrote, so its own URL change is not read back as somebody else's.
  const written = useRef<{ t: string | null } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const write = useCallback(
    (c: Commit) => {
      const t = c.t === null ? null : toUrlInstant(c.t);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        written.current = { t };
        void navigate({
          to: '.',
          replace: true,
          search: (prev: Record<string, unknown>) => ({
            ...prev,
            t: t ?? undefined,
            speed: c.speed === DEFAULT_SPEED ? undefined : c.speed,
          }),
        } as never);
      }, URL_DEBOUNCE_MS);
    },
    [navigate],
  );
  useEffect(() => {
    const off = tm.subscribeCommit(write);
    return () => {
      off();
      clearTimeout(timer.current);
    };
  }, [tm, write]);

  // The URL's instant and speed set the view when they arrive from outside (a link, the palette, a
  // reload), once the recorded range is known.
  const appliedSpeed = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!ready) return;
    if (urlSpeed !== appliedSpeed.current) {
      appliedSpeed.current = urlSpeed;
      tm.setSpeed(nearestSpeed(urlSpeed, speeds, DEFAULT_SPEED));
    }
  }, [ready, urlSpeed, speeds, tm]);
  useEffect(() => {
    if (!ready) return;
    const echo = written.current;
    if (echo && echo.t === (urlT ?? null)) return;
    const at = parseInstant(urlT);
    if (at !== null) tm.settle(at);
    else if (urlT === undefined && tm.getState().mode === 'archive' && echo) tm.goLive();
  }, [ready, urlT, tm]);

  // ---- the page ---------------------------------------------------------------------------------

  // The shell's timeline strip grows to its open height while this view is on screen.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--timeline-h', 'var(--timeline-h-open)');
    return () => {
      root.style.removeProperty('--timeline-h');
    };
  }, []);

  // Everything else on the page can tell the archive is showing (the Pulse pauses, the Beat reads
  // "t minus") without knowing about this feature.
  const archive = state.mode === 'archive';
  useEffect(() => {
    const root = document.documentElement;
    if (archive) root.dataset.archive = 'on';
    else delete root.dataset.archive;
    return () => {
      delete root.dataset.archive;
    };
  }, [archive]);

  // And which moment: `data-archive-at` (the playhead, unix ms) with the tip height and the node count the
  // recording holds for it (features/chrome/archive.ts is the contract). The Beat and the status bar read them;
  // "Return to live" removes them. The playhead moves every frame, so the page is told at most every 33 ms.
  const shown = useRef({ curve, info: state.info });
  useLayoutEffect(() => {
    shown.current = { curve, info: state.info };
  }, [curve, state.info]);
  useEffect(() => {
    if (!archive) return;
    const root = document.documentElement;
    let last = Number.NEGATIVE_INFINITY;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      timer = undefined;
      last = performance.now();
      publishArchive(root, momentAt(tm.getT(), shown.current.curve, shown.current.info));
    };
    const soon = () => {
      const wait = last + MOMENT_EVERY_MS - performance.now();
      if (wait <= 0) flush();
      else if (timer === undefined) timer = setTimeout(flush, wait);
    };
    flush();
    const offT = tm.subscribeT(soon);
    const offState = tm.subscribe(soon);
    return () => {
      offT();
      offState();
      clearTimeout(timer);
      publishArchive(root, null);
    };
  }, [archive, tm]);
  // A reading that arrives while the playhead rests (the history, the moment's own count) is told as it comes.
  useEffect(() => {
    if (archive) publishArchive(document.documentElement, momentAt(tm.getT(), curve, state.info));
  }, [archive, tm, curve, state.info]);

  const leave = useCallback(() => {
    void navigate({ to: '/' } as never);
  }, [navigate]);

  return {
    tm,
    state,
    now,
    start,
    ready,
    curve,
    curveLoading,
    speeds,
    indexError: timeline.isError,
    retryIndex: () => void timeline.refetch(),
    hasGlobe: binding !== null,
    leave,
  };
}
