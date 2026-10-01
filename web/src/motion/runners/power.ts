// Power-on: a window or panel opening, and its reverse. The element comes up out of its source
// (scale and fade from the dock icon, the node, the moon), and a surge of light crosses it, a bright
// leading edge with a soft wake: the radial twin of a comet. Quick on purpose: the content is live
// the moment it mounts, the light just rides over it.
//
// `aperture` adds the design's circle reveal (clip-path). It is only used when the element has no
// shadow, clip or mask of its own, because a clip would cut them; wrap a chamfered, shadowed window
// frame in a plain element (<PowerOn> does) to get it.

import { DUR, EASE, REDUCED_MS } from '../timing';
import { drawEdge } from './current';
import type { Tone } from './fx';
import { clamp, type Fx, type FxHandle, num, readShape } from './fx';

/**
 * Where an element comes from: client coordinates, an element or a rect (its centre), or a point on the element
 * itself as fractions of its own box (`{ fx: 1, fy: 0.5 }` is the middle of its right edge: a toast that grows
 * out of the screen's edge, a sheet out of the bottom).
 */
export type Origin =
  | { x: number; y: number }
  | { fx: number; fy: number }
  | Element
  | DOMRect
  | null
  | undefined;

export interface PowerOptions {
  /** Where the element comes from (see `Origin`); the middle of the element when not given. */
  origin?: Origin;
  /** `window`: scale, fade and the light surge. `panel`: a quicker scale and fade with one comet along the top edge. */
  variant?: 'window' | 'panel';
  tone?: Tone;
  /** Circle reveal from the origin. `auto` uses it only when the element can be clipped safely. */
  aperture?: 'auto' | boolean;
}

export function resolveOrigin(origin: Origin, rect: DOMRect): { x: number; y: number } {
  if (!origin) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  if (typeof Element !== 'undefined' && origin instanceof Element) {
    const r = origin.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  if ('fx' in origin) return { x: rect.left + rect.width * origin.fx, y: rect.top + rect.height * origin.fy };
  if ('width' in origin) return { x: origin.left + origin.width / 2, y: origin.top + origin.height / 2 };
  return { x: (origin as { x: number }).x, y: (origin as { y: number }).y };
}

/** The farthest corner from (ox, oy), in px: the radius at which a circle covers the whole rect. */
export function coverRadius(ox: number, oy: number, w: number, h: number): number {
  return (
    Math.ceil(
      Math.max(
        Math.hypot(ox, oy),
        Math.hypot(w - ox, oy),
        Math.hypot(ox, h - oy),
        Math.hypot(w - ox, h - oy),
      ),
    ) + 4
  );
}

/**
 * The circle runs this far past the farthest corner. A window's drop shadow sits outside its box
 * (`--drop-window` reaches about 64 px below it), and the clip would cut it off until the animation
 * ends and then let it pop in; with the bleed the circle has already uncovered it by then.
 */
const APERTURE_BLEED = 64;

/**
 * How far outside the element the origin may be. A window summoned from a dock icon a thousand pixels away
 * would otherwise open as a circle that has not reached it yet (nothing to see for the first frames, which
 * is a wait) and scale about a far point (it would slide). Held to the rectangle plus this slack, the first
 * frame already shows the window and the light still comes in from the side the source is on.
 */
export const ORIGIN_SLACK = 48;

function canClip(el: Element): boolean {
  const cs = getComputedStyle(el);
  return cs.clipPath === 'none' && cs.maskImage === 'none' && cs.boxShadow === 'none' && cs.filter === 'none';
}

/** Everything the animation needs from the element, read before any animation touches it. */
function measure(el: Element, opts: PowerOptions) {
  const rect = el.getBoundingClientRect();
  const o = resolveOrigin(opts.origin, rect);
  const ox = clamp(o.x - rect.left, -ORIGIN_SLACK, rect.width + ORIGIN_SLACK);
  const oy = clamp(o.y - rect.top, -ORIGIN_SLACK, rect.height + ORIGIN_SLACK);
  const aperture = opts.aperture === true || (opts.aperture !== false && canClip(el));
  return {
    rect,
    shape: readShape(el, rect),
    ox,
    oy,
    aperture,
    R: coverRadius(ox, oy, rect.width, rect.height) + APERTURE_BLEED,
  };
}

/** Opens `el`. Returns null in `off` mode (the element simply appears). */
export function powerOn(fx: Fx, el: HTMLElement, opts: PowerOptions = {}): FxHandle | null {
  const mode = fx.gate(el);
  if (!mode) return null;
  const variant = opts.variant ?? 'window';
  const m = measure(el, opts); // before animating: a running clip-path would be read as the element's own

  // The element's own entrance is the state change itself, so it is not budgeted; the light on top is.
  if (mode === 'reduced') {
    const a = fx.animate(el, [{ opacity: 0 }, { opacity: 1 }], {
      duration: REDUCED_MS,
      easing: 'linear',
      fill: 'backwards',
    });
    return handle(a);
  }
  const origin = `${num(m.ox)}px ${num(m.oy)}px`;
  const dur = variant === 'window' ? DUR.powerOn : 260;
  const from = variant === 'window' ? 0.95 : 0.97;
  const entrance = fx.animate(
    el,
    [
      { opacity: 0, transform: `scale(${from})`, transformOrigin: origin, offset: 0 },
      {
        opacity: 1,
        transform: `scale(${num(from + (1 - from) * 0.8)})`,
        transformOrigin: origin,
        offset: 0.4,
      },
      { opacity: 1, transform: 'scale(1)', transformOrigin: origin, offset: 1 },
    ],
    { duration: dur, easing: EASE.arrive, fill: 'backwards' },
  );
  const reveal =
    m.aperture && variant === 'window'
      ? fx.animate(
          el,
          [{ clipPath: `circle(0px at ${origin})` }, { clipPath: `circle(${m.R}px at ${origin})` }],
          { duration: DUR.surge, easing: EASE.run, fill: 'backwards' },
        )
      : null;

  const run = fx.begin('power', el);
  if (!run) return handle(entrance);
  run.anims.push(entrance);
  if (reveal) run.anims.push(reveal);

  if (variant === 'window') {
    const box = fx.box(run, m.rect, m.shape);
    if (opts.tone === 'hot') box.classList.add('fx-tone-hot');
    const surge = run.node(box, fx.doc.createElement('i'));
    surge.className = 'fx-surge';
    surge.style.setProperty('--fx-ox', `${num(m.ox)}px`);
    surge.style.setProperty('--fx-oy', `${num(m.oy)}px`);
    run.play(surge, { '--fx-ring': ['0px', `${m.R}px`] } as unknown as PropertyIndexedKeyframes, {
      duration: DUR.surge,
      easing: EASE.run,
      fill: 'both',
    });
    run.play(
      surge,
      [{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 0.85, offset: 0.6 }, { opacity: 0 }],
      {
        duration: DUR.surge,
        easing: 'linear',
        fill: 'both',
      },
    );
    return run.endWhenDone(DUR.surge);
  }

  // Panel: one comet along the top edge, a quick sweep of light.
  const box = fx.box(run, m.rect, null);
  if (opts.tone === 'hot') box.classList.add('fx-tone-hot');
  const ms = drawEdge(fx, run, box, el, m.rect, { edge: 'top', duration: 420, tail: 80 });
  return run.endWhenDone(Math.max(dur, ms));
}

/**
 * Closes `el`: faster than it opens, toward the origin. The element is left invisible when the
 * animation ends (so a React unmount in the next frame never flashes it back); remove it on `done`.
 * Returns null in `off` mode, where the caller removes it immediately.
 */
export function powerOff(fx: Fx, el: HTMLElement, opts: PowerOptions = {}): FxHandle | null {
  const mode = fx.gate(el);
  if (!mode) return null;
  const m = measure(el, opts);
  const origin = `${num(m.ox)}px ${num(m.oy)}px`;
  if (mode === 'reduced') {
    return handle(
      fx.animate(el, [{ opacity: 1 }, { opacity: 0 }], {
        duration: REDUCED_MS * 0.75,
        easing: 'linear',
        fill: 'forwards',
      }),
    );
  }
  const keys: Keyframe[] = [
    { opacity: 1, transform: 'scale(1)', transformOrigin: origin, offset: 0 },
    { opacity: 0, transform: 'scale(0.96)', transformOrigin: origin, offset: 1 },
  ];
  if (m.aperture && (opts.variant ?? 'window') === 'window') {
    keys[0] = { ...keys[0]!, clipPath: `circle(${m.R}px at ${origin})` };
    keys[1] = { ...keys[1]!, clipPath: `circle(0px at ${origin})` };
  }
  return handle(fx.animate(el, keys, { duration: DUR.powerOff, easing: EASE.in, fill: 'forwards' }));
}

/** A handle over a bare animation (no overlay, no lease). */
function handle(a: { finished: Promise<unknown>; cancel(): void }): FxHandle {
  return {
    done: a.finished.then(
      () => undefined,
      () => undefined,
    ),
    cancel: () => a.cancel(),
  };
}
