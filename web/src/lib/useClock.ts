// React bindings for the shared event clock. Snapshots are formatted strings or tick times, so a
// component re-renders only when its visible text changes (an age past one minute changes once a
// minute even though the clock ticks every second).

import { useCallback, useSyncExternalStore } from 'react';
import type { BeatState, EventClock } from './clock';
import { formatAge, formatAgo } from './format';

/** Server time of the latest tick; re-renders once per second. */
export function useNow(clock: EventClock): number {
  const subscribe = useCallback((cb: () => void) => clock.subscribe(cb), [clock]);
  return useSyncExternalStore(
    subscribe,
    () => clock.tickTime,
    () => clock.tickTime,
  );
}

/** `12 s ago` for a timestamp; re-renders only when the label changes. */
export function useAgo(clock: EventClock, ts: number | null | undefined, suffix = true): string | null {
  const subscribe = useCallback((cb: () => void) => clock.subscribe(cb), [clock]);
  const get = () => {
    if (ts === null || ts === undefined) return null;
    const age = Math.max(0, clock.now() - ts);
    return suffix ? formatAgo(age) : formatAge(age);
  };
  return useSyncExternalStore(subscribe, get, get);
}

/** The next-block beat, recomputed once per tick. */
export function useBeat(clock: EventClock): BeatState {
  const t = useNow(clock);
  return clock.beat(t);
}
