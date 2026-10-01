// A tooltip that can hold content (design 8.17): it opens after a short delay on pointer hover or
// keyboard focus, stays while the pointer is on it (WCAG 1.4.13: dismissible, hoverable, persistent),
// closes on Esc, and flips to the other side when there is no room. It renders in a portal so its glass
// blurs the globe. The trigger keeps its own semantics; the card is `aria-describedby` target text.

import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import './hovercard.css';

export type Placement = 'top' | 'bottom' | 'left' | 'right';

export interface HoverCardProps {
  /** The card's content; rendered only while open. */
  card: ReactNode | (() => ReactNode);
  children: ReactNode;
  placement?: Placement;
  /** Delay before it opens on hover (focus opens at once). */
  delay?: number;
  /** Class for the wrapping element (default `hc-anchor`, an inline-flex box). */
  className?: string;
  /** Class for the card (size, padding). */
  cardClassName?: string;
  style?: CSSProperties;
  disabled?: boolean;
}

const GAP = 8;

export function HoverCard({
  card,
  children,
  placement = 'top',
  delay = 180,
  className,
  cardClassName,
  style,
  disabled,
}: HoverCardProps) {
  const id = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number; side: Placement } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const hovering = useRef(false);

  const show = useCallback(
    (wait: number) => {
      window.clearTimeout(timer.current);
      if (disabled) return;
      timer.current = window.setTimeout(() => setOpen(true), wait);
    },
    [disabled],
  );
  const hide = useCallback((wait = 90) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (!hovering.current) setOpen(false);
    }, wait);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  // Place the card against the anchor, flipping when it would leave the viewport.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const a = anchorRef.current?.getBoundingClientRect();
    const c = cardRef.current;
    if (!a || !c) return;
    const w = c.offsetWidth;
    const h = c.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let side = placement;
    const fits = {
      top: a.top - GAP - h >= 4,
      bottom: a.bottom + GAP + h <= vh - 4,
      left: a.left - GAP - w >= 4,
      right: a.right + GAP + w <= vw - 4,
    };
    if (!fits[side]) {
      const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[side] as Placement;
      if (fits[opposite]) side = opposite;
    }
    let x: number;
    let y: number;
    if (side === 'top' || side === 'bottom') {
      x = a.left + a.width / 2 - w / 2;
      y = side === 'top' ? a.top - GAP - h : a.bottom + GAP;
    } else {
      y = a.top + a.height / 2 - h / 2;
      x = side === 'left' ? a.left - GAP - w : a.right + GAP;
    }
    setPos({ x: Math.max(4, Math.min(x, vw - w - 4)), y: Math.max(4, Math.min(y, vh - h - 4)), side });
  }, [open, placement]);

  // Esc dismisses it.
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open]);

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the wrapper only observes pointer and focus events of the interactive child it wraps */}
      <span
        ref={anchorRef}
        className={className ?? 'hc-anchor'}
        style={style}
        aria-describedby={open ? id : undefined}
        onPointerEnter={() => {
          hovering.current = true;
          show(delay);
        }}
        onPointerLeave={() => {
          hovering.current = false;
          hide();
        }}
        onFocus={() => show(0)}
        onBlur={() => hide(0)}
      >
        {children}
      </span>
      {open
        ? createPortal(
            <div
              ref={cardRef}
              id={id}
              role="tooltip"
              className={cardClassName ? `hc-card ${cardClassName}` : 'hc-card'}
              data-side={pos?.side ?? placement}
              style={{ left: pos?.x ?? 0, top: pos?.y ?? 0, visibility: pos ? 'visible' : 'hidden' }}
              onPointerEnter={() => {
                hovering.current = true;
                window.clearTimeout(timer.current);
              }}
              onPointerLeave={() => {
                hovering.current = false;
                hide(120);
              }}
            >
              {typeof card === 'function' ? card() : card}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
