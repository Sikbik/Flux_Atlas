import { type RefObject, useLayoutEffect, useState } from 'react';

/**
 * The width of an element, kept current by a ResizeObserver; 0 until it is measured (and where there is no
 * observer). For a choice the layout cannot make in CSS alone, such as how many columns a grid table gets.
 */
export function useBoxWidth(ref: RefObject<Element | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(Math.round(el.getBoundingClientRect().width));
    read();
    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}
