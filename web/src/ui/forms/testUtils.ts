// Test helpers for the form controls (jsdom). Not exported from the kit.

import { act } from 'react';

/** Sets an input's value the way a user typing would, so React's onChange fires. */
export function setValue(input: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(
      new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
}

/** Dispatches a bubbling `mousedown` (left button) on an element, inside `act`. */
export function mouseDown(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  });
}
