// Test helpers for the overlays (jsdom). Not exported from the kit.

import { act } from 'react';
import { useUi } from '../../store/ui';

/** Makes overlays unmount the instant they close (motion off), restoring the preference afterwards. */
export function instantMotion(): () => void {
  const before = useUi.getState().motion;
  useUi.setState({ motion: 'off' });
  return () => useUi.setState({ motion: before });
}

/** A pointer press on an element (what the outside-press listener hears), inside `act`. */
export function pointerDown(el: Element): void {
  act(() => {
    el.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
  });
}

/** A pointer move over an element, inside `act`. */
export function pointerMove(el: Element): void {
  act(() => {
    el.dispatchEvent(new Event('pointermove', { bubbles: true, cancelable: true }));
  });
}

/** A click that came from a pointer (`detail` 1), as opposed to Enter or Space on a button (`detail` 0). */
export function pointerClick(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
  });
}

/** Everything in `document.body` with this role (overlays render in a portal, outside the mount container). */
export function byRole(role: string): HTMLElement[] {
  return Array.from(document.body.querySelectorAll<HTMLElement>(`[role="${role}"]`));
}
