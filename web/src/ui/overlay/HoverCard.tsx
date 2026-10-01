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

export interface HoverCardProps {
  /** The preview: a node, or a function that is only called while the card is open (lazy data). */
  content: ReactNode | (() => ReactNode);
  /** The single element that triggers it (a link or button that accepts a ref). */
  children: ReactElement;
  /** Accessible name of the card. */
  label?: string;
  /** Preferred side (default `bottom-start`); it flips when there is no room. */
  placement?: Placement;
  /** Delay before opening on hover, in ms (design 8.17: 180). */
  openDelay?: number;
  /** Grace period before closing after the pointer leaves, so it can travel to the card (default 140). */
  closeDelay?: number;
  /** Turn the card off without unmounting the trigger. */
  disabled?: boolean;
}

type Props = { ref?: Ref<HTMLElement>; [k: string]: unknown };

function assignRef(ref: Ref<HTMLElement> | undefined, el: HTMLElement | null): void {
  if (typeof ref === 'function') ref(el);
  else if (ref) (ref as { current: HTMLElement | null }).current = el;
}

/**
 * A tooltip with substance: a glass card that opens after 180 ms of hover (mouse only: on touch the
 * tap opens the inspector instead) or on keyboard focus, and stays open while the pointer is on it,
 * so it can hold links and actions. Escape closes it.
 */
export function HoverCard({
  content,
  children,
  label,
  placement = 'bottom-start',
  openDelay = 180,
  closeDelay = 140,
  disabled,
}: HoverCardProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const {
    floatingRef,
    style,
    placement: placed,
  } = useFloatingPosition({ open, anchor, placement, offset: 8 });

  const schedule = useCallback(
    (next: boolean, wait: number) => {
      clearTimeout(timer.current);
      if (disabled && next) return;
      timer.current = setTimeout(() => setOpen(next), wait);
    },
    [disabled],
  );
  const cancel = useCallback(() => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!open) return;
    // Capture phase and swallowed: Escape closes the card only, never also the window under it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      clearTimeout(timer.current);
      setOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const child = children as ReactElement<Props>;
  const own = child.props;
  const trigger = cloneElement(child, {
    ref: (el: HTMLElement | null) => {
      setAnchor(el);
      assignRef(own.ref, el);
    },
    'aria-describedby': open ? id : (own['aria-describedby'] as string | undefined),
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
      (own.onPointerEnter as ((e: React.PointerEvent<HTMLElement>) => void) | undefined)?.(e);
      if (e.pointerType === 'mouse') schedule(true, openDelay);
    },
    onPointerLeave: (e: React.PointerEvent<HTMLElement>) => {
      (own.onPointerLeave as ((e: React.PointerEvent<HTMLElement>) => void) | undefined)?.(e);
      schedule(false, closeDelay);
    },
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      (own.onFocus as ((e: React.FocusEvent<HTMLElement>) => void) | undefined)?.(e);
      if (e.currentTarget.matches(':focus-visible')) schedule(true, 0);
    },
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      (own.onBlur as ((e: React.FocusEvent<HTMLElement>) => void) | undefined)?.(e);
      schedule(false, closeDelay);
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
            role="dialog"
            aria-label={label}
            className="ui-hovercard"
            data-side={placed?.split('-')[0]}
            style={style}
            onPointerEnter={cancel}
            onPointerLeave={() => schedule(false, closeDelay)}
          >
            {typeof content === 'function' ? content() : content}
          </div>
        </Portal>
      ) : null}
    </>
  );
}
