// Entering and leaving ambient mode. Ambient is the `/ambient` route (the globe follows the URL and the
// engine's director takes over), so entering is a navigation and leaving is a navigation back to where
// the user was. This module keeps the "where" (module state: the shell is unmounted while ambient runs)
// and plays the dissolve: the chrome fades out before the route changes and fades back in after.
//
// The dissolve is driven by `data-ambient-phase` on <html> (rules in ../command/layer.css):
//   out   the chrome fades to nothing (--dur-ambient-out), then the route changes
//   hold  on the way back: the chrome mounts invisible, with no transition
//   run   the chrome fades in (--dur-ambient-in)
//
// Leaving prefers `history.back()` when the entry we pushed is still current: the browser then restores
// exactly the URL it left, and the engine's director flies the camera back to where it was.

import type { AnyRouter } from '@tanstack/react-router';
import { effectiveMotion, useUi } from '../../store/ui';
import { track } from '../achievements/events';
import { currentHistoryIndex } from '../command/paletteUrl';

export type AmbientVia = 'idle' | 'manual' | 'kiosk';

/** Matches `--dur-ambient-out` and `--dur-ambient-in` (tokens.css): JS waits as long as the CSS runs. */
const DISSOLVE_OUT_MS = 900;
const DISSOLVE_IN_MS = 520;

let remembered: string | null = null;
let ambientIndex: number | null = null;
/** How the current ambient run was started by the app; null when the page was opened (or linked) straight onto /ambient. */
let routedVia: AmbientVia | null = null;
let entryTimer: number | null = null;
let entryVia: AmbientVia | null = null;
let phaseTimer: number | null = null;

const root = (): HTMLElement => document.documentElement;

export const isAmbientPath = (router: AnyRouter): boolean => router.state.location.pathname === '/ambient';

/** The current URL without the palette's own `q` (the palette is never part of "where you were"). */
export function hrefWithoutPalette(router: AnyRouter): string {
  const loc = router.state.location;
  const params = new URLSearchParams(loc.searchStr ?? '');
  params.delete('q');
  const qs = params.toString();
  const hash = loc.hash ? `#${loc.hash.replace(/^#/, '')}` : '';
  return `${loc.pathname}${qs ? `?${qs}` : ''}${hash}`;
}

function setPhase(phase: 'out' | 'hold' | 'run' | null, clearAfterMs?: number): void {
  if (phaseTimer !== null) {
    window.clearTimeout(phaseTimer);
    phaseTimer = null;
  }
  if (phase) root().setAttribute('data-ambient-phase', phase);
  else root().removeAttribute('data-ambient-phase');
  if (clearAfterMs !== undefined) phaseTimer = window.setTimeout(() => setPhase(null), clearAfterMs);
}

/** True while the chrome is dissolving, before the route changes. */
export function ambientEntering(): boolean {
  return entryTimer !== null;
}

/** How the pending entry was started (the idle watch cancels only its own). */
export function pendingEntryVia(): AmbientVia | null {
  return entryTimer !== null ? entryVia : null;
}

/** Stops a dissolve that has not reached the route change (the user moved before it finished). */
export function cancelAmbientEntry(): boolean {
  if (entryTimer === null) return false;
  window.clearTimeout(entryTimer);
  entryTimer = null;
  entryVia = null;
  setPhase('run', DISSOLVE_IN_MS + 60);
  return true;
}

/** Starts ambient mode: the chrome dissolves, then the route changes to `/ambient`. */
export function enterAmbient(router: AnyRouter, via: AmbientVia = 'manual'): void {
  if (isAmbientPath(router) || entryTimer !== null) return;
  const go = () => {
    entryTimer = null;
    entryVia = null;
    if (isAmbientPath(router)) return;
    remembered = hrefWithoutPalette(router);
    routedVia = via;
    void router.navigate({ to: '/ambient' } as never).then(() => {
      ambientIndex = currentHistoryIndex(router);
      setPhase(null);
    });
    track({ type: 'ambient', action: 'enter', via });
  };
  if (effectiveMotion(useUi.getState().motion) !== 'full') {
    go();
    return;
  }
  entryVia = via;
  setPhase('out');
  entryTimer = window.setTimeout(go, DISSOLVE_OUT_MS);
}

/** How the ambient view now on screen was entered: by the app, or as a kiosk (a page load or a link onto /ambient). */
export function ambientVia(): AmbientVia {
  return routedVia ?? 'kiosk';
}

/** The ambient view tells this module it is on screen, so a direct entry (dock, reload) can still leave by going back. */
export function adoptAmbientEntry(router: AnyRouter): void {
  if (ambientIndex === null) ambientIndex = currentHistoryIndex(router);
}

/** Leaves ambient mode for the route the user was on. */
export function exitAmbient(router: AnyRouter): void {
  if (!isAmbientPath(router)) return;
  const was = remembered;
  remembered = null;
  routedVia = null;
  track({ type: 'ambient', action: 'exit', via: 'manual' });
  // The chrome mounts invisible and fades in once the route has resolved.
  setPhase('hold', 1800);
  const unsub = router.subscribe('onResolved', () => {
    unsub();
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => setPhase('run', DISSOLVE_IN_MS + 80)),
    );
  });
  const here = currentHistoryIndex(router);
  const canBack = ambientIndex !== null && here === ambientIndex && router.history.canGoBack();
  ambientIndex = null;
  if (canBack) {
    router.history.back();
    return;
  }
  void router.navigate({ href: was ?? '/', replace: true } as never);
}
