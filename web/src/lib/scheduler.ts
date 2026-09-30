// Time source and timers behind one interface, so the live client, the choreographer and the event
// clock are deterministic under fake timers. The default reads the globals at call time, which is
// what `vi.useFakeTimers()` patches.

export type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

export interface Scheduler {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(h: TimerHandle | undefined): void;
}

export const realScheduler: Scheduler = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => {
    if (h !== undefined) globalThis.clearTimeout(h);
  },
};
