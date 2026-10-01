// Motion preference for JS-driven animation (CSS animation follows the tokens and the
// `prefers-reduced-motion` media query on its own). One source: the persisted preference in
// `store/ui.ts` plus the OS setting, through `effectiveMotion`.

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

/** Resolves a preference against the OS setting; pure, for tests and non-React callers. */
export function resolveMotion(pref: MotionPref, osPrefersReduced: boolean): MotionMode {
  if (pref !== 'system') return effectiveMotion(pref);
  return osPrefersReduced ? 'reduced' : 'full';
}

/** The effective motion mode: `full`, `reduced` (cross-fades only) or `off` (instant). */
export function useMotionMode(): MotionMode {
  const pref = useUi((s) => s.motion);
  const os = useSyncExternalStore(subscribeOs, osReduced, () => false);
  return resolveMotion(pref, os);
}

/** True when JS-driven animation may run (motion mode is `full`). */
export function useAnimate(): boolean {
  return useMotionMode() === 'full';
}
