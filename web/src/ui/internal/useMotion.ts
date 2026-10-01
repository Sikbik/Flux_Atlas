// Motion mode for JS-driven animation. CSS follows the tokens and `prefers-reduced-motion` on its
// own; this hook gives the parts that animate in JS the same answer, from the same three sources in
// the same order: the root's `data-motion` attribute (the tokens switch on it, so a page that forces
// a mode, such as the gallery, a screenshot run or an embedding shell, gets one behaviour from CSS
// and JS), then the persisted preference in `store/ui.ts`, then the OS setting.

import { useSyncExternalStore } from 'react';
import { effectiveMotion, type MotionPref, useUi } from '../../store/ui';

export type MotionMode = 'full' | 'reduced' | 'off';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribeOs(cb: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => {};
  const mq = matchMedia(QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

const osReduced = () => (typeof matchMedia === 'function' ? matchMedia(QUERY).matches : false);

// One observer on the root element serves every mounted hook.
const rootListeners = new Set<() => void>();
let rootObserver: MutationObserver | null = null;

function subscribeRoot(cb: () => void): () => void {
  rootListeners.add(cb);
  if (!rootObserver && typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    rootObserver = new MutationObserver(() => {
      for (const listener of rootListeners) listener();
    });
    rootObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
  }
  return () => {
    rootListeners.delete(cb);
    if (rootListeners.size === 0) {
      rootObserver?.disconnect();
      rootObserver = null;
    }
  };
}

/** The mode forced by `<html data-motion>`, or null when the attribute is absent or not a mode. */
export function rootMotion(): MotionMode | null {
  if (typeof document === 'undefined') return null;
  const v = document.documentElement.dataset.motion;
  return v === 'full' || v === 'reduced' || v === 'off' ? v : null;
}

/** Resolves a preference against the OS setting; pure, for tests and non-React callers. */
export function resolveMotion(pref: MotionPref, osPrefersReduced: boolean): MotionMode {
  if (pref !== 'system') return effectiveMotion(pref);
  return osPrefersReduced ? 'reduced' : 'full';
}

/** The effective motion mode: `full`, `reduced` (cross-fades only) or `off` (instant). */
export function useMotionMode(): MotionMode {
  const pref = useUi((s) => s.motion);
  const os = useSyncExternalStore(subscribeOs, osReduced, () => false);
  const forced = useSyncExternalStore(subscribeRoot, rootMotion, () => null);
  return forced ?? resolveMotion(pref, os);
}

/** True when JS-driven animation may run (motion mode is `full`). */
export function useAnimate(): boolean {
  return useMotionMode() === 'full';
}
