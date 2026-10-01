// The way out of a window (design 8.3, motion language 3.5). The window manager unmounts a closed or minimised
// window at once, so its frame leaves a ghost behind: a copy of the frame, inert and invisible to the
// accessibility tree. A close plays the language's Power-off on it (the circle closes back into the launcher the
// window opened from, 180 ms), a minimise flies to its dot in the dock, and a phone sheet slides down as it
// fades. Transform, opacity and the aperture's clip only; under reduced motion it is a cross-fade, with motion
// off it never appears.
//
// The ghost, not the live frame, plays the exit on purpose: a closed window is gone from the manager's state
// and a route-bound window's body is the router's outlet, which empties the moment the route changes, so the
// real frame has nothing left to show by the time an exit could start.

import { cssValue, currentMotion, play } from '../../features/chrome/motion';
import { type Origin, powerOff } from '../../motion';
import { minimizeFlight } from './chrome';
import type { Rect } from './types';

export type GhostKind = 'close' | 'minimize';

const SHEET_CLOSE_MS = 200;
const MINIMIZE_MS = 300;

/** Attributes a copy must not carry: other code finds windows by them (tethers, tests, focus). */
const IDENTITY = [
  'id',
  'data-window-id',
  'data-window-type',
  'data-focused',
  'data-flare',
  'data-dragging',
  'role',
];

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}

/**
 * Lays a ghost of `el` over the same place and plays its exit. Call while `el` is still in the document.
 * `to` is where a close goes back to (the window's launcher): the circle closes toward it.
 */
export function ghostOut(el: HTMLElement, kind: GhostKind, type: string, to?: Origin): void {
  const parent = el.parentElement;
  if (!parent || currentMotion() === 'off') return;
  // A phone sheet that was flicked away has already left the screen: nothing is left to fade.
  if (el.hasAttribute('data-sheet-gone')) return;
  const ghost = el.cloneNode(true) as HTMLElement;
  for (const a of IDENTITY) ghost.removeAttribute(a);
  for (const n of ghost.querySelectorAll('[id]')) n.removeAttribute('id');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.setAttribute('inert', '');
  ghost.setAttribute('data-ghost', kind);
  ghost.classList.add('wm-ghost');
  const from = rectOf(el);
  const sheet = el.getAttribute('data-placement') === 'sheet';
  parent.appendChild(ghost);
  // A clone restarts every CSS animation inside it: an entrance would replay over content that was already
  // there, and a loop (the About page's hex drift) would run again as one more layer to composite during the
  // exit. The ghost is a snapshot of what the window showed, so they are cancelled before its own exit starts.
  for (const a of ghost.getAnimations?.({ subtree: true }) ?? []) a.cancel();
  const done = () => ghost.remove();
  // A ghost never outlives its flight, whatever happens to the animation.
  setTimeout(done, MINIMIZE_MS + 400);

  if (kind === 'close' && !sheet) {
    // The language's close. It plays now, in the same frame the window left, and `done` comes at once when
    // there is nothing to play (effects off, the runners not loaded yet): closing never waits on decoration.
    void powerOff(ghost, { origin: to }).done.then(done);
    return;
  }

  // Start next frame, when the dock's dot for a minimised window exists.
  requestAnimationFrame(() => {
    let frames: Keyframe[];
    let duration: number;
    let easing: string;
    const dot = kind === 'minimize' ? document.querySelector(`.wm-dot[data-window-type="${type}"]`) : null;
    if (dot) {
      const f = minimizeFlight(from, rectOf(dot));
      frames = [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: `translate(${f.dx}px, ${f.dy}px) scale(${f.scale})` },
      ];
      duration = MINIMIZE_MS;
      easing = cssValue('--ease-in-out', 'cubic-bezier(0.65, 0, 0.35, 1)');
    } else {
      // A phone sheet slides down as it fades.
      frames = [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: 'translateY(56px)' },
      ];
      duration = SHEET_CLOSE_MS;
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
}
