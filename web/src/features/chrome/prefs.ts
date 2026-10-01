// Root attributes the stylesheets key off: `data-motion` and `data-perf` on <html> (tokens.css, section
// 15). The user's motion preference and performance tier live in store/ui.ts; the engine's governor
// (under `auto`) reports the tier it settled on. Everything here is a one-way sync to the document.

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
 * Keeps `<html data-motion>` and `<html data-perf>` in line with the preferences. `system` leaves the
 * OS media query in charge of the tokens; `off` is the reduced token set plus `data-motion-off`, which
 * the frame styles use to drop the remaining cross-fades.
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
    root.dataset.motion = motion === 'system' ? 'system' : motion === 'full' ? 'full' : 'reduced';
    if (motion === 'off') root.dataset.motionOff = '';
    else delete root.dataset.motionOff;
  }, [motion]);

  useEffect(() => {
    document.documentElement.dataset.perf = effectivePerf(perf, governor);
  }, [perf, governor]);
}
