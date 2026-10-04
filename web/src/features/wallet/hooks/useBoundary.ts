import { useCallback, useSyncExternalStore } from 'react';
import { useRuntime } from '../../../app/context';

/**
 * The event clock's time, rounded down to a multiple of `stepMs`: a number that changes once per step, so a
 * component that draws "now" as a geometry (the payout dial's marks drift as time passes) re-renders every few
 * seconds rather than every second.
 */
export function useBoundaryMs(stepMs: number): number {
  const { clock } = useRuntime();
  const subscribe = useCallback((cb: () => void) => clock.subscribe(cb), [clock]);
  const get = () => Math.floor(clock.tickTime / stepMs) * stepMs;
  return useSyncExternalStore(subscribe, get, get);
}
