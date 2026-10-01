// Which things just arrived (design 6.4 F, 8.13): a block's card on the rail, a row in the Pulse. A new one
// carries `data-fresh` for a moment, and the attribute is added to an element that is already in the document:
// the element mounts without it and takes it in a second commit, before the next paint. That is the order the
// motion language reads (an attribute that appears on an element that exists means "something arrived"; an element
// that is created with it does not), and it keeps the state alive for the whole moment whatever else re-renders.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * The keys in `next` that were not in `prev`, when that is a handful: a live block landing, a row arriving.
 * The first fill (nothing seen yet) and a refill (a resync, a filter change: more than `max` at once) are not
 * arrivals and return nothing.
 */
export function arrivals(
  prev: ReadonlySet<string> | null,
  next: readonly string[],
  max = Number.POSITIVE_INFINITY,
): string[] {
  if (!prev || prev.size === 0) return [];
  const added = next.filter((k) => !prev.has(k));
  return added.length > 0 && added.length <= max ? added : [];
}

export interface FreshOptions {
  /** How long a key stays fresh after it arrived. */
  ms: number;
  /** More than this many keys at once is a refill, not an arrival. */
  max?: number;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * The keys that arrived within the last `ms`, as a set to read while rendering (`fresh.has(key)`). `keys` must
 * change identity only when the keys change (memoise it). Nothing is fresh on the first fill.
 */
export function useFreshKeys(keys: readonly string[], { ms, max }: FreshOptions): ReadonlySet<string> {
  const seen = useRef<ReadonlySet<string> | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const [fresh, setFresh] = useState<ReadonlySet<string>>(NONE);

  useLayoutEffect(() => {
    const added = arrivals(seen.current, keys, max);
    seen.current = new Set(keys);
    if (added.length === 0) return;
    setFresh((cur) => new Set([...cur, ...added]));
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setFresh((cur) => {
        const next = new Set(cur);
        for (const k of added) next.delete(k);
        return next;
      });
    }, ms);
    timers.current.add(timer);
  }, [keys, ms, max]);

  useEffect(() => {
    const held = timers.current;
    return () => {
      for (const t of held) clearTimeout(t);
      held.clear();
    };
  }, []);

  return fresh;
}
