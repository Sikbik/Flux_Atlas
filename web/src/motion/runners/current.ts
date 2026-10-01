// Current: a live arrival. One comet (bright head, a tail of three passes that fades away) runs once
// along an edge of a container, or once around it. It reuses the globe's streak morphology so a block
// landing reads as the same electricity in the chrome and on the planet.
//
// Two ways to host it: an overlay box over the element's rectangle (imperative `current(el)`), or an
// inline track the <Current> component renders inside its parent (follows the parent while it
// moves or scrolls). Either way the light is transform and opacity on tiny elements.

import { parsePolygon, parseRadius, polygonOutline, roundedRect } from '../geometry';
import { DUR, EASE, REDUCED_MS } from '../timing';
import { BEZ } from './bez';
import { drawChain } from './comet';
import type { Tone } from './fx';
import { clamp, type Fx, type FxHandle, num, offscreen, type Run, readShape } from './fx';
import { cornerOf } from './pulse';

export type Edge = 'top' | 'bottom' | 'left' | 'right' | 'perimeter';

export interface CurrentOptions {
  edge?: Edge;
  /** Run against the natural direction (right to left on a horizontal edge, bottom to top on a vertical one). */
  reverse?: boolean;
  tone?: Tone;
  /** Milliseconds; defaults to a length-scaled value around `--fx-dur-current`. */
  duration?: number;
  /** Tail length in px. */
  tail?: number;
  /** An inline track already positioned inside the host; the comet is drawn in it instead of an overlay. */
  track?: HTMLElement | null;
  /**
   * Draw into a track the run itself puts inside the host and removes when it ends, so the light goes where
   * the host goes (a row that is sliding in, a card in a list that scrolls). The host must be positioned;
   * otherwise the overlay over its rectangle is used, as without this option.
   */
  inline?: boolean;
}

const WIRE_INSET = 0.75;

/** Draws one edge comet into `container` (a box whose origin is the host's top-left). */
export function drawEdge(
  fx: Fx,
  run: Run,
  container: HTMLElement,
  host: HTMLElement,
  rect: DOMRect,
  opts: CurrentOptions,
): number {
  const edge = opts.edge ?? 'top';
  const { width: w, height: h } = rect;
  const shape = readShape(host, rect);
  const rtl = parseRadius(shape.tl, w, h);
  const rtr = parseRadius(shape.tr, w, h);
  const rbr = parseRadius(shape.br, w, h);
  const rbl = parseRadius(shape.bl, w, h);
  const rev = opts.reverse === true;
  const thickness = 2.6;

  if (edge === 'perimeter') {
    const poly = shape.clipPath !== 'none' ? parsePolygon(shape.clipPath, w, h) : null;
    const wire = poly
      ? polygonOutline(poly, WIRE_INSET)
      : roundedRect(w, h, [rtl, rtr, rbr, rbl], WIRE_INSET);
    const dur = opts.duration ?? DUR.lap;
    drawChain(fx, run, container, wire, wire.project(rtl + 2, 0).s, rev ? -1 : 1, wire.length, {
      tail: opts.tail ?? clamp(wire.length * 0.14, 40, 84),
      thickness,
      duration: dur,
      ease: BEZ.lap,
      fadeIn: 0.05,
      fadeOut: 0.88,
      corner: cornerOf(poly, [rtl, rtr, rbr, rbl]),
    });
    return dur;
  }

  const horizontal = edge === 'top' || edge === 'bottom';
  const length = horizontal ? w : h;
  // The two corner radii at the ends of this edge: the light lives only on the straight part.
  const r0 = horizontal ? (edge === 'top' ? rtl : rbl) : edge === 'left' ? rtl : rtr;
  const r1 = horizontal ? (edge === 'top' ? rtr : rbr) : edge === 'left' ? rbl : rbr;
  const tail = opts.tail ?? clamp(length * 0.1, 56, 160);
  // --fx-dur-current is the run along a 700 px edge; every 100 px more or less moves it by 40 ms.
  const dur = opts.duration ?? clamp(Math.round(DUR.current + (length - 700) * 0.4), 440, 920);

  // The head runs from the clip edge at one end to past the other, so the tail leaves the edge too.
  const from = rev ? length - r1 : r0;
  const to = rev ? r0 - tail : length - r1 + tail;
  const fixed = horizontal ? (edge === 'top' ? 0.5 : h - 0.5) : edge === 'left' ? 0.5 : w - 0.5;
  const heading = horizontal ? (rev ? Math.PI : 0) : rev ? -Math.PI / 2 : Math.PI / 2;
  const at = (p: number) => {
    const v = from + (to - from) * p;
    return horizontal ? `translate(${num(v)}px, ${num(fixed)}px)` : `translate(${num(fixed)}px, ${num(v)}px)`;
  };
  const turn = `rotate(${num(heading)}rad)`;
  const keys = [
    { offset: 0, opacity: 0, transform: `${at(0)} ${turn} scaleX(0.7)` },
    { offset: 0.08, opacity: 1, transform: `${at(0.08)} ${turn} scaleX(1)` },
    { offset: 0.86, opacity: 1, transform: `${at(0.86)} ${turn} scaleX(1)` },
    { offset: 1, opacity: 0, transform: `${at(1)} ${turn} scaleX(0.8)` },
  ];

  // Clip the light to the straight part of the edge (between the corner radii) and let the glow
  // breathe on both sides of the line.
  const pad = 12;
  run.cleanup(() => {
    container.style.clipPath = '';
  });
  container.style.clipPath = horizontal
    ? `inset(-${pad}px ${num(edge === 'top' ? rtr : rbr)}px -${pad}px ${num(edge === 'top' ? rtl : rbl)}px)`
    : `inset(${num(edge === 'left' ? rtl : rtr)}px -${pad}px ${num(edge === 'left' ? rbl : rbr)}px -${pad}px)`;
  const comet = run.node(container, fx.comet(tail, thickness));
  run.play(comet, keys, { duration: dur, easing: EASE.run, fill: 'both' });
  return dur;
}

/** Reduced motion: the edge lights once and fades; nothing travels. */
function drawEdgeFlash(fx: Fx, run: Run, container: HTMLElement, rect: DOMRect, edge: Edge): number {
  const line = run.node(container, fx.doc.createElement('i'));
  line.className = 'fx-line';
  const { width: w, height: h } = rect;
  if (edge === 'perimeter') {
    line.className = 'fx-edge-flash';
  } else if (edge === 'top' || edge === 'bottom') {
    line.style.cssText = `left:0;width:${w}px;height:1.5px;top:${edge === 'top' ? 0 : h - 1.5}px`;
  } else {
    line.classList.add('fx-line-v');
    line.style.cssText = `top:0;height:${h}px;width:1.5px;left:${edge === 'left' ? 0 : w - 1.5}px`;
  }
  run.play(line, [{ opacity: 0 }, { opacity: 0.85, offset: 0.25 }, { opacity: 0 }], {
    duration: REDUCED_MS * 3,
    easing: 'linear',
  });
  return REDUCED_MS * 3;
}

export function current(fx: Fx, host: HTMLElement, opts: CurrentOptions = {}): FxHandle | null {
  const mode = fx.gate(host);
  if (!mode) return null;
  const rect = host.getBoundingClientRect();
  if (rect.width < 24 || rect.height < 8 || offscreen(rect)) return null;
  const run = fx.begin('current', opts.track ?? host);
  if (!run) return null;
  const edge = opts.edge ?? 'top';

  let container: HTMLElement;
  if (opts.track) {
    container = opts.track;
  } else if (opts.inline && getComputedStyle(host).position !== 'static') {
    // The same track a <Current> renders (motion.css), made for this run and removed with it.
    const t = fx.doc.createElement('span');
    t.className = 'fx-current';
    t.setAttribute('data-edge', edge);
    t.setAttribute('aria-hidden', 'true');
    container = run.node(host, t);
  } else {
    // An overlay box over the host; drawEdge clips straight edges to the span between the corners.
    container = fx.box(run, rect, null);
  }
  if (opts.tone === 'hot') {
    container.classList.add('fx-tone-hot');
    run.cleanup(() => container.classList.remove('fx-tone-hot'));
  }
  const ms =
    mode === 'reduced'
      ? drawEdgeFlash(fx, run, container, rect, edge)
      : drawEdge(fx, run, container, host, rect, opts);
  return run.endWhenDone(ms);
}
