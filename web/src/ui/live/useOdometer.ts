// The state machine behind AnimatedNumber: takes the stream of values, rate-limits it, classifies
// each visible update (roll, count up, swap) and publishes a small view for the component to draw.
// The controller is plain TypeScript with injected host callbacks, so it runs under fake timers
// without React; `useOdometer` only wires it to component state.
//
// Rate limiting is event-driven, not polled: the first update shows at once, an update inside the
// minimum interval arms exactly one trailing timeout (the latest value wins), and nothing runs while
// the value is still.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { UNKNOWN } from '../../lib/format';
import type { MotionMode } from '../internal/useMotion';
import {
  type Cell,
  COUNT_UP_MS,
  classifyChange,
  coalesce,
  countUpValue,
  minIntervalMs,
  planCells,
  type RollDirection,
} from './odometer';

export interface OdometerOptions {
  /** Formats a number for display (the default is `formatInt`). */
  format: (n: number) => string;
  /** Roll changed digits; false swaps instantly. */
  roll: boolean;
  /** Tint the number by direction after an update. */
  tint: boolean;
  /** Most visual updates per second; 0 shows every update. */
  maxHz: number;
  /** Count up from zero when the first number arrives. */
  countUpOnMount: boolean;
  /** Only `full` rolls and counts up; `reduced` swaps and tints; `off` swaps. */
  mode: MotionMode;
}

/** What the component draws. */
export interface OdometerView {
  /** The committed value; null renders Unknown. */
  target: number | null;
  /** Text of a count-up frame in progress, null when settled (the text then derives from `target`). */
  frame: string | null;
  /** The cell plan of the latest roll with the text it was planned for. */
  plan: { text: string; cells: Cell[] } | null;
  /** The way the latest roll went (up or down), null when nothing rolls. */
  dir: RollDirection | null;
  /** Tint direction of the latest update; null shows no tint. */
  tint: RollDirection | null;
  /** Increments with every visible update; keys the animated wrapper so its animations restart. */
  seq: number;
}

export interface OdometerHost {
  /** The latest options (read when an update is applied, not when it is scheduled). */
  options(): OdometerOptions;
  /** Publishes a new view (a React state updater). */
  set(update: (v: OdometerView) => OdometerView): void;
}

const finite = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** True when the first paint should start from zero and count up. */
export function startsFromZero(value: number | null, o: OdometerOptions): boolean {
  return value !== null && o.countUpOnMount && o.mode === 'full' && o.roll;
}

/** The view for the first render: the value itself, with no animation (or `0` when counting up). */
export function initialView(value: number | null, o: OdometerOptions): OdometerView {
  return {
    target: value,
    frame: startsFromZero(value, o) ? o.format(0) : null,
    plan: null,
    dir: null,
    tint: null,
    seq: 0,
  };
}

export class OdometerController {
  /** The numeric value the display reflects right now (an interpolated value during a count-up). */
  private shown: number | null;
  /** The text on screen. */
  private text: string;
  /** The committed target; undefined before anything has been committed. */
  private target: number | null | undefined;
  /** True until a number has been shown. */
  private first: boolean;
  private lastAt: number | null = null;
  private latest: number | null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private raf: number | undefined;
  /** Where the running count-up began, so a remount can start it over. */
  private counting: { from: number; first: boolean } | null = null;

  constructor(
    private readonly host: OdometerHost,
    initial: number | null,
  ) {
    const o = host.options();
    const counting = startsFromZero(initial, o);
    this.latest = initial;
    this.shown = counting ? null : initial;
    this.target = counting ? undefined : initial;
    this.first = counting || initial === null;
    this.text = counting ? o.format(0) : initial === null ? UNKNOWN : o.format(initial);
  }

  /** A new value from the owner. Cheap when nothing changes; at most one timeout is ever armed. */
  push(value: number | null): void {
    this.latest = value;
    if (this.timer !== undefined) return;
    if (value === this.target) return;
    const d = coalesce(Date.now(), this.lastAt, minIntervalMs(this.host.options().maxHz));
    if (d.commitNow) {
      this.commit(value);
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.latest !== this.target) this.commit(this.latest);
    }, d.waitMs);
  }

  /**
   * Stops timers and frames. A count-up in progress is rewound to its start and its target forgotten,
   * so when React re-runs the effects (strict mode, a remount) the next `push` plays it again.
   */
  dispose(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.raf !== undefined) {
      this.stopCount();
      const c = this.counting;
      this.counting = null;
      this.target = undefined;
      this.lastAt = null;
      if (c) {
        this.shown = c.from;
        this.text = this.host.options().format(c.from);
        this.first = c.first;
      }
    }
  }

  private stopCount(): void {
    if (this.raf !== undefined) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf);
      this.raf = undefined;
    }
  }

  private settle(): void {
    this.counting = null;
    const t = this.target ?? null;
    this.shown = t;
    this.text = t === null ? UNKNOWN : this.host.options().format(t);
    this.host.set((v) => (v.frame === null ? v : { ...v, frame: null }));
  }

  private commit(value: number | null): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.stopCount();
    const o = this.host.options();
    const before = this.text;
    const nextText = value === null ? UNKNOWN : o.format(value);
    const t = classifyChange({
      prev: this.shown,
      next: value,
      prevText: before,
      nextText,
      animate: o.mode === 'full' && o.roll,
      countUpFirst: o.countUpOnMount,
      first: this.first,
    });
    const tint = o.mode === 'off' || !o.tint || t.silent ? null : t.dir;
    const now = Date.now();

    if (t.kind === 'none') {
      this.shown = value;
      this.target = value;
      this.host.set((v) =>
        v.frame === null && v.target === value ? v : { ...v, target: value, frame: null },
      );
      return;
    }
    if (t.kind === 'count' && value !== null && typeof requestAnimationFrame === 'function') {
      this.count(t.from ?? this.shown ?? 0, value, t.dir, tint, now);
      return;
    }

    this.shown = value;
    this.target = value;
    this.text = nextText;
    this.lastAt = now;
    if (value !== null) this.first = false;
    if (t.kind === 'roll' && t.dir) {
      const dir = t.dir;
      const plan = { text: nextText, cells: planCells(before, nextText) };
      this.host.set((v) => ({ target: value, frame: null, plan, dir, tint, seq: v.seq + 1 }));
      return;
    }
    this.host.set((v) => ({
      target: value,
      frame: null,
      plan: null,
      dir: null,
      tint,
      seq: tint ? v.seq + 1 : v.seq,
    }));
  }

  private count(
    from: number,
    to: number,
    dir: RollDirection | null,
    tint: RollDirection | null,
    now: number,
  ) {
    const format = () => this.host.options().format;
    this.counting = { from, first: this.first };
    this.target = to;
    this.first = false;
    this.lastAt = now;
    this.shown = from;
    const startText = format()(from);
    this.text = startText;
    this.host.set((v) => ({ target: to, frame: startText, plan: null, dir, tint, seq: v.seq + 1 }));
    let t0: number | undefined;
    const step = (ts: number) => {
      t0 ??= ts;
      const elapsed = ts - t0;
      if (elapsed >= COUNT_UP_MS) {
        this.raf = undefined;
        this.settle();
        return;
      }
      const cur = countUpValue(from, to, elapsed);
      const text = format()(cur);
      this.shown = cur;
      if (text !== this.text) {
        this.text = text;
        this.host.set((v) => ({ ...v, frame: text }));
      }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }
}

/**
 * Drives a number ticker: returns the view to draw and applies design 6.4 D to each new value.
 * `value` may be null or undefined (Unknown). Updates are rate-limited by `maxHz`.
 */
export function useOdometer(value: number | null | undefined, o: OdometerOptions): OdometerView {
  const incoming = finite(value);
  const optsRef = useRef(o);
  const [view, setView] = useState<OdometerView>(() => initialView(incoming, o));
  const [ctl] = useState(
    () => new OdometerController({ options: () => optsRef.current, set: (fn) => setView(fn) }, incoming),
  );
  useLayoutEffect(() => {
    optsRef.current = o;
  });
  useEffect(() => {
    ctl.push(incoming);
  }, [ctl, incoming]);
  useEffect(() => () => ctl.dispose(), [ctl]);
  return view;
}
