// A phone sheet that is not a window (design 3.6): the Live tab's. It is the window chrome's own sheet (the same
// classes, the same grabber and title bar, the same drag and snaps, with the snap kept in the window manager's
// state), only without a window behind it. The window manager draws the sheet of a window; this draws the sheet of
// the one view that is not a route.

import { X } from 'lucide-react';
import { type ReactNode, useId, useRef } from 'react';
import { useWindowManager, useWm } from './react';
import { useMoreBelow } from './scrollfade';
import { cycleSnap, sheetHeights, sheetTop, stepSnap } from './sheet';
import { slideAway, useSheetDrag } from './useSheetDrag';
import './wm.css';

export interface PhoneSheetProps {
  /** Goes in `data-window-type`, for CSS and for anything that attaches to a sheet. */
  type: string;
  title: string;
  subtitle?: string;
  glyph: ReactNode;
  /** The sheet's accent (`data-accent`): a window accent name from glyphs.tsx. */
  accent?: string;
  /** Sits between the title and the close button, like a window's freshness chip. */
  meta?: ReactNode;
  onClose(): void;
  children: ReactNode;
}

export function PhoneSheet({
  type,
  title,
  subtitle,
  glyph,
  accent,
  meta,
  onClose,
  children,
}: PhoneSheetProps) {
  const wm = useWindowManager();
  const snap = useWm((s) => s.sheet, Object.is);
  const viewportW = useWm((s) => s.viewport.w, Object.is);
  const viewportH = useWm((s) => s.viewport.h, Object.is);
  const rootRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const heights = sheetHeights(viewportH);
  const height = heights[snap];
  const nextSnap = cycleSnap(snap, heights);
  const drag = useSheetDrag({
    elRef: rootRef,
    snap,
    viewportH,
    onSnap: (to) => wm.dispatch({ t: 'setSheet', snap: to }),
    onDismiss: onClose,
  });
  useMoreBelow(bodyRef);

  const stepSheet = (dir: 1 | -1) => {
    const to = stepSnap(snap, dir, heights);
    if (to !== snap) wm.dispatch({ t: 'setSheet', snap: to });
  };
  const close = () => {
    const el = rootRef.current;
    if (el) slideAway(el, 0, height + 32, onClose);
    else onClose();
  };

  return (
    <div className="wm-layer" data-layout="phone">
      <section
        ref={rootRef}
        className="wm-window"
        role="dialog"
        aria-labelledby={titleId}
        data-window-type={type}
        data-placement="sheet"
        data-mode="normal"
        data-snap={snap}
        data-focused=""
        data-accent={accent}
        style={{
          left: 0,
          top: sheetTop(viewportH, height),
          width: viewportW,
          height,
          zIndex: 'var(--z-window)',
        }}
      >
        <div className="wm-shadow">
          <div className="wm-slab">
            <button
              type="button"
              className="wm-grabber"
              aria-label={`Sheet size ${snap}, switch to ${nextSnap}`}
              {...drag.handlers}
              onClick={() => {
                if (!drag.wasDragged()) wm.dispatch({ t: 'setSheet', snap: nextSnap });
              }}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                e.preventDefault();
                stepSheet(e.key === 'ArrowUp' ? 1 : -1);
              }}
            />
            <header className="wm-titlebar" data-fx-density="dense" {...drag.handlers}>
              <span className="wm-glyph" aria-hidden="true">
                {glyph}
              </span>
              <div className="wm-heading">
                <h2 className="wm-title" id={titleId}>
                  {title}
                </h2>
                {subtitle ? <small className="wm-sub">{subtitle}</small> : null}
              </div>
              {meta}
              <div className="wm-controls">
                <button type="button" className="wm-btn wm-btn-close" aria-label="Close" onClick={close}>
                  <X size={15} strokeWidth={1.6} aria-hidden="true" />
                </button>
              </div>
            </header>
            <div className="wm-body" ref={bodyRef}>
              {children}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
