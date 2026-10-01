// Test helpers for kit components: mount into jsdom without a testing-library dependency. Use with
// `// @vitest-environment jsdom` at the top of the test file.

import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';

export interface Mounted {
  container: HTMLElement;
  rerender(ui: ReactElement): void;
  unmount(): void;
}

/** Mounts a React element into a detached-then-attached container; call `unmount()` when done. */
export function mount(ui: ReactElement): Mounted {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return {
    container,
    rerender: (next) => act(() => root.render(next)),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** Dispatches a bubbling keydown on an element, inside `act`. */
export function press(el: Element, key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
}

/** Clicks an element, inside `act`. */
export function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

/** Runs `fn` inside `act` (state updates flush before it returns). */
export function flush(fn: () => void): void {
  act(fn);
}
