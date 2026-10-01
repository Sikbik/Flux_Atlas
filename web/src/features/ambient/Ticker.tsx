// The quiet ticker at the lower right of ambient mode: what the network just did, a line at a time.
// Rows sit at fixed slots, the newest at the bottom edge, and rise a slot (a transform) when a newer one
// arrives; the oldest fades by itself before it is removed, and nothing here ever changes the layout.

import { useEffect, useRef, useState } from 'react';
import { useNetwork, useRuntime } from '../../app/context';
import { useNow } from '../../lib/useClock';
import { feedSentence } from '../command/feedText';
import { emptyTicker, ingest, TICKER_LIFE_MS, tick } from './ticker';

/** The last seconds of a row's life, spent fading out. */
const FADE_MS = 3_000;

export function Ticker() {
  const { clock, store } = useRuntime();
  const feed = useNetwork((s) => s.feed.toArray());
  const now = useNow(clock);
  const [state, setState] = useState(emptyTicker);
  const nowRef = useRef(now);
  nowRef.current = now;

  // New feed entries join the queue (the first look only notes where the feed stands).
  useEffect(() => {
    setState((s) =>
      ingest(
        s,
        feed.map((f) => ({ seq: f.seq, kind: f.item.kind, item: f.item })),
        (e) => feedSentence(store, e.item).text,
      ),
    );
  }, [feed, store]);

  // Time moves on once a second: a waiting entry comes in, an old one goes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `now` is the clock tick this effect follows
  useEffect(() => {
    setState((s) => tick(s, nowRef.current));
  }, [now]);

  return (
    <ol className="amb-ticker" aria-hidden="true">
      {state.rows.map((r, i) => (
        <li
          key={r.key}
          className="amb-row"
          style={{ ['--i' as string]: i }}
          data-fading={now - r.bornMs > TICKER_LIFE_MS - FADE_MS ? '' : undefined}
        >
          {r.text}
        </li>
      ))}
      {/* Reserve the block's height so the rows never move the layout. */}
      <li className="amb-row-gauge" />
    </ol>
  );
}
