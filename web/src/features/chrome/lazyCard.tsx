// Hover card bodies that load on demand. A card shows detail nobody needs until the pointer or focus is on
// its trigger, so its code is its own chunk, fetched when the pointer first nears the trigger (`preload`,
// well before the card's open delay runs out) and kept by the module cache after that. The shell chunk
// carries only the triggers.

import { type ComponentType, type JSX, lazy, Suspense } from 'react';

export interface LazyCard<P extends object> {
  /** Renders the card: nothing until its code has loaded, which the preload makes rare. */
  Card: ComponentType<P>;
  /** Starts fetching the card's code; call it from the trigger's pointer-enter and focus handlers. */
  preload: () => void;
}

export function lazyCard<P extends object>(load: () => Promise<ComponentType<P>>): LazyCard<P> {
  const Lazy = lazy(() => load().then((component) => ({ default: component })));
  const Card = (props: P) => (
    <Suspense fallback={null}>
      <Lazy {...(props as P & JSX.IntrinsicAttributes)} />
    </Suspense>
  );
  return {
    Card,
    preload: () => {
      void load();
    },
  };
}
