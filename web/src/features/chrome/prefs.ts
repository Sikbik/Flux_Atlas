// Root attributes the chrome's stylesheets key off: `data-perf` and the `data-motion-off` marker on <html>. The
// user's motion preference and performance tier live in store/ui.ts; the engine's governor (under `auto`) reports
// the tier it settled on. Everything here is a one-way sync to the document.
//
// `<html data-motion>` itself is not written here. The motion root (motion/react/MotionRoot) is its one writer
// (`full`, `reduced` or `off`) and takes any other writer's value for a mode the page forced: this module used to
// write `reduced` for Off, and the Off setting then read as Reduced to the kit and to every effect.

import { useEffect, useState } from 'react';
import { useGlobeEngine } from '../../globe';
import { type PerfPref, useUi } from '../../store/ui';

type Tier = Exclude<PerfPref, 'auto'>;

/** The tier a governor quality level stands for (the engine says low, medium or high). */
export function tierForQuality(level: string): Tier {
  return level === 'low' ? 'lite' : level === 'high' ? 'high' : 'balanced';
}

/** The tier `data-perf` carries: an explicit choice wins; `auto` follows the engine's governor. */
export function effectivePerf(pref: PerfPref, governor: string | null): Tier {
  if (pref !== 'auto') return pref;
  return governor === null ? 'balanced' : tierForQuality(governor);
}

/**
 * Keeps `<html data-perf>` and the `<html data-motion-off>` marker in line with the preferences. The marker is
 * present exactly while the preference is Off (the motion root writes `data-motion="off"` beside it); the frame's
 * stylesheets use it to drop the cross-fades that remain.
 */
export function useRootPrefs(): void {
  const motion = useUi((s) => s.motion);
  const perf = useUi((s) => s.perf);
  const engine = useGlobeEngine();
  const [governor, setGovernor] = useState<string | null>(null);

  useEffect(() => {
    if (!engine) return;
    return engine.on('quality', (q) => setGovernor(q.level));
  }, [engine]);

  useEffect(() => {
    const root = document.documentElement;
    if (motion === 'off') root.dataset.motionOff = '';
    else delete root.dataset.motionOff;
  }, [motion]);

  useEffect(() => {
    document.documentElement.dataset.perf = effectivePerf(perf, governor);
  }, [perf, governor]);
}
