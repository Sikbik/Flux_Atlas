// Motion mode for the interaction language: `full`, `reduced` or `off`.
//
// One source of truth: `effectiveMotion(useUi.motion)` (the Settings choice, or the OS preference
// when the choice is `system`). The mode is mirrored onto `<html data-fx-mode>` so CSS and the effect
// runners read the same value. Any element can carry its own `data-fx-mode` to scope a subtree (the
// /dev/motion gallery shows the three modes side by side this way); the nearest ancestor wins.

import { useSyncExternalStore } from 'react';
import { effectiveMotion, useUi } from '../store/ui';

export type MotionMode = 'full' | 'reduced' | 'off';

export const MODE_ATTR = 'data-fx-mode';
const MODES: readonly MotionMode[] = ['full', 'reduced', 'off'];

export function isMotionMode(v: unknown): v is MotionMode {
  return typeof v === 'string' && (MODES as readonly string[]).includes(v);
}

/** The mode the user's preferences ask for right now (store first, then the OS preference). */
export function currentMode(): MotionMode {
  return effectiveMotion(useUi.getState().motion);
}

/** The mode in force for an element: the nearest `data-fx-mode` ancestor, else the preferences. */
export function modeOf(el?: Element | null): MotionMode {
  const scoped = el?.closest?.(`[${MODE_ATTR}]`)?.getAttribute(MODE_ATTR);
  return isMotionMode(scoped) ? scoped : currentMode();
}

const listeners = new Set<() => void>();
let installs = 0;
let detach: (() => void) | null = null;

function writeRoot(): void {
  if (typeof document === 'undefined') return;
  const mode = currentMode();
  const root = document.documentElement;
  if (root.getAttribute(MODE_ATTR) !== mode) root.setAttribute(MODE_ATTR, mode);
  for (const fn of [...listeners]) fn();
}

/**
 * Mirrors the effective mode onto `<html data-fx-mode>` and keeps it current while the Settings
 * choice or the OS preference changes. Reference counted, so StrictMode double mounts and several
 * callers are safe; the last release removes the listeners and the attribute.
 */
export function installModeSync(): () => void {
  installs++;
  if (installs === 1 && typeof document !== 'undefined') {
    writeRoot();
    const unsub = useUi.subscribe((s, prev) => {
      if (s.motion !== prev.motion) writeRoot();
    });
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    mq?.addEventListener('change', writeRoot);
    detach = () => {
      unsub();
      mq?.removeEventListener('change', writeRoot);
      document.documentElement.removeAttribute(MODE_ATTR);
    };
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    installs--;
    if (installs === 0) {
      detach?.();
      detach = null;
    }
  };
}

function subscribeMode(cb: () => void): () => void {
  listeners.add(cb);
  const unsub = useUi.subscribe((s, prev) => {
    if (s.motion !== prev.motion) cb();
  });
  const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  mq?.addEventListener('change', cb);
  return () => {
    listeners.delete(cb);
    unsub();
    mq?.removeEventListener('change', cb);
  };
}

/** React: the effective mode (the Settings choice or the OS preference). */
export function useMotionMode(): MotionMode {
  return useSyncExternalStore(subscribeMode, currentMode, () => 'full');
}

/** Test hook: how many callers hold the install. */
export function installCount(): number {
  return installs;
}
