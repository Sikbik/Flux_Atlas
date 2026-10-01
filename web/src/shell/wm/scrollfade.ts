// "More to read" for a window body (design 8.3): the body fades over its last 30 px only while there is more
// below, so the last visible line never looks cut by accident. The state is a `data-more` attribute set
// straight on the element (no re-render), refreshed on scroll and whenever the body or its content resizes.

import { type RefObject, useEffect } from 'react';

const SLACK_PX = 2;

export function hasMoreBelow(el: Pick<HTMLElement, 'scrollHeight' | 'scrollTop' | 'clientHeight'>): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight > SLACK_PX;
}

export function useMoreBelow(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      if (hasMoreBelow(el)) el.setAttribute('data-more', '');
      else el.removeAttribute('data-more');
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    el.addEventListener('scroll', schedule, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    ro?.observe(el);
    let watched: Element | null = null;
    // The content is the body's first child; it changes when a lazy view mounts or a window retargets.
    const watch = () => {
      const first = el.firstElementChild;
      if (first === watched) return;
      if (watched) ro?.unobserve(watched);
      watched = first;
      if (watched) ro?.observe(watched);
      schedule();
    };
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(watch);
    mo?.observe(el, { childList: true });
    watch();
    return () => {
      el.removeEventListener('scroll', schedule);
      ro?.disconnect();
      mo?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref]);
}
