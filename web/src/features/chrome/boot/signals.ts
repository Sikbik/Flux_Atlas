// The boot's real signals: when each stage's condition first held. Nothing is invented. The first byte and the
// end of the bootstrap request come from the browser's own resource timing; the snapshot is in when the store
// says it is loaded; the globe is up when its status leaves `loading`; the stream is open when the live client
// says `live`. The collector only records the first time each condition is seen true, in order of the boot
// clock; the timeline decides what to show.

import { type BootSignals, detectFailure, type StageId } from './model';

export interface Observed {
  /** True once the snapshot (bootstrap, nodes, mesh) has been loaded into the store. */
  loaded: boolean;
  /** The live client's status (`syncing`, `connecting`, `live`, `offline`...). */
  status: string;
  /** `loading` until the globe engine is up (or has failed to start). */
  globe: 'loading' | 'ready' | 'unsupported' | 'error';
}

export interface Marks {
  /** Milliseconds from the bootstrap request to its first byte, and when that first byte came (boot clock). */
  ttfbMs?: number;
  bootstrapStart?: number;
}

/** What the browser's resource timing says about the bootstrap request: Atlas has answered. */
export function readMarks(entries: readonly PerformanceEntry[]): Marks {
  const e = entries.find((x) => /\/bootstrap(?:[?#]|$)/.test(x.name) && 'responseStart' in x) as
    | PerformanceResourceTiming
    | undefined;
  if (!e || !(e.responseStart > 0)) return {};
  const marks: Marks = { bootstrapStart: e.responseStart };
  if (e.requestStart > 0) marks.ttfbMs = Math.max(0, Math.round(e.responseStart - e.requestStart));
  return marks;
}

export class BootSignalCollector {
  readonly done: BootSignals['done'] = {};
  loadedAt: number | null = null;
  retriedAt: number | null = null;
  marks: Marks = {};

  constructor(private readonly startMs: number) {}

  retry(now: number): void {
    this.retriedAt = now;
  }

  /** Looks at the world at `now` (boot clock) and records every stage whose condition has just become true. */
  observe(now: number, o: Observed, marks: Marks): BootSignals {
    this.marks = marks;
    const mark = (id: StageId, held: boolean, at = now) => {
      if (held && this.done[id] === undefined) this.done[id] = Math.min(now, at);
    };
    const live = o.status === 'live';
    mark('connect', marks.bootstrapStart !== undefined || o.loaded || live, marks.bootstrapStart);
    if (o.loaded && this.loadedAt === null) this.loadedAt = now;
    const globeUp = o.globe !== 'loading';
    // The tip, the nodes, the hosts and the apps all arrive in the one snapshot. The pieces of the symbol are
    // drawn by the globe, so the stages that bring them wait for it as well: nothing lands in the dark.
    mark('tip', o.loaded && globeUp);
    mark('nodes', o.loaded && globeUp);
    mark('hosts', o.loaded && globeUp);
    mark('apps', o.loaded && globeUp);
    mark('sun', globeUp);
    mark('stream', live && o.loaded);
    const failed = detectFailure(
      {
        nowMs: now,
        startMs: this.startMs,
        loadedAtMs: this.loadedAt,
        live: live && o.loaded,
        status: o.status,
        retriedAtMs: this.retriedAt,
      },
      this.done,
    );
    return { done: this.done, failed };
  }
}
