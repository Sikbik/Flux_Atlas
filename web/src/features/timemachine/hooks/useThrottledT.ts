// The playhead as React state at a calm rate. The controller reports every pointer move and animation
// frame; a label that spells the time out does not need to re-render that often (design: counters swap
// without rolling, throttled to 30 fps).

import { useEffect, useState } from 'react';
import type { TimeMachine } from '../lib/controller';

/** The playhead (unix ms), re-rendering the caller at most every `ms` milliseconds. */
export function useThrottledT(tm: TimeMachine, ms = 33): number {
  const [t, setT] = useState(() => tm.getT());
  useEffect(() => {
    let last = 0;
    let latest = tm.getT();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      timer = undefined;
      last = performance.now();
      setT(latest);
    };
    const off = tm.subscribeT((v) => {
      latest = v;
      const wait = last + ms - performance.now();
      if (wait <= 0) flush();
      else if (timer === undefined) timer = setTimeout(flush, wait);
    });
    // The mode can change without the playhead moving (live to archive at the same instant).
    const offState = tm.subscribe(() => {
      latest = tm.getT();
      if (timer === undefined) timer = setTimeout(flush, 0);
    });
    setT(tm.getT());
    return () => {
      off();
      offState();
      clearTimeout(timer);
    };
  }, [tm, ms]);
  return t;
}
