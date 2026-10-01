// Which rows of a live list just arrived, for the table's white wash. One timeout per batch of
// arrivals (not a poll, not a timer per row); the first render never highlights anything.

import { useEffect, useState } from 'react';
import { arrivedKeys } from './liveList';

type Key = string | number;

interface Tracked<Row> {
  rows: readonly Row[];
  seen: ReadonlySet<Key>;
  fresh: ReadonlySet<Key>;
}

const NONE: ReadonlySet<Key> = new Set();

/**
 * The keys of rows that appeared since the previous render, kept for `ttlMs` (default a little over
 * `--dur-fresh`), to pass as `highlightKeys`. A live list passes the whole current array every time;
 * rows already shown never highlight again, and rows scrolled back into view do not either.
 *
 *     const fresh = useFreshKeys(blocks, (b) => b.height);
 *     <DataTable rows={blocks} rowKey={(b) => b.height} highlightKeys={fresh} ... />
 */
export function useFreshKeys<Row>(
  rows: readonly Row[],
  rowKey: (row: Row) => Key,
  ttlMs = 1800,
): ReadonlySet<Key> {
  const [state, setState] = useState<Tracked<Row>>(() => ({
    rows,
    seen: new Set(rows.map(rowKey)),
    fresh: NONE,
  }));

  // Derive during render (React re-renders immediately, before commit) so a new row is highlighted
  // on its very first paint instead of popping in and then flashing.
  let current = state;
  if (state.rows !== rows) {
    const arrived = arrivedKeys(state.seen, rows, rowKey);
    current = {
      rows,
      seen: new Set(rows.map(rowKey)),
      fresh: arrived.length === 0 ? state.fresh : new Set([...state.fresh, ...arrived]),
    };
    setState(current);
  }

  const fresh = current.fresh;
  useEffect(() => {
    if (fresh.size === 0) return;
    const id = setTimeout(() => {
      setState((s) => (s.fresh === fresh ? { ...s, fresh: NONE } : s));
    }, ttlMs);
    return () => clearTimeout(id);
  }, [fresh, ttlMs]);

  return fresh;
}
