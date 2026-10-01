// The effect host: one overlay layer, one budget, one animation driver. Effects are plain functions
// that take an `Fx`, ask it for a `Run` (a budget lease plus everything to tear down), draw, and let
// the run finish itself. Nothing exists before an effect starts and nothing is left after it ends.

import { Budget, type FxKind, type Lease } from '../budget';
import { type MotionMode, modeOf } from '../mode';
import '../motion.css';
import './fx.css';

/** What the runners need from an animation: when it ends, and a way to stop it. */
export interface Anim {
  readonly finished: Promise<unknown>;
  cancel(): void;
}

export type Animate = (
  el: Element,
  keyframes: Keyframe[] | PropertyIndexedKeyframes,
  options: KeyframeAnimationOptions,
) => Anim;

const NOOP_ANIM: Anim = { finished: Promise.resolve(), cancel() {} };

/** The browser's Web Animations API; a no-op where it does not exist (old engines, jsdom). */
export const nativeAnimate: Animate = (el, keyframes, options) =>
  typeof (el as HTMLElement).animate === 'function'
    ? (el as HTMLElement).animate(keyframes, options)
    : NOOP_ANIM;

export type CometKind = 'streak' | 'head' | 'seg';

export interface FxHandle {
  /** Resolves when the effect has ended or been cancelled. */
  readonly done: Promise<void>;
  cancel(): void;
}

export interface FxOptions {
  budget?: Budget;
  animate?: Animate;
  doc?: Document;
}

/** One live effect: its lease, its overlay nodes, its animations, its timers. */
export class Run implements FxHandle {
  readonly nodes: Element[] = [];
  readonly anims: Anim[] = [];
  readonly done: Promise<void>;
  #timers: ReturnType<typeof setTimeout>[] = [];
  #cleanups: (() => void)[] = [];
  #ended = false;
  #resolve!: () => void;

  constructor(
    readonly fx: Fx,
    readonly lease: Lease,
  ) {
    this.done = new Promise<void>((r) => {
      this.#resolve = r;
    });
  }

  get ended(): boolean {
    return this.#ended;
  }

  /** Appends an overlay node; it is removed when the run ends. */
  node<T extends Element>(parent: Element, el: T): T {
    parent.appendChild(el);
    this.nodes.push(el);
    return el;
  }

  play(
    el: Element,
    keyframes: Keyframe[] | PropertyIndexedKeyframes,
    options: KeyframeAnimationOptions,
  ): Anim {
    const a = this.fx.animate(el, keyframes, options);
    this.anims.push(a);
    return a;
  }

  /** Registers something to undo when the run ends (a class or style put on an element it does not own). */
  cleanup(fn: () => void): void {
    this.#cleanups.push(fn);
  }

  /** Ends the run when every animation has finished, and in any case after `maxMs`. */
  endWhenDone(maxMs: number): this {
    const all = this.anims.map((a) => a.finished.catch(() => undefined));
    void Promise.all(all).then(() => this.end());
    this.#timers.push(setTimeout(() => this.end(), maxMs + 150));
    return this;
  }

  /** Stops everything and frees the slot. Idempotent. */
  end(): void {
    if (this.#ended) return;
    this.#ended = true;
    for (const t of this.#timers) clearTimeout(t);
    this.#timers = [];
    for (const a of this.anims) {
      try {
        a.cancel();
      } catch {
        // already finished or detached
      }
    }
    for (const n of this.nodes) n.parentNode?.removeChild(n);
    for (const fn of this.#cleanups.splice(0)) fn();
    this.lease.release();
    this.#resolve();
  }

  cancel(): void {
    this.end();
  }
}

export class Fx {
  readonly budget: Budget;
  readonly animate: Animate;
  readonly doc: Document;
  #layer: HTMLElement | null = null;
  #runs = new Set<Run>();

  constructor(opts: FxOptions = {}) {
    this.budget = opts.budget ?? new Budget();
    this.animate = opts.animate ?? nativeAnimate;
    this.doc = opts.doc ?? document;
  }

  /** The mode in force for an element, or null when no overlay effect may draw at all. */
  gate(el: Element): Exclude<MotionMode, 'off'> | null {
    if (this.doc.visibilityState === 'hidden') return null;
    const mode = modeOf(el);
    return mode === 'off' ? null : mode;
  }

  /** The fixed layer every overlay node lives in (created on first use). */
  get layer(): HTMLElement {
    if (!this.#layer?.isConnected) {
      const el = this.doc.createElement('div');
      el.className = 'fx-layer';
      el.setAttribute('aria-hidden', 'true');
      this.doc.body.appendChild(el);
      this.#layer = el;
    }
    return this.#layer;
  }

  /** Takes a budget lease and wraps it in a run; null when the budget says no. */
  begin(kind: FxKind, key: unknown): Run | null {
    let run: Run | null = null;
    const lease = this.budget.acquire(kind, key, () => run?.end());
    if (!lease) return null;
    run = new Run(this, lease);
    this.#runs.add(run);
    void run.done.then(() => this.#runs.delete(run as Run));
    return run;
  }

  /** A fixed box over an element's rectangle, in the layer. `clip` copies its shape and clips to it. */
  box(run: Run, rect: DOMRect, shape?: { radius: string; clipPath: string } | null): HTMLElement {
    const b = this.doc.createElement('div');
    b.className = 'fx-box';
    b.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
    if (shape) {
      b.setAttribute('data-clip', '');
      b.style.borderRadius = shape.radius;
      if (shape.clipPath && shape.clipPath !== 'none') b.style.clipPath = shape.clipPath;
    }
    return run.node(this.layer, b);
  }

  /**
   * A comet element: its head at the origin of its box, its body extending `len` px behind it.
   * `streak` is one tapered ribbon for straight runs; `head` and `seg` are the segments of a chain
   * that bends around corners (see comet.ts), the first with the white bead on its front.
   */
  comet(len: number, thickness: number, kind: CometKind = 'streak'): HTMLElement {
    const c = this.doc.createElement('i');
    c.className = 'fx-comet';
    c.setAttribute('data-k', kind);
    c.style.setProperty('--fx-tail', `${num(len)}px`);
    c.style.setProperty('--fx-th', `${num(thickness)}px`);
    return c;
  }

  /** Ends every effect and removes the layer. */
  dispose(): void {
    this.budget.dispose();
    for (const r of [...this.#runs]) r.end();
    this.#layer?.remove();
    this.#layer = null;
  }
}

/** Shape of a control for clipping and path building, read once from computed style. */
export interface Shape {
  w: number;
  h: number;
  radius: string;
  clipPath: string;
  tl: string;
  tr: string;
  br: string;
  bl: string;
}

export function readShape(el: Element, rect: DOMRect): Shape {
  const cs = getComputedStyle(el);
  return {
    w: rect.width,
    h: rect.height,
    radius: cs.borderRadius || '0px',
    clipPath: cs.clipPath || 'none',
    tl: cs.borderTopLeftRadius,
    tr: cs.borderTopRightRadius,
    br: cs.borderBottomRightRadius,
    bl: cs.borderBottomLeftRadius,
  };
}

export const num = (n: number): string => (Math.round(n * 100) / 100).toString();

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function offscreen(r: DOMRect): boolean {
  const w = typeof innerWidth === 'number' ? innerWidth : 1e5;
  const h = typeof innerHeight === 'number' ? innerHeight : 1e5;
  return r.bottom < 0 || r.right < 0 || r.top > h || r.left > w;
}
