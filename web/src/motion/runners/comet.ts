// A comet that follows an outline: a chain of short links, each trailing the one before it by a
// fixed distance along the path. One straight element cannot turn a corner (its tail would cut
// across the bend and stick out of a rounded or chamfered shape). A chain bends exactly where the
// path does: every link is centred on the path and points along its local chord, and a link is one
// tiny element animated with transform and opacity only, so the whole comet runs on the compositor.
//
// A link is a tent: transparent at both ends and brightest in the middle, twice as long as the
// spacing between links. Neighbouring tents overlap and the box that holds them blends them with
// plus-lighter, so their sum is the straight-line interpolation of the links' brightnesses: one
// continuous ribbon, white at the head and fading to blue at the tail, with no seams where two
// elements meet (rasterised edges never line up exactly) and no beading.

import { type Bezier, type Outline, trailFrames } from '../geometry';
import { clamp, type Fx, num, type Run } from './fx';

export interface ChainOptions {
  /** Total tail length behind the head, px. */
  tail: number;
  /** Head thickness, px. */
  thickness: number;
  duration: number;
  /** The easing, baked into the keyframes (the animation itself runs linear). */
  ease: Bezier;
  /** Fraction of the time spent fading in, and the fraction at which the fade-out starts. */
  fadeIn: number;
  fadeOut: number;
  /** The tightest corner radius on the path, px: it sets how short a link must be (default 10). */
  corner?: number;
  /** Exponent of the fade-out: above 1 the light stays bright and then goes out quickly (default 1.8). */
  fadePower?: number;
}

/** Spacing between links for a path whose tightest corner has radius `corner`: 3 to 6 px. */
export function linkGap(corner: number): number {
  return clamp(corner * 0.42, 3, 6);
}

/** Links in a chain of total length `tail`: at least 4, at most 18. */
export function linkCount(tail: number, corner: number): number {
  return clamp(Math.ceil(tail / linkGap(corner)), 4, 18);
}

// Brightness laws along the tail, u = 0 at the head and 1 at the far end of the tail: the white core
// dies fastest, the blue glow lingers, so the head burns white and the tail fades to blue.
const LAWS = [
  { name: 'c', peak: 100, power: 2.1 },
  { name: 'b', peak: 88, power: 1.35 },
  { name: 'g', peak: 62, power: 0.9 },
  { name: 'h', peak: 15, power: 1.1 },
] as const;

const TIP = 0.82; // how much of its thickness the tail loses by its far end

/**
 * Draws one comet along `outline`, leaving `s0` in direction `dir` and travelling `travel` px, into
 * `parent` (an isolated box whose origin is the outline's origin).
 */
export function drawChain(
  fx: Fx,
  run: Run,
  parent: Element,
  outline: Outline,
  s0: number,
  dir: 1 | -1,
  travel: number,
  o: ChainOptions,
): void {
  const links = linkCount(o.tail, o.corner ?? 10);
  const gap = o.tail / links;
  for (let k = 0; k < links; k++) {
    const frames = trailFrames(outline, s0, dir, travel, k * gap, o.ease, gap, Math.max(2, gap));
    if (frames.length < 2) continue;
    const thick = o.thickness * (1 - (TIP * k) / links);
    const el = run.node(parent, fx.comet(gap * 2, thick, k === 0 ? 'head' : 'seg'));
    for (const law of LAWS) {
      el.style.setProperty(`--fx-${law.name}`, `${num(law.peak * (1 - k / links) ** law.power)}%`);
    }
    // A link that trails the head waits at the origin (two frames at opacity 0), then fades in over
    // the same span as the head does, counted from the moment it starts to move.
    const waits = k > 0;
    const start = waits ? (frames[1]?.offset ?? 0) : 0;
    const keys = frames.map((f, i) => {
      const p = f.offset;
      let env = 1;
      if (waits && i < 2) env = 0;
      else if (p - start < o.fadeIn) env = (p - start) / o.fadeIn;
      if (p > o.fadeOut) env = Math.min(env, Math.max(0, (1 - p) / (1 - o.fadeOut)) ** (o.fadePower ?? 1.8));
      return {
        offset: p,
        opacity: num(env),
        transform: `translate(${num(f.x)}px, ${num(f.y)}px) rotate(${num(f.a)}rad)`,
      };
    });
    run.play(el, keys, { duration: o.duration, easing: 'linear', fill: 'both' });
  }
}
