// Hooks for the vocabulary. Each installs the engine (reference counted) so it works without a
// MotionRoot, and none of them re-renders the component: they only attach listeners or react to a
// value change inside an effect.

import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { installEngine, pulse, spark } from '../engine';
import type { FxHandle, PulseOptions, SparkOptions } from '../fxRunners';
import '../motion.css';

function useInstall(): void {
  useEffect(() => installEngine(), []);
}

const KEY_PRESS = new Set(['Enter', ' ']);

/**
 * Press feedback on one element: Pulse on pointer press and on Enter / Space. For elements that do
 * not carry `data-fx="press"`. Returns a trigger for custom cases (a long press, a programmatic click).
 */
export function usePulse<T extends HTMLElement>(
  ref: RefObject<T | null>,
  opts: Omit<PulseOptions, 'point'> & { enabled?: boolean } = {},
): (point?: { x: number; y: number }) => FxHandle | null {
  useInstall();
  const { enabled = true, tone, force } = opts;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const down = (e: PointerEvent) => {
      if ((e.pointerType === 'mouse' && e.button !== 0) || el.matches(':disabled')) return;
      pulse(el, { point: { x: e.clientX, y: e.clientY }, tone, force });
    };
    const key = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || !KEY_PRESS.has(e.key) || el.matches(':disabled'))
        return;
      if (e.key === ' ' && el.tagName === 'A') return;
      pulse(el, { tone, force });
    };
    el.addEventListener('pointerdown', down, { passive: true });
    el.addEventListener('keydown', key, { passive: true });
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('keydown', key);
    };
  }, [ref, enabled, tone, force]);
  return useCallback(
    (point) => {
      const el = ref.current;
      return el ? pulse(el, { point, tone, force }) : null;
    },
    [ref, tone, force],
  );
}

/**
 * Hover and focus light on one element: adds `charge` to its data-fx (the delegated layer tracks
 * the pointer, motion.css draws the edge). Use `data-fx="charge"` in JSX when you can; this is for
 * elements you do not render.
 */
export function useCharge<T extends HTMLElement>(ref: RefObject<T | null>, enabled = true): void {
  useInstall();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const before = el.getAttribute('data-fx');
    const tokens = new Set((before ?? '').split(/\s+/).filter(Boolean));
    if (tokens.has('charge')) return;
    tokens.add('charge');
    el.setAttribute('data-fx', [...tokens].join(' '));
    return () => {
      if (before === null) el.removeAttribute('data-fx');
      else el.setAttribute('data-fx', before);
    };
  }, [ref, enabled]);
}

/**
 * Spark when `on` turns true (a switch switched on, a watch toggled). Fires on the change only,
 * never on mount. Pass `delay` to wait for a sliding knob.
 */
export function useSpark<T extends Element>(
  ref: RefObject<T | null>,
  on: boolean,
  opts: SparkOptions = {},
): void {
  useInstall();
  const prev = useRef(on);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  useEffect(() => {
    const was = prev.current;
    prev.current = on;
    if (was || !on) return;
    const el = ref.current;
    if (!el) return;
    const h = spark(el, optsRef.current);
    return () => h?.cancel();
  }, [ref, on]);
}
