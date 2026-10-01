import { useEffect, useMemo, useRef } from 'react';
import { type Debounced, debounce } from './debounce';

/**
 * A stable debounced wrapper around the latest `fn`. Pending calls are dropped on unmount, and a
 * change of `waitMs` starts a fresh debouncer. Call `.flush()` to run a pending call right away.
 */
export function useDebouncedCallback<A extends unknown[]>(
  fn: ((...args: A) => void) | undefined,
  waitMs: number,
): Debounced<A> {
  const latest = useRef(fn);
  latest.current = fn;
  const debounced = useMemo(() => debounce((...args: A) => latest.current?.(...args), waitMs), [waitMs]);
  useEffect(() => () => debounced.cancel(), [debounced]);
  return debounced;
}
