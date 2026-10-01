// The quiet ticker at the edge of ambient mode: a few lines about what the network just did (a node
// joined, an app was deployed, a version milestone), one new line every few seconds at most, each fading
// out by itself. The reducers here are pure; the component owns the clock.

import type { FeedKind } from '../../api/generated/FeedKind';

/** What is worth a line. Check-ins, payments and apps waiting for a block are noise at this distance. */
export const TICKER_KINDS: ReadonlySet<FeedKind> = new Set<FeedKind>([
  'node_joined',
  'node_started',
  'node_left',
  'node_expired',
  'node_recovered',
  'node_dosed',
  'collateral_spent',
  'app_deployed',
  'app_updated',
  'app_expired',
  'version_milestone',
  'large_transfer',
  'reorg',
  'reward_reduction',
]);

/** Rows on screen at once. */
export const TICKER_ROWS = 3;
/** The least time between one new row and the next. */
export const TICKER_GAP_MS = 6_000;
/** How long a row stays before it fades away. */
export const TICKER_LIFE_MS = 28_000;
/** Rows waiting their turn; a burst keeps the newest. */
const QUEUE_MAX = 6;

export interface TickerEntry {
  seq: number;
  kind: FeedKind;
}

export interface TickerRow {
  key: number;
  text: string;
  bornMs: number;
}

export interface TickerState {
  /** The newest feed sequence seen; -1 before the first look. */
  lastSeq: number;
  queue: readonly { key: number; text: string }[];
  /** Newest first. */
  rows: readonly TickerRow[];
  lastShownMs: number;
}

export const emptyTicker = (): TickerState => ({
  lastSeq: -1,
  queue: [],
  rows: [],
  lastShownMs: Number.NEGATIVE_INFINITY,
});

/**
 * Takes in the feed's newest-first entries. The first look only notes where the feed stands, so opening
 * ambient mode never replays history; after that, each new entry of a worthwhile kind joins the queue.
 */
export function ingest<E extends TickerEntry>(
  state: TickerState,
  entries: readonly E[],
  render: (entry: E) => string,
): TickerState {
  const newest = entries[0]?.seq ?? state.lastSeq;
  if (state.lastSeq < 0) return { ...state, lastSeq: newest };
  const fresh: { key: number; text: string }[] = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (!e || e.seq <= state.lastSeq) continue;
    if (TICKER_KINDS.has(e.kind)) fresh.push({ key: e.seq, text: render(e) });
  }
  if (fresh.length === 0 && newest === state.lastSeq) return state;
  return {
    ...state,
    lastSeq: Math.max(newest, state.lastSeq),
    queue: [...state.queue, ...fresh].slice(-QUEUE_MAX),
  };
}

/** Moves time on: rows past their life go, and one waiting entry comes in if the gap has passed. */
export function tick(state: TickerState, nowMs: number): TickerState {
  let rows = state.rows.filter((r) => nowMs - r.bornMs < TICKER_LIFE_MS);
  let { queue, lastShownMs } = state;
  const next = queue[0];
  if (next && nowMs - lastShownMs >= TICKER_GAP_MS) {
    rows = [{ key: next.key, text: next.text, bornMs: nowMs }, ...rows].slice(0, TICKER_ROWS);
    queue = queue.slice(1);
    lastShownMs = nowMs;
  }
  if (rows.length === state.rows.length && queue === state.queue && rows.every((r, i) => r === state.rows[i]))
    return state;
  return { ...state, rows, queue, lastShownMs };
}
