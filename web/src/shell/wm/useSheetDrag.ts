// The drag of a phone sheet (design 3.6): hold the grabber or the title bar and move the sheet with the finger;
// when it lets go the sheet settles on the snap the throw lands on (sheet.ts decides), and a flick down from
// the lowest snap sends it away. While the finger is down the sheet is moved with a transform only (nothing
// re-renders, nothing lays out); on release the new snap is dispatched and the sheet, which is now in its
// final rectangle, is carried there from where it was let go with one FLIP (transform, 340 ms). The layer the
// sheet lives in is clipped above the tab bar (wm.css), so a sheet pulled up or released low never draws over it.

import { type PointerEvent as ReactPointerEvent, type RefObject, useMemo, useRef } from 'react';
import { cssValue, play } from '../../features/chrome/motion';
import { nearestSnap, releaseVelocity, sheetHeights } from './sheet';
import type { SheetSnap } from './types';

/** The finger has to travel this far before a press becomes a drag, so a tap on the grabber stays a tap. */
const SLOP_PX = 6;
const SETTLE_MS = 340;
const DISMISS_MS = 240;
/** Past the tallest snap the sheet follows the finger at this share of its travel. */
const RUBBER = 0.25;

export interface SheetDragOptions {
  /** The sheet's element: the drag moves it with a transform. */
  elRef: RefObject<HTMLElement | null>;
  snap: SheetSnap;
  viewportH: number;
  /** Takes the sheet to a snap (the window manager's `setSheet`). */
  onSnap(snap: SheetSnap): void;
  /** A flick down from the lowest snap: close the sheet. */
  onDismiss(): void;
}

export interface SheetDragHandlers {
  onPointerDown(e: ReactPointerEvent<HTMLElement>): void;
  onPointerMove(e: ReactPointerEvent<HTMLElement>): void;
  onPointerUp(e: ReactPointerEvent<HTMLElement>): void;
  onPointerCancel(e: ReactPointerEvent<HTMLElement>): void;
}

interface Drag {
  pointerId: number;
  startY: number;
  startHeight: number;
  /** What the transform shows now, in px (negative: up). */
  dy: number;
  moved: boolean;
  samples: { t: number; y: number }[];
}

/** A press on one of these is theirs, not the sheet's: the close button, a link, a field. */
const OWN_PRESS = 'a, input, select, textarea, [role="switch"], button:not(.wm-grabber)';

export function useSheetDrag(options: SheetDragOptions): {
  handlers: SheetDragHandlers;
  /** True from the moment a drag begins until just after its click, so the grabber's click does not also act. */
  wasDragged(): boolean;
} {
  const opts = useRef(options);
  opts.current = options;
  const drag = useRef<Drag | null>(null);
  const suppress = useRef(false);

  return useMemo(() => {
    const finish = (d: Drag, cancelled: boolean) => {
      const { elRef, snap, viewportH, onSnap, onDismiss } = opts.current;
      const el = elRef.current;
      if (!el) return;
      const heights = sheetHeights(viewportH);
      const velocity = cancelled ? 0 : releaseVelocity(d.samples);
      const outcome = nearestSnap({ from: snap, height: d.startHeight - d.dy, velocity }, heights);
      el.removeAttribute('data-sheet-drag');
      if (outcome.kind === 'dismiss') {
        const away = `translate3d(0, ${d.startHeight + 32}px, 0)`;
        const slide = play(el, [{ transform: `translate3d(0, ${d.dy}px, 0)` }, { transform: away }], {
          duration: DISMISS_MS,
          easing: cssValue('--ease-in', 'cubic-bezier(0.55, 0, 1, 0.45)'),
        });
        // Hold the end of the slide: the sheet stays away while it is closed, and leaves no ghost (ghost.ts).
        el.style.transform = away;
        el.setAttribute('data-sheet-gone', '');
        const close = () => onDismiss();
        if (slide) {
          slide.onfinish = close;
          slide.oncancel = close;
        } else close();
        return;
      }
      const visualTop = el.getBoundingClientRect().top;
      el.style.transform = '';
      el.style.transition = '';
      if (outcome.snap !== snap) onSnap(outcome.snap);
      // The new rectangle is in place by the next microtask and nothing has been painted yet: carry the sheet
      // there from where it was let go (or back to where it was, when the snap did not change).
      queueMicrotask(() => {
        const now = opts.current.elRef.current;
        if (!now) return;
        const delta = visualTop - now.getBoundingClientRect().top;
        if (Math.abs(delta) < 1) return;
        play(now, [{ transform: `translate3d(0, ${delta}px, 0)` }, { transform: 'none' }], {
          duration: SETTLE_MS,
          easing: cssValue('--ease-out-expo', 'cubic-bezier(0.16, 1, 0.3, 1)'),
        });
      });
    };

    const handlers: SheetDragHandlers = {
      onPointerDown(e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if ((e.target as HTMLElement).closest(OWN_PRESS)) return;
        const { elRef, snap, viewportH } = opts.current;
        if (!elRef.current) return;
        drag.current = {
          pointerId: e.pointerId,
          startY: e.clientY,
          startHeight: sheetHeights(viewportH)[snap],
          dy: 0,
          moved: false,
          samples: [{ t: e.timeStamp, y: e.clientY }],
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      },

      onPointerMove(e) {
        const d = drag.current;
        const el = opts.current.elRef.current;
        if (!d || !el || e.pointerId !== d.pointerId) return;
        const raw = e.clientY - d.startY;
        if (!d.moved) {
          if (Math.abs(raw) < SLOP_PX) return;
          d.moved = true;
          suppress.current = true;
          el.style.transition = 'none';
          el.setAttribute('data-sheet-drag', '');
        }
        d.samples.push({ t: e.timeStamp, y: e.clientY });
        if (d.samples.length > 8) d.samples.shift();
        const heights = sheetHeights(opts.current.viewportH);
        const up = -(heights.full - d.startHeight);
        d.dy = raw < up ? up + (raw - up) * RUBBER : Math.min(d.startHeight, raw);
        el.style.transform = `translate3d(0, ${d.dy}px, 0)`;
      },

      onPointerUp(e) {
        end(e, false);
      },
      onPointerCancel(e) {
        end(e, true);
      },
    };

    const end = (e: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      drag.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      if (!d.moved) return;
      // The click that follows the release belongs to the drag, not to the grabber.
      setTimeout(() => {
        suppress.current = false;
      }, 0);
      finish(d, cancelled);
    };

    return { handlers, wasDragged: () => suppress.current };
  }, []);
}
