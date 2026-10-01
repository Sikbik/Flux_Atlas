import {
  cloneElement,
  type ReactElement,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { Portal, useFloatingPosition } from '../internal/floating';
import type { Placement } from '../internal/position';
import './overlay.css';

export interface TooltipProps {
  /** What the tooltip says. Keep it short; for rich previews use HoverCard. */
  content: ReactNode;
  /** The single element that triggers it (a button, link or any focusable element that accepts a ref). */
  children: ReactElement;
  /** Preferred side (default `top`); it flips when there is no room. */
  placement?: Placement;
  /** Delay before showing on hover, in ms (default 120; 0 right after another tooltip closed). */
  delay?: number;
  /** Turn the tooltip off without unmounting the trigger. */
  disabled?: boolean;
}

// Moving between neighbouring controls should not make the user wait again for each tooltip.
let lastClosedAt = 0;
const WARM_MS = 350;

type Props = { ref?: Ref<HTMLElement>; [k: string]: unknown };

function assignRef(ref: Ref<HTMLElement> | undefined, el: HTMLElement | null): void {
  if (typeof ref === 'function') ref(el);
  else if (ref) (ref as { current: HTMLElement | null }).current = el;
}

/**
 * An accessible tooltip: shows on hover (mouse only, after a short delay) and on keyboard focus,
 * hides on pointer leave, blur and Escape (which it swallows, so the window under it stays open),
 * never covers its trigger and never takes the pointer.
 * The trigger gets `aria-describedby` while it is open.
 */
export function Tooltip({ content, children, placement = 'top', delay = 120, disabled }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const {
    floatingRef,
    style,
    placement: placed,
  } = useFloatingPosition({ open, anchor, placement, offset: 8 });

  const show = useCallback(
    (wait: number) => {
      clearTimeout(timer.current);
      if (disabled) return;
      const warm = Date.now() - lastClosedAt < WARM_MS;
      timer.current = setTimeout(() => setOpen(true), warm ? 0 : wait);
    },
    [disabled],
  );
  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setOpen((was) => {
      if (was) lastClosedAt = Date.now();
      return false;
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    // Capture phase and swallowed: Escape dismisses the tooltip only, never also the window under it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      hide();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, hide]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const child = children as ReactElement<Props>;
  const own = child.props;
  const repeatsName = typeof content === 'string' && own['aria-label'] === content;
  const trigger = cloneElement(child, {
    ref: (el: HTMLElement | null) => {
      setAnchor(el);
      assignRef(own.ref, el);
    },
    // A tooltip that only repeats the trigger's own accessible name adds nothing to describe.
    'aria-describedby': open && !repeatsName ? id : (own['aria-describedby'] as string | undefined),
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
      (own.onPointerEnter as ((e: React.PointerEvent<HTMLElement>) => void) | undefined)?.(e);
      if (e.pointerType === 'mouse') show(delay);
    },
    onPointerLeave: (e: React.PointerEvent<HTMLElement>) => {
      (own.onPointerLeave as ((e: React.PointerEvent<HTMLElement>) => void) | undefined)?.(e);
      hide();
    },
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      (own.onPointerDown as ((e: React.PointerEvent<HTMLElement>) => void) | undefined)?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      (own.onFocus as ((e: React.FocusEvent<HTMLElement>) => void) | undefined)?.(e);
      if (e.currentTarget.matches(':focus-visible')) show(0);
    },
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      (own.onBlur as ((e: React.FocusEvent<HTMLElement>) => void) | undefined)?.(e);
      hide();
    },
  } as Partial<Props>);

  return (
    <>
      {trigger}
      {open && !disabled ? (
        <Portal>
          <div
            ref={floatingRef}
            id={id}
            role="tooltip"
            className="ui-tooltip"
            data-side={placed?.split('-')[0]}
            style={style}
          >
            {content}
          </div>
        </Portal>
      ) : null}
    </>
  );
}
