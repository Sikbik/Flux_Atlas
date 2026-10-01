// A pressed state that is visible in the DOM. While a pointer button or Space/Enter is held on a
// control, the control carries `data-pressed`; CSS styles it, and the Flux motion primitives (Pulse on
// press) can attach to the same attribute without the component changing. The attribute is written
// to the element directly, so a press never re-renders React.

import type { FocusEvent, KeyboardEvent, PointerEvent } from 'react';

type Handler<E> = ((e: E) => void) | undefined;

/** The handlers a pressable element already has, called first so the caller's own behaviour is kept. */
export interface PressSource<T extends HTMLElement> {
  onPointerDown?: Handler<PointerEvent<T>>;
  onPointerUp?: Handler<PointerEvent<T>>;
  onPointerLeave?: Handler<PointerEvent<T>>;
  onPointerCancel?: Handler<PointerEvent<T>>;
  onKeyDown?: Handler<KeyboardEvent<T>>;
  onKeyUp?: Handler<KeyboardEvent<T>>;
  onBlur?: Handler<FocusEvent<T>>;
}

export interface PressHandlers<T extends HTMLElement> {
  onPointerDown: (e: PointerEvent<T>) => void;
  onPointerUp: (e: PointerEvent<T>) => void;
  onPointerLeave: (e: PointerEvent<T>) => void;
  onPointerCancel: (e: PointerEvent<T>) => void;
  onKeyDown: (e: KeyboardEvent<T>) => void;
  onKeyUp: (e: KeyboardEvent<T>) => void;
  onBlur: (e: FocusEvent<T>) => void;
}

const mark = (el: HTMLElement, on: boolean): void => {
  if (on) el.setAttribute('data-pressed', '');
  else el.removeAttribute('data-pressed');
};

const isActivationKey = (key: string): boolean => key === ' ' || key === 'Enter';

/**
 * Handlers that keep `data-pressed` on the element while it is pressed (primary pointer button, or
 * Space/Enter). Spread them after the element's other props, passing the caller's own handlers in
 * `own` so they still run.
 */
export function pressHandlers<T extends HTMLElement>(own: PressSource<T> = {}): PressHandlers<T> {
  return {
    onPointerDown: (e) => {
      own.onPointerDown?.(e);
      if (e.button === 0) mark(e.currentTarget, true);
    },
    onPointerUp: (e) => {
      own.onPointerUp?.(e);
      mark(e.currentTarget, false);
    },
    onPointerLeave: (e) => {
      own.onPointerLeave?.(e);
      mark(e.currentTarget, false);
    },
    onPointerCancel: (e) => {
      own.onPointerCancel?.(e);
      mark(e.currentTarget, false);
    },
    onKeyDown: (e) => {
      own.onKeyDown?.(e);
      if (isActivationKey(e.key)) mark(e.currentTarget, true);
    },
    onKeyUp: (e) => {
      own.onKeyUp?.(e);
      if (isActivationKey(e.key)) mark(e.currentTarget, false);
    },
    onBlur: (e) => {
      own.onBlur?.(e);
      mark(e.currentTarget, false);
    },
  };
}
