// React bindings for the NetworkStore: `useSyncExternalStore` with a selector and an equality
// function. The selector runs when the store version moved (or the selector changed); if the new
// selection equals the previous one, the previous reference is returned and nothing re-renders.

import { useRef, useSyncExternalStore } from 'react';
import type { NetworkStore } from './network';

export type Equality<T> = (a: T, b: T) => boolean;

/** Shallow equality for arrays and plain objects. */
export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

interface Memo<T> {
  version: number;
  selector: (s: NetworkStore) => T;
  value: T;
}

/**
 * Selects a value from the store. Selectors may read mutable data (typed arrays), so select
 * primitives, slice versions, or the store's version-cached arrays (`blocks.toArray()`,
 * `appList()`), or pass an equality such as `shallowEqual`.
 */
export function useStoreSelector<T>(
  store: NetworkStore,
  selector: (s: NetworkStore) => T,
  equal: Equality<T> = Object.is,
): T {
  const memo = useRef<Memo<T> | null>(null);
  const getSnapshot = (): T => {
    const cur = memo.current;
    if (cur && cur.version === store.version && cur.selector === selector) return cur.value;
    const next = selector(store);
    const value = cur && equal(cur.value, next) ? cur.value : next;
    memo.current = { version: store.version, selector, value };
    return value;
  };
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
