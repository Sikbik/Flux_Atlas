// A small trailing-edge debounce for UI input handling (a search box that reports once typing
// pauses). It is not data polling: nothing here schedules network work on its own.

export interface Debounced<A extends unknown[]> {
  /** Schedules `fn` with these arguments; a later call within the wait replaces this one. */
  (...args: A): void;
  /** Runs a pending call now. Does nothing when nothing is pending. */
  flush(): void;
  /** Drops a pending call. */
  cancel(): void;
  /** True while a call is waiting. */
  pending(): boolean;
}

/** Trailing-edge debounce: `fn` runs once, `waitMs` after the last call, with that call's arguments. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, waitMs: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastArgs: A | undefined;

  const run = () => {
    timer = undefined;
    const args = lastArgs;
    lastArgs = undefined;
    if (args) fn(...args);
  };

  const debounced = ((...args: A) => {
    lastArgs = args;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(run, waitMs);
  }) as Debounced<A>;

  debounced.flush = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    run();
  };
  debounced.cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    lastArgs = undefined;
  };
  debounced.pending = () => timer !== undefined;
  return debounced;
}
