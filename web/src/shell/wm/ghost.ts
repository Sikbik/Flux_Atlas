// The way out of a window (design 8.3, 6.4 A). The window manager unmounts a closed or minimised window at
// once, so its frame leaves a ghost behind: a copy of the frame, inert and invisible to the accessibility
// tree, that fades and shrinks in the same place (a close) or flies to its dot in the dock (a minimise).
// Transform and opacity only; under reduced motion it is a cross-fade, with motion off it never appears.

import { cssValue, currentMotion, play } from '../../features/chrome/motion';
import { minimizeFlight } from './chrome';
import type { Rect } from './types';

export type GhostKind = 'close' | 'minimize';

const CLOSE_MS = 200;
const MINIMIZE_MS = 300;

/** Attributes a copy must not carry: other code finds windows by them (tethers, tests, focus). */
const IDENTITY = ['id', 'data-window-id', 'data-window-type', 'data-focused', 'data-dragging', 'role'];

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}

/** Lays a ghost of `el` over the same place and plays its exit. Call while `el` is still in the document. */
export function ghostOut(el: HTMLElement, kind: GhostKind, type: string): void {
  const parent = el.parentElement;
  if (!parent || currentMotion() === 'off') return;
  const ghost = el.cloneNode(true) as HTMLElement;
  for (const a of IDENTITY) ghost.removeAttribute(a);
  for (const n of ghost.querySelectorAll('[id]')) n.removeAttribute('id');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.setAttribute('inert', '');
  ghost.setAttribute('data-ghost', kind);
  ghost.classList.add('wm-ghost');
  const from = rectOf(el);
  parent.appendChild(ghost);
  const done = () => ghost.remove();
  // Start next frame, when the dock's dot for a minimised window exists.
  requestAnimationFrame(() => {
    let frames: Keyframe[];
    let duration: number;
    let easing: string;
    const dot = kind === 'minimize' ? document.querySelector(`.wm-dot[data-window-type="${type}"]`) : null;
    if (dot) {
      const to = rectOf(dot);
      const f = minimizeFlight(from, to);
      frames = [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: `translate(${f.dx}px, ${f.dy}px) scale(${f.scale})` },
      ];
      duration = MINIMIZE_MS;
      easing = cssValue('--ease-in-out', 'cubic-bezier(0.65, 0, 0.35, 1)');
    } else {
      frames = [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: 'scale(0.96)' },
      ];
      duration = CLOSE_MS;
      easing = cssValue('--ease-in', 'cubic-bezier(0.55, 0, 1, 0.45)');
    }
    const anim = play(ghost, frames, {
      duration,
      easing,
      fill: 'forwards',
      reduced: [{ opacity: 1 }, { opacity: 0 }],
    });
    if (!anim) {
      done();
      return;
    }
    anim.onfinish = done;
    anim.oncancel = done;
  });
  // A ghost never outlives its flight, whatever happens to the animation.
  setTimeout(done, MINIMIZE_MS + 400);
}
