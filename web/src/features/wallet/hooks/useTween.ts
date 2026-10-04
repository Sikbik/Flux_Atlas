import { useEffect, useRef, useState } from 'react';
import { useMotionMode } from '../../../ui';

/**
 * A number that eases to its target (a chart's price scenario moving from one multiple to another). It runs a
 * frame loop only while it is moving and stands still otherwise; with reduced motion or none it is the target at
 * once. A new target mid-flight starts from wherever the value is.
 */
export function useTween(target: number, ms = 240): number {
  const mode = useMotionMode();
  const [value, setValue] = useState(target);
  const from = useRef(target);

  useEffect(() => {
    if (mode !== 'full' || ms <= 0 || typeof requestAnimationFrame !== 'function') {
      from.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - (1 - p) ** 3;
      const v = a + (target - a) * eased;
      from.current = v;
      setValue(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, mode]);

  return value;
}
