// Pointer-follow light for interactive surfaces. The surface paints a radial gradient centred on
// `--ui-mx` / `--ui-my`; this hook keeps those two properties current while a mouse hovers it.

import { type PointerEvent, useCallback, useEffect, useRef } from 'react';

interface Sample {
  el: HTMLElement;
  x: number;
  y: number;
}

/**
 * Returns a `onPointerMove` handler that writes `--ui-mx` and `--ui-my` (px from the element's top
 * left) at most once per frame. Touch and pen input do nothing: there is no hover to follow.
 */
export function useSpotlight<T extends HTMLElement>(): (e: PointerEvent<T>) => void {
  const frame = useRef(0);
  const sample = useRef<Sample | null>(null);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  return useCallback((e: PointerEvent<T>) => {
    if (e.pointerType !== 'mouse') return;
    sample.current = { el: e.currentTarget, x: e.clientX, y: e.clientY };
    if (frame.current !== 0) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const s = sample.current;
      if (!s) return;
      const r = s.el.getBoundingClientRect();
      s.el.style.setProperty('--ui-mx', `${Math.round(s.x - r.left)}px`);
      s.el.style.setProperty('--ui-my', `${Math.round(s.y - r.top)}px`);
    });
  }, []);
}
