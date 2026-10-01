// Which things just arrived: the one way a view says "this row, this card is new" to the interaction language.
//
//   const fresh = useFresh(keys, { max: 3, scope: filter });
//   <li data-fresh={fresh.has(key) || undefined} data-fx="current">
//
// The engine answers an attribute that APPEARS on an element that already exists (`data-fresh`, see attach.ts);
// an element that is created carrying it fires nothing, and it would be wrong to make the engine look at every
// element React creates (that is a childList observer on the whole document, a cost the language refuses).
// `useFresh` is the contract that makes the order right: the element mounts without the attribute and takes it
// in a second commit, before the next paint, and it keeps it for the whole moment whatever else re-renders.
// It also decides what an arrival is: the first fill is history, a refill (a resync, a filter change, a burst
// of more than `max`) is not news, and a change of `scope` starts over.
//
// Rows that arrive by their own timestamp (`Date.now() - ts < 1800`) must not render `data-fresh` themselves:
// fresh.contract.test.ts reads the source of every view and fails on a `data-fresh=` that does not come from here.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** How long a key stays fresh by default: a little over the kit's wash (`--dur-fresh`, 1600 ms), so the two end together. */
export const FRESH_MS = 1800;

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
  /** How long a key stays fresh after it arrived (default 1800 ms). */
  ms?: number;
  /** More than this many keys at once is a refill, not an arrival (default: no limit). */
  max?: number;
  /** A change of scope (a filter, a mode) starts over: what the list shows next is a different list, not arrivals. */
  scope?: string;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * The keys that arrived within the last `ms`, as a set to read while rendering (`fresh.has(key)`) and to
 * write as `data-fresh`. `keys` must change identity only when the keys change (memoise it). Nothing is fresh
 * on the first fill.
 */
export function useFresh(
  keys: readonly string[],
  { ms = FRESH_MS, max, scope }: FreshOptions = {},
): ReadonlySet<string> {
  const seen = useRef<ReadonlySet<string> | null>(null);
  const scoped = useRef(scope);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const [fresh, setFresh] = useState<ReadonlySet<string>>(NONE);

  useLayoutEffect(() => {
    const changed = scoped.current !== scope;
    scoped.current = scope;
    const added = changed ? [] : arrivals(seen.current, keys, max);
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
  }, [keys, ms, max, scope]);

  useEffect(() => {
    const held = timers.current;
    return () => {
      for (const t of held) clearTimeout(t);
      held.clear();
    };
  }, []);

  return fresh;
}
