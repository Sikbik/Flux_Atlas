// Mount once, near the app root. It starts the delegated input layer (data-fx attributes), mirrors
// the motion mode onto <html data-fx-mode> and loads the effect runners on idle. Renders its
// children untouched: no wrapper element, no context, no re-renders.

import { type ReactNode, useEffect } from 'react';
import { installEngine } from '../engine';
import '../motion.css';

export function MotionRoot({ children }: { children?: ReactNode }) {
  useEffect(() => installEngine(), []);
  return <>{children}</>;
}

/** Hook form of the same thing, for components that use the primitives without a MotionRoot above. */
export function useMotionEngine(): void {
  useEffect(() => installEngine(), []);
}
