// Mount once, at the app root. It starts the attribute-driven engine (the kit's data-pressed,
// data-state and data-fresh, plus data-fx tokens), mirrors the effective motion mode onto
// <html data-motion> (the attribute the tokens and the kit's components switch on; a mode the page
// forced there is left alone) and <html data-fx-mode>, and loads the effect runners on idle. It renders
// its children untouched: no wrapper element, no context, no re-renders.
//
// It needs nothing from its parents. Put it above anything that should join the language (the shell,
// the router outlet, the portals); it adds no DOM and costs one passive listener set at rest.

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
