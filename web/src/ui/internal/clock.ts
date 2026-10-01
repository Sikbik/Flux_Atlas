// The kit's access to the shared 1 Hz event clock (lib/clock.ts). Inside the app this is the
// runtime's server-corrected clock, so every "12 s ago" label ticks together; outside it (unit
// tests, isolated demos) a module-level fallback clock keeps components working.

import { useRuntime } from '../../app/context';
import { EventClock } from '../../lib/clock';
import { useNow } from '../../lib/useClock';

let fallback: EventClock | undefined;

/** The runtime's event clock, or a shared fallback clock when no runtime is mounted. */
export function useKitClock(): EventClock {
  try {
    // biome-ignore lint/correctness/useHookAtTopLevel: useRuntime reads its context before it throws, so the hook order is the same on every render
    return useRuntime().clock;
  } catch {
    fallback ??= new EventClock();
    return fallback;
  }
}

/** Server time of the latest tick on the kit clock; re-renders once per second. */
export function useKitNow(): number {
  return useNow(useKitClock());
}
