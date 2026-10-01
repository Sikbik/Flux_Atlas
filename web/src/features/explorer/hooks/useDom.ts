import { type RefObject, useEffect, useState } from 'react';

/** True while the element is (nearly) in view. `once` latches the first time it is seen. */
export function useVisible<T extends Element>(
  ref: RefObject<T | null>,
  opts: { once?: boolean; margin?: string } = {},
): boolean {
  const [seen, setSeen] = useState(false);
  const once = opts.once ?? false;
  const margin = opts.margin ?? '120px';
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setSeen(true);
            if (once) io.disconnect();
          } else if (!once) setSeen(false);
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, once, margin]);
  return seen;
}

/**
 * True once the caller has stayed mounted for `ms`. A row in a long list that has to fetch something
 * waits this long first, so scrolling past a thousand rows asks the server for none of them.
 */
export function useDwell(ms: number): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setOn(true), ms);
    return () => clearTimeout(id);
  }, [ms]);
  return on;
}

/** Re-renders the caller when the element's own size changes (width only). */
export function useWidth(ref: RefObject<Element | null>): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) setW(Math.round(e.contentRect.width));
    });
    ro.observe(el);
    setW(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, [ref]);
  return w;
}
