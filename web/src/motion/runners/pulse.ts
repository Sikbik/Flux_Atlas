// Pulse: press feedback. A burst of light at the contact point, and current that runs once along
// the control's edge: two comets leave the nearest point of the border in opposite directions, turn
// every corner (rounded or chamfered) and meet on the far side. 180 to 260 ms by size.
//
// Compositor only: each comet is a short chain of tiny elements animated with transform and opacity
// along keyframes sampled from the control's exact outline. The control itself is never touched.

import { parsePolygon, parseRadius, polygonOutline, roundedRect } from '../geometry';
import { DUR, EASE, REDUCED_MS } from '../timing';
import { BEZ } from './bez';
import { drawChain } from './comet';
import { clamp, type Fx, type FxHandle, num, offscreen, readShape } from './fx';

export type Tone = 'accent' | 'hot';

export interface PulseOptions {
  /** Client coordinates of the press. Defaults to the top centre of the element (keyboard). */
  point?: { x: number; y: number };
  tone?: Tone;
  /** Draw even inside a `data-fx-density="dense"` container. */
  force?: boolean;
}

/** How far inside the border box the wire runs, so the head sits on the control's own 1px border. */
const WIRE_INSET = 0.75;

/** The tightest bend on a control's outline, px: a chamfer counts as 10, square corners as 6. */
export function cornerOf(poly: readonly unknown[] | null, radii: readonly number[]): number {
  if (poly) return 10;
  const round = radii.filter((r) => r > 0.5);
  return round.length ? Math.min(...round) : 6;
}

export function pulse(fx: Fx, el: HTMLElement, opts: PulseOptions = {}): FxHandle | null {
  const mode = fx.gate(el);
  if (!mode) return null;
  if (!opts.force && el.closest('[data-fx-density="dense"]')) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width < 14 || rect.height < 14 || offscreen(rect)) return null;
  const run = fx.begin('pulse', el);
  if (!run) return null;

  const shape = readShape(el, rect);
  const tone: Tone = opts.tone ?? (el.getAttribute('data-fx-tone') === 'hot' ? 'hot' : 'accent');

  if (mode === 'reduced') {
    // No travel: the edge lights once and fades.
    const box = fx.box(run, rect, shape);
    if (tone === 'hot') box.classList.add('fx-tone-hot');
    const flash = run.node(box, fx.doc.createElement('i'));
    flash.className = 'fx-edge-flash';
    run.play(flash, [{ opacity: 0 }, { opacity: 0.9, offset: 0.3 }, { opacity: 0 }], {
      duration: REDUCED_MS,
      easing: 'linear',
    });
    return run.endWhenDone(REDUCED_MS);
  }

  const { w, h } = shape;
  const radii = [
    parseRadius(shape.tl, w, h),
    parseRadius(shape.tr, w, h),
    parseRadius(shape.br, w, h),
    parseRadius(shape.bl, w, h),
  ] as const;
  const poly = shape.clipPath !== 'none' ? parsePolygon(shape.clipPath, w, h) : null;
  const wire = poly ? polygonOutline(poly, WIRE_INSET) : roundedRect(w, h, radii, WIRE_INSET);
  if (wire.length < 8) {
    run.end();
    return null;
  }

  const px = clamp((opts.point?.x ?? rect.left + w / 2) - rect.left, 0, w);
  const py = opts.point ? clamp(opts.point.y - rect.top, 0, h) : 0;
  // Nudge toward the top edge on a tie: the light source is top-left, so current starts on top.
  const s0 = wire.project(px, py - 0.5).s;
  const half = wire.length / 2;
  const dur = clamp(Math.round(DUR.pulse * 0.75 + wire.length * 0.1), 180, 260);
  const size = Math.min(w, h);
  const tail = clamp(size * 1.15 + (Math.max(w, h) - size) * 0.12, 28, 76);
  const thickness = size >= 30 ? 3.2 : 2.6;
  const corner = cornerOf(poly, radii);

  // The burst: a soft bloom at the contact point, clipped to the control's own shape.
  const clipBox = fx.box(run, rect, shape);
  if (tone === 'hot') clipBox.classList.add('fx-tone-hot');
  const seed = run.node(clipBox, fx.doc.createElement('i'));
  seed.className = 'fx-seed';
  seed.style.setProperty('--fx-seed', `${num(clamp(size * 1.6, 36, 88))}px`);
  const at = `translate(${num(px)}px, ${num(py)}px)`;
  run.play(
    seed,
    [
      { transform: `${at} scale(0.3)`, opacity: 0 },
      { transform: `${at} scale(0.8)`, opacity: 0.95, offset: 0.22 },
      { transform: `${at} scale(1.3)`, opacity: 0 },
    ],
    { duration: DUR.seed, easing: EASE.out },
  );

  // The current: two comets leave the nearest point of the edge, one each way round.
  const edgeBox = fx.box(run, rect);
  if (tone === 'hot') edgeBox.classList.add('fx-tone-hot');
  for (const dir of [1, -1] as const) {
    drawChain(fx, run, edgeBox, wire, s0, dir, half, {
      tail,
      thickness,
      duration: dur,
      ease: BEZ.run,
      fadeIn: 0.06,
      fadeOut: 0.78,
      fadePower: 2.2,
      corner,
    });
  }

  // The circuit closes: a small flare where the two comets meet, on the far side of the control.
  const meet = wire.at(s0 + half);
  const flare = run.node(clipBox, fx.doc.createElement('i'));
  flare.className = 'fx-seed';
  flare.style.setProperty('--fx-seed', `${num(clamp(size * 0.95, 26, 48))}px`);
  const there = `translate(${num(meet.x)}px, ${num(meet.y)}px)`;
  run.play(
    flare,
    [
      { transform: `${there} scale(0.3)`, opacity: 0, offset: 0 },
      { transform: `${there} scale(0.3)`, opacity: 0, offset: 0.55 },
      { transform: `${there} scale(0.95)`, opacity: 0.7, offset: 0.8 },
      { transform: `${there} scale(1.4)`, opacity: 0, offset: 1 },
    ],
    { duration: dur, easing: 'linear' },
  );
  return run.endWhenDone(dur);
}
