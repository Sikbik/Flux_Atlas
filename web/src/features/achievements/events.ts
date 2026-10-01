// Achievement events: the facts the app tells the achievement engine about. Anyone may `track()` one
// (the palette, the terminal, ambient mode); the engine itself lives in a lazy chunk, so events sent
// before it has loaded wait in a short queue and are replayed when it subscribes.
//
// Nothing here knows what an achievement is. The tracker (`tracker.ts`) turns the route, the live
// store and the engine's events into these facts, and the catalogue (`catalog.ts`) decides what they
// are worth.

export type UiWhat =
  | 'art'
  | 'motion'
  | 'perf'
  | 'layer'
  | 'filter'
  | 'sound'
  | 'copy'
  | 'fly'
  | 'notifications'
  | 'idle';

export type AchievementEvent =
  /** The URL changed (every resolved navigation, once). */
  | { type: 'route'; pathname: string; search: Readonly<Record<string, unknown>> }
  /** A node was opened; `continent` is where it lives, when it has a location. */
  | { type: 'node.focus'; id: number; continent: string | null }
  /** A live block landed. */
  | {
      type: 'block';
      height: number;
      /** The tab was visible when it landed. */
      watching: boolean;
      /** A watched node was paid in this block. */
      paidWatched: boolean;
      /** The node the user had open, selected or watched was paid in this block. */
      paidFocused: boolean;
      /** That payee had been announced as a next payee before the block arrived. */
      announcedFirst: boolean;
    }
  /** The globe's zoom band changed (0 world, 3 city). */
  | { type: 'zoom'; band: number }
  /** The watchlist changed; `count` is its size now. */
  | { type: 'watched'; count: number }
  | { type: 'palette'; action: 'open'; via: 'key' | 'url' }
  | { type: 'palette'; action: 'run'; kind: string }
  | { type: 'ui'; what: UiWhat; value?: string }
  /** A terminal command ran (`streams` for `tail`). */
  | { type: 'terminal'; name: string; ok: boolean; streams: boolean }
  | { type: 'ambient'; action: 'enter' | 'exit'; via: 'idle' | 'manual' | 'kiosk' }
  /** Seconds of ambient mode in this run so far (reported every half minute). */
  | { type: 'ambient.seconds'; seconds: number }
  | { type: 'moon'; what: 'click' | 'replay' }
  /** The page was open and watching when a block took more than 35 seconds. */
  | { type: 'late' }
  /** The live stream dropped and came back without a reload. */
  | { type: 'reconnected' }
  /** The first reward cut landed while the page was open. */
  | { type: 'cut' }
  | { type: 'egg' };

type Listener = (e: AchievementEvent) => void;

const listeners = new Set<Listener>();
const queue: AchievementEvent[] = [];
const QUEUE_MAX = 64;

/** Tells the engine something happened. Cheap enough to call anywhere; without a listener it waits in the queue. */
export function track(e: AchievementEvent): void {
  if (listeners.size === 0) {
    if (queue.length >= QUEUE_MAX) queue.shift();
    queue.push(e);
    return;
  }
  for (const l of listeners) l(e);
}

/** Subscribes the engine; events that arrived earlier are replayed first. Returns the unsubscribe. */
export function onAchievementEvent(l: Listener): () => void {
  listeners.add(l);
  if (queue.length > 0) {
    const pending = queue.splice(0, queue.length);
    for (const e of pending) l(e);
  }
  return () => {
    listeners.delete(l);
  };
}
