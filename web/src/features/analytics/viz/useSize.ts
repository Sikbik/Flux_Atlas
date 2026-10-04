import { type RefObject, useEffect, useLayoutEffect, useState } from 'react';

export interface Size {
  width: number;
  height: number;
}

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** A scale this close to 1 is rounding, not a transform: the bounding box is kept as it is. */
const SCALE_EPSILON = 0.01;

/** One side of the layout size: the bounding box with the scale of an ancestor's transform taken back out. */
function unscale(box: number, offset: number): number {
  const scale = offset > 0 && box > 0 ? box / offset : 1;
  return Math.abs(scale - 1) < SCALE_EPSILON ? box : box / scale;
}

/**
 * The border box of an element in its own (layout) pixels. A window that opens, maximizes or restores plays a scale
 * transform, and the bounding box is scaled with it: read mid-animation it is the size of one frame of the animation,
 * and nothing observes the transform ending, so a chart would stay that size. `offsetWidth` and `offsetHeight` ignore
 * transforms, so their ratio to the bounding box is the scale. Where there is no layout (jsdom) they are 0 and the
 * bounding box is used as it is.
 */
export function layoutSize(el: HTMLElement): Size {
  const r = el.getBoundingClientRect();
  return { width: unscale(r.width, el.offsetWidth), height: unscale(r.height, el.offsetHeight) };
}

/** The size of an element's border box in layout pixels, kept current by a ResizeObserver (0 x 0 until measured). */
export function useSize<T extends HTMLElement>(ref: RefObject<T | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const next = layoutSize(el);
      setSize((prev) =>
        Math.abs(prev.width - next.width) < 0.5 && Math.abs(prev.height - next.height) < 0.5 ? prev : next,
      );
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}
