// Spark: a commit or a toggle turning on. A tiny bright head appears at the control, rings once and
// settles; optionally it arrives from a short distance trailing a comet (a switch knob, a copy
// button's icon). Small, brief, one per commit.

import { DUR, EASE, REDUCED_MS } from '../timing';
import type { Tone } from './fx';
import { type Fx, type FxHandle, num, offscreen, readShape, toneOf } from './fx';

export interface SparkOptions {
  /** Where the head lands, in client coordinates. Defaults to the centre of the element. */
  at?: { x: number; y: number };
  /** The head arrives from this offset in px (a comet trails it), then settles. */
  from?: { dx: number; dy: number };
  /** Milliseconds to wait first (a knob that is still sliding). */
  delay?: number;
  tone?: Tone;
}

const ARRIVE_MS = 200;

export function spark(fx: Fx, el: Element, opts: SparkOptions = {}): FxHandle | null {
  const mode = fx.gate(el);
  if (!mode) return null;
  const rect = el.getBoundingClientRect();
  if (offscreen(rect) || (rect.width === 0 && rect.height === 0)) return null;
  const run = fx.begin('spark', el);
  if (!run) return null;
  const delay = Math.max(0, opts.delay ?? 0);
  const tone = opts.tone ?? toneOf(el);

  if (mode === 'reduced') {
    // No head, no travel: the control's edge lights once.
    const box = fx.box(run, rect, readShape(el, rect));
    if (tone === 'hot') box.classList.add('fx-tone-hot');
    const flash = run.node(box, fx.doc.createElement('i'));
    flash.className = 'fx-edge-flash';
    run.play(flash, [{ opacity: 0 }, { opacity: 0.9, offset: 0.3 }, { opacity: 0 }], {
      duration: REDUCED_MS,
      easing: 'linear',
      delay,
    });
    return run.endWhenDone(REDUCED_MS + delay);
  }

  const x = opts.at?.x ?? rect.left + rect.width / 2;
  const y = opts.at?.y ?? rect.top + rect.height / 2;
  const host = run.node(fx.layer, fx.doc.createElement('div'));
  host.className = tone === 'hot' ? 'fx-spark fx-tone-hot' : 'fx-spark';
  const land = `translate(${num(x)}px, ${num(y)}px)`;
  host.style.transform = land;

  const lead = opts.from ? ARRIVE_MS : 0;
  if (opts.from) {
    const { dx, dy } = opts.from;
    const start = `translate(${num(x - dx)}px, ${num(y - dy)}px)`;
    run.play(host, [{ transform: start }, { transform: land }], {
      duration: ARRIVE_MS,
      easing: EASE.burst,
      delay,
      fill: 'both',
    });
    const comet = run.node(host, fx.comet(Math.min(34, Math.hypot(dx, dy) * 1.4), 2.4, 'streak'));
    comet.style.transform = `rotate(${num(Math.atan2(dy, dx))}rad)`;
    run.play(
      comet,
      [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 0.9, offset: 0.7 }, { opacity: 0 }],
      {
        duration: ARRIVE_MS,
        easing: 'linear',
        delay,
        fill: 'both',
      },
    );
  }

  const core = run.node(host, fx.doc.createElement('i'));
  core.className = 'fx-spark-core';
  run.play(
    core,
    [
      { transform: 'scale(0.35)', opacity: 0 },
      { transform: 'scale(1.3)', opacity: 0.92, offset: 0.2 },
      { transform: 'scale(1)', opacity: 0.85, offset: 0.5 },
      { transform: 'scale(0.45)', opacity: 0 },
    ],
    { duration: DUR.spark, easing: EASE.out, delay: delay + lead * 0.7, fill: 'both' },
  );
  const ring = run.node(host, fx.doc.createElement('i'));
  ring.className = 'fx-spark-ring';
  run.play(
    ring,
    [
      { transform: 'scale(0.35)', opacity: 0.75 },
      { transform: 'scale(2.1)', opacity: 0 },
    ],
    { duration: DUR.spark + 40, easing: EASE.burst, delay: delay + lead * 0.7, fill: 'both' },
  );
  return run.endWhenDone(DUR.spark + 40 + delay + lead);
}
