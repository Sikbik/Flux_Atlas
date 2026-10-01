// The idle watch: after a configurable time with no input, ambient mode starts by itself. One timer
// chain, no per-event work beyond a timestamp: input handlers only record `lastInput`, and the timer
// recomputes how much quiet is left when it fires.
//
// Rules: only while the tab is visible; never while something holds idle (a live `tail` in the
// terminal); never when the setting is "never"; and a dissolve the idle watch started is cancelled by
// any real input before it reaches the route change.

import type { AnyRouter } from '@tanstack/react-router';
import { usePrefs } from '../settings/prefs';
import { cancelAmbientEntry, enterAmbient, isAmbientPath, pendingEntryVia } from './enter';

let lastInput = Date.now();
let holds = 0;

/** Keeps the idle watch from entering ambient mode until the returned release is called. */
export function holdIdle(): () => void {
  holds++;
  lastInput = Date.now();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
    lastInput = Date.now();
  };
}

export function noteInput(): void {
  lastInput = Date.now();
}

let started: (() => void) | null = null;

/** Starts the watch once; returns a stop function (calling it again after a stop starts afresh). */
export function startIdleWatch(router: AnyRouter): () => void {
  if (started) return started;
  let timer: number | null = null;

  const onInput = (e: Event) => {
    lastInput = Date.now();
    // An idle dissolve gives way to the first sign of life (a pointer must travel a little first).
    if (pendingEntryVia() === 'idle') {
      if (e.type === 'pointermove') {
        const m = e as PointerEvent;
        if (Math.abs(m.movementX) + Math.abs(m.movementY) < 3) return;
      }
      cancelAmbientEntry();
    }
  };

  const schedule = (ms: number) => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(check, Math.max(1000, ms));
  };

  function check(): void {
    timer = null;
    const mins = usePrefs.getState().ambientIdleMin;
    if (mins <= 0) {
      schedule(30_000);
      return;
    }
    const need = mins * 60_000;
    const quiet = Date.now() - lastInput;
    if (quiet >= need) {
      if (document.visibilityState === 'visible' && holds === 0 && !isAmbientPath(router)) {
        enterAmbient(router, 'idle');
        // Whether or not it started, check again after another full period.
        lastInput = Date.now();
      }
      schedule(need);
      return;
    }
    schedule(need - quiet);
  }

  const events = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
  for (const ev of events) window.addEventListener(ev, onInput, { capture: true, passive: true });
  const unsubPrefs = usePrefs.subscribe((s, prev) => {
    if (s.ambientIdleMin !== prev.ambientIdleMin) {
      lastInput = Date.now();
      schedule(Math.max(1, s.ambientIdleMin) * 60_000);
    }
  });
  schedule(Math.max(1, usePrefs.getState().ambientIdleMin) * 60_000);

  const stop = () => {
    for (const ev of events) window.removeEventListener(ev, onInput, { capture: true });
    unsubPrefs();
    if (timer !== null) window.clearTimeout(timer);
    started = null;
  };
  started = stop;
  return stop;
}
