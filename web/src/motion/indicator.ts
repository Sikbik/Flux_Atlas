// The selection indicator: the line under the active tab (or any "one of N" control) that travels to
// the new selection. The leading edge arrives first with a bright head and the trailing edge catches
// up, so the line stretches and relaxes like current finding a new path.
//
// It watches the host, not the app: a MutationObserver on aria-selected / aria-current /
// data-selected and a ResizeObserver, so a Tabs component needs no props wired to it. Idle cost is
// zero (observers only fire on change). The line is a clip on a registered custom property pair
// (--fx-l, --fx-r): a 2px strip repainted for 300 ms, never layout.

import { lease, loadRunners } from './engine';
import { modeOf } from './mode';
import { DUR, EASE } from './timing';

/**
 * What marks the selected tab: `aria-selected`, `data-selected`, or any `aria-current` that is not `false`
 * (`page` on a bar of routes, `true`, `step`, `location`).
 */
export const SELECTED =
  '[aria-selected="true"], [aria-current]:not([aria-current="false"]), [data-selected="true"]';
const ATTRS = ['aria-selected', 'aria-current', 'data-selected'];

export interface Span {
  l: number;
  r: number;
}

export interface IndicatorControl {
  /** Re-measure now (after a font loads, a tab is added). */
  sync(animate?: boolean): void;
  dispose(): void;
}

/**
 * Where the selected tab is, in the host's own pixels. The rectangles are what is painted, so a host that is
 * mid-scale (a panel powering on, a window opening: the palette's chips mount while it is still at 97%) has
 * every distance painted too short by the same factor. The factor is the painted width over the layout width
 * (`offsetWidth` ignores transforms); within a pixel of each other there is no scale at all, which also keeps
 * the rounding of `offsetWidth` out of an ordinary host.
 */
export function measure(host: HTMLElement, selector: string): Span | null {
  const tab = host.querySelector(selector);
  if (!tab) return null;
  const hr = host.getBoundingClientRect();
  const tr = tab.getBoundingClientRect();
  const layout = host.offsetWidth;
  const k = layout > 0 && hr.width > 0 && Math.abs(hr.width - layout) > 1 ? hr.width / layout : 1;
  const l = (tr.left - hr.left) / k - host.clientLeft + host.scrollLeft;
  return { l, r: l + tr.width / k };
}

export function createIndicator(bar: HTMLElement, host: HTMLElement, selector = SELECTED): IndicatorControl {
  let at: Span | null = null;
  let running: Animation[] = [];
  let holder: { release(): void } | null = null;

  const stop = () => {
    for (const a of running) a.cancel();
    running = [];
    holder?.release();
    holder = null;
  };

  const place = (s: Span) => {
    bar.style.setProperty('--fx-l', `${s.l}px`);
    bar.style.setProperty('--fx-r', `${s.r}px`);
    bar.style.setProperty('--fx-hl', '0');
    bar.style.setProperty('--fx-hr', '0');
  };

  const sync = (animate = true) => {
    // The bar is as wide as the content so a scrolled tab list keeps its line.
    bar.style.right = 'auto';
    bar.style.width = `${host.scrollWidth}px`;
    const next = measure(host, selector);
    if (!next) {
      stop();
      bar.style.opacity = '0';
      at = null;
      return;
    }
    bar.style.opacity = '';
    const prev = at;
    at = next;
    stop();
    place(next);
    if (!animate || !prev || (prev.l === next.l && prev.r === next.r)) return;
    if (modeOf(host) !== 'full' || typeof bar.animate !== 'function') return;
    holder = lease('slide', bar, stop);
    if (!holder) {
      // Runners not loaded yet or the budget said no: the line is already in place.
      void loadRunners();
      return;
    }
    const right = next.l > prev.l || (next.l === prev.l && next.r > prev.r);
    const lead = { duration: DUR.slide * 0.85, easing: EASE.lead } as const;
    const trail = { duration: DUR.slide * 1.15, easing: EASE.trail } as const;
    const px = (v: number) => `${v}px`;
    running = [
      bar.animate(
        { '--fx-l': [px(prev.l), px(next.l)] } as unknown as PropertyIndexedKeyframes,
        right ? trail : lead,
      ),
      bar.animate(
        { '--fx-r': [px(prev.r), px(next.r)] } as unknown as PropertyIndexedKeyframes,
        right ? lead : trail,
      ),
      bar.animate({ [right ? '--fx-hr' : '--fx-hl']: ['1', '0'] } as unknown as PropertyIndexedKeyframes, {
        duration: DUR.slide * 1.3,
        easing: 'ease-out',
      }),
    ];
    const mine = running;
    void mine[mine.length - 1]!.finished.then(
      () => {
        if (running === mine) stop();
      },
      () => undefined,
    );
  };

  const mo = new MutationObserver(() => sync(true));
  mo.observe(host, { subtree: true, attributes: true, attributeFilter: ATTRS });
  // A resize is answered in the next frame, not inside the observer's delivery: the line writes styles and reads
  // the host's scroll width, and a write made while resizes are being delivered can ask for another delivery in
  // the same frame, which the browser reports as "ResizeObserver loop completed with undelivered notifications".
  let frame = 0;
  const ro =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          if (frame) return;
          frame = requestAnimationFrame(() => {
            frame = 0;
            sync(false);
          });
        })
      : null;
  ro?.observe(host);
  sync(false);

  return {
    sync,
    dispose() {
      mo.disconnect();
      ro?.disconnect();
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      stop();
    },
  };
}
