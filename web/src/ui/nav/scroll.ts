// Pure geometry for horizontally scrolling strips (the tab list): which edges to fade, and where to
// scroll so a focused item sits clear of the fades. No DOM, so it is unit tested.

/** Which edge fades to draw on a scrollable strip. */
export type EdgeFade = 'start' | 'end' | 'both' | undefined;

/** The edges that have more content beyond them (1 px of slack absorbs sub-pixel scroll positions). */
export function edgeFade(scrollLeft: number, clientWidth: number, scrollWidth: number, slack = 1): EdgeFade {
  const start = scrollLeft > slack;
  const end = scrollLeft + clientWidth < scrollWidth - slack;
  if (start && end) return 'both';
  if (start) return 'start';
  if (end) return 'end';
  return undefined;
}

/**
 * The `scrollLeft` that brings an item fully into view with `pad` px of clearance on each side (the
 * fade width, so the item is never under a fade). Returns the current position when the item already
 * fits; never negative.
 */
export function scrollLeftToReveal(
  view: { scrollLeft: number; width: number },
  item: { left: number; width: number },
  pad: number,
): number {
  const left = item.left - pad;
  const right = item.left + item.width + pad;
  if (item.width + pad * 2 > view.width) return Math.max(0, item.left - pad);
  if (left < view.scrollLeft) return Math.max(0, left);
  if (right > view.scrollLeft + view.width) return Math.max(0, right - view.width);
  return view.scrollLeft;
}
