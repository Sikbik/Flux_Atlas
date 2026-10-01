// The kind chips under the palette's field. On a narrow card (a phone) the strip scrolls sideways, fades
// toward the chips that are out of sight, and keeps the chosen chip in view when Tab walks through them.
// The chips never take the keyboard from the input: they are `tabIndex -1` and a click hands focus back.
// The chosen chip carries `data-selected`, which the motion language's TabIndicator follows: one line under
// it that stretches to each new kind (the chips draw no selection mark of their own).

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TabIndicator } from '../../../motion/react/TabIndicator';
import { useAnimate } from '../../../ui';
import { KIND_CHIPS, type KindChip } from './types';

/** Which edges of the strip have more chips beyond them. */
export type Fade = 'start' | 'end' | 'both' | undefined;

/** The edges with content beyond them (1 px of slack absorbs sub-pixel scroll positions). */
export function fadeEdges(scrollLeft: number, clientWidth: number, scrollWidth: number, slack = 1): Fade {
  const start = scrollLeft > slack;
  const end = scrollLeft + clientWidth < scrollWidth - slack;
  if (start && end) return 'both';
  if (start) return 'start';
  if (end) return 'end';
  return undefined;
}

/** The width the strip fades to at an edge that has more chips beyond it (matches `--pal-fade` in palette.css). */
const FADE_PX = 28;

/**
 * The `scrollLeft` that brings a chip fully into view with `pad` px of clearance (the fade width, so the
 * chip is never under a fade). The current position when it already fits; never negative.
 */
export function revealLeft(
  view: { scrollLeft: number; width: number },
  item: { left: number; width: number },
  pad: number,
): number {
  const left = item.left - pad;
  const right = item.left + item.width + pad;
  if (item.width + pad * 2 > view.width) return Math.max(0, left);
  if (left < view.scrollLeft) return Math.max(0, left);
  if (right > view.scrollLeft + view.width) return Math.max(0, right - view.width);
  return view.scrollLeft;
}

export interface KindStripProps {
  chip: KindChip;
  counts: Record<KindChip, number>;
  /** Counts are shown only while there is text to count matches of. */
  showCounts: boolean;
  onPick(id: KindChip): void;
}

export function KindStrip({ chip, counts, showCounts, onPick }: KindStripProps) {
  const ref = useRef<HTMLDivElement>(null);
  const animate = useAnimate();
  const [fade, setFade] = useState<Fade>(undefined);

  // The fades follow the scroll position and the strip's own size (a chip grows when its count appears).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setFade(fadeEdges(el.scrollLeft, el.clientWidth, el.scrollWidth));
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    ro?.observe(el);
    for (const child of el.children) ro?.observe(child);
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  }, []);

  // Tab moves the chosen chip: bring it into view, clear of the fades. A chip that already shows stays put.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `chip` is the trigger; the node is read from the DOM
  useEffect(() => {
    const strip = ref.current;
    const on = strip?.querySelector<HTMLElement>('[data-selected]');
    if (!strip || !on) return;
    const at = strip.getBoundingClientRect().left;
    const left = revealLeft(
      { scrollLeft: strip.scrollLeft, width: strip.clientWidth },
      { left: on.getBoundingClientRect().left - at + strip.scrollLeft, width: on.offsetWidth },
      FADE_PX,
    );
    if (left !== strip.scrollLeft) strip.scrollTo?.({ left, behavior: animate ? 'smooth' : 'auto' });
  }, [chip, animate]);

  return (
    <div ref={ref} className="pal-kinds" role="radiogroup" aria-label="Kind of result" data-fade={fade}>
      {KIND_CHIPS.map((k) => {
        const n = counts[k.id];
        return (
          // biome-ignore lint/a11y/useSemanticElements: a segmented control inside a combobox popup; native radios would take the input's focus
          <button
            key={k.id}
            type="button"
            role="radio"
            aria-checked={chip === k.id}
            tabIndex={-1}
            className="pal-kind"
            data-selected={chip === k.id ? 'true' : undefined}
            onClick={() => onPick(k.id)}
          >
            {k.label}
            {showCounts && k.id !== 'all' && n > 0 ? <i>{n}</i> : null}
          </button>
        );
      })}
      <TabIndicator />
    </div>
  );
}
