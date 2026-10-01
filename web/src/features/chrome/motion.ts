// Motion level for JS-driven animation (WAAPI, FLIP, the boot). CSS reads the duration tokens that
// `useRootPrefs` and the OS media query switch; this is the same decision made in JavaScript, from the
// persisted preference (store/ui.ts) and `prefers-reduced-motion`.

import { useSyncExternalStore } from 'react';
import { effectiveMotion, type MotionPref, useUi } from '../../store/ui';

export type MotionLevel = 'full' | 'reduced' | 'off';

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeReducedQuery(cb: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => {};
  const mq = matchMedia(REDUCED_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

const osPrefersReduced = (): boolean => typeof matchMedia === 'function' && matchMedia(REDUCED_QUERY).matches;

/** The level a preference resolves to (the OS setting applies only to `system`). */
export function resolveMotion(pref: MotionPref, osReduced: boolean): MotionLevel {
  if (pref === 'system') return osReduced ? 'reduced' : 'full';
  return pref;
}

/** The effective motion level; re-renders when the preference or the OS setting changes. */
export function useMotion(): MotionLevel {
  const pref = useUi((s) => s.motion);
  const os = useSyncExternalStore(subscribeReducedQuery, osPrefersReduced, () => false);
  return resolveMotion(pref, os);
}

/** The effective motion level right now (for imperative code). */
export const currentMotion = (): MotionLevel => effectiveMotion(useUi.getState().motion);

/** A duration for the current level: unchanged at full, capped to a cross-fade when reduced, zero when off. */
export function scaledMs(ms: number, level: MotionLevel = currentMotion()): number {
  if (level === 'off') return 0;
  return level === 'reduced' ? Math.min(ms, 160) : ms;
}

export interface PlayOptions extends KeyframeAnimationOptions {
  /** Keyframes used instead when motion is reduced (typically opacity only). Omit to skip the animation. */
  reduced?: Keyframe[];
}

/**
 * Plays a Web Animation on `el` for the current motion level and resolves to the animation (or null
 * when it was skipped). Callers animate `transform` and `opacity` only.
 */
export function play(el: Element, keyframes: Keyframe[], opts: PlayOptions): Animation | null {
  const level = currentMotion();
  if (level === 'off' || typeof (el as HTMLElement).animate !== 'function') return null;
  const { reduced, ...rest } = opts;
  if (level === 'reduced') {
    if (!reduced) return null;
    return el.animate(reduced, { ...rest, duration: Math.min(Number(rest.duration ?? 160), 160) });
  }
  return el.animate(keyframes, rest);
}

/** CSS custom property value as a number of milliseconds (`--dur-base` is `220ms`). */
export function cssMs(name: string, fallback: number, root: Element = document.documentElement): number {
  if (typeof getComputedStyle !== 'function') return fallback;
  const raw = getComputedStyle(root).getPropertyValue(name).trim();
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  return raw.endsWith('ms') ? n : raw.endsWith('s') ? n * 1000 : fallback;
}
