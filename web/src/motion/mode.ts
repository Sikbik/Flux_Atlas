// Motion mode for the interaction language: `full`, `reduced` or `off`.
//
// The same answer as the UI kit's `useMotionMode()` (ui/internal/useMotion.ts), from the same sources
// in the same order, so CSS, kit components and these effects never disagree:
//
//   1. the nearest `[data-fx-mode]` on an ancestor: a subtree override (the /dev/motion gallery shows
//      the three modes side by side this way; apps do not use it);
//   2. `<html data-motion>`: a mode forced by the page (a gallery, a screenshot run, an embedding
//      shell). The tokens in styles/tokens.css and the kit's stylesheets switch on this attribute;
//   3. the persisted preference (`useUi.motion`), where `system` follows the OS setting.
//
// Nothing else mirrors the stored preference to `<html data-motion>`. `installModeSync()` (run by
// <MotionRoot/>) does: it writes the effective mode there while no one has forced one, and never
// overwrites a value it did not write. It also keeps `<html data-fx-mode>` current, the resolved mode
// that this module's own CSS and runners read.

import { useSyncExternalStore } from 'react';
import { effectiveMotion, useUi } from '../store/ui';

export type MotionMode = 'full' | 'reduced' | 'off';

/** The attribute the kit and the tokens switch on. */
export const ROOT_ATTR = 'data-motion';
/** The resolved mode, on `<html>` and on any subtree that overrides it. */
export const MODE_ATTR = 'data-fx-mode';
const MODES: readonly MotionMode[] = ['full', 'reduced', 'off'];

export function isMotionMode(v: unknown): v is MotionMode {
  return typeof v === 'string' && (MODES as readonly string[]).includes(v);
}

/** The mode the stored preference asks for right now (the OS setting when it is `system`). */
export function currentMode(): MotionMode {
  return effectiveMotion(useUi.getState().motion);
}

/** The mode forced by `<html data-motion>`, or null when the attribute is absent or not a mode. */
export function rootMotion(): MotionMode | null {
  if (typeof document === 'undefined') return null;
  const v = document.documentElement.getAttribute(ROOT_ATTR);
  return isMotionMode(v) ? v : null;
}

/** The mode for the document as a whole: a forced root attribute, else the preference. */
export function documentMode(): MotionMode {
  return rootMotion() ?? currentMode();
}

/** The mode in force for an element: the nearest `data-fx-mode` ancestor, else the document's. */
export function modeOf(el?: Element | null): MotionMode {
  // `<html data-fx-mode>` is only the mirror of the document's mode for CSS; read the sources for it.
  const holder = el?.closest?.(`[${MODE_ATTR}]`);
  const scoped =
    holder && holder !== holder.ownerDocument.documentElement ? holder.getAttribute(MODE_ATTR) : null;
  return isMotionMode(scoped) ? scoped : documentMode();
}

const listeners = new Set<() => void>();
let installs = 0;
let detach: (() => void) | null = null;
/** The value this module last wrote to `<html data-motion>`: anything else there was put by someone else. */
let written: MotionMode | null = null;

/**
 * Brings `<html data-motion>` and `<html data-fx-mode>` in line with the sources. A valid value in
 * `data-motion` that this module did not write is a forced mode and wins; otherwise the effective
 * mode of the preference is written there, which is what the kit's tokens and components expect.
 */
function sync(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const attr = root.getAttribute(ROOT_ATTR);
  let mode: MotionMode;
  if (isMotionMode(attr) && attr !== written) {
    mode = attr; // forced by the page
    written = null;
  } else {
    mode = currentMode();
    if (attr !== mode) root.setAttribute(ROOT_ATTR, mode);
    written = mode;
  }
  if (root.getAttribute(MODE_ATTR) !== mode) root.setAttribute(MODE_ATTR, mode);
  for (const fn of [...listeners]) fn();
}

/**
 * Starts mirroring the motion mode (see the file header) and keeps it current while the Settings
 * choice, the OS preference or a forced `data-motion` changes. Reference counted, so StrictMode double
 * mounts and several callers are safe; the last release removes what this module wrote.
 */
export function installModeSync(): () => void {
  installs++;
  if (installs === 1 && typeof document !== 'undefined') {
    sync();
    const unsub = useUi.subscribe((s, prev) => {
      if (s.motion !== prev.motion) sync();
    });
    const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    mq?.addEventListener('change', sync);
    const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => sync());
    observer?.observe(document.documentElement, { attributes: true, attributeFilter: [ROOT_ATTR] });
    detach = () => {
      unsub();
      mq?.removeEventListener('change', sync);
      observer?.disconnect();
      const root = document.documentElement;
      if (written !== null && root.getAttribute(ROOT_ATTR) === written) root.removeAttribute(ROOT_ATTR);
      root.removeAttribute(MODE_ATTR);
      written = null;
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

/**
 * React: the effective mode of the document. Prefer the kit's `useMotionMode()` in views; this one
 * exists for the primitives in this folder and answers identically.
 */
export function useMotionMode(): MotionMode {
  return useSyncExternalStore(subscribeMode, documentMode, () => 'full');
}

/** Test hook: how many callers hold the install. */
export function installCount(): number {
  return installs;
}
