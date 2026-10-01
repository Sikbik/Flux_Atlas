// Windowing math for the virtualised table: fixed row height, so the visible range is arithmetic.
// Pure, so it is unit tested without a DOM.

export interface WindowInput {
  /** Scroll offset of the rows area in px (0 = first row at the top of the viewport). */
  scrollTop: number;
  /** Height of the rows viewport in px (the scroller minus the sticky header). */
  viewportHeight: number;
  /** Row height in px. */
  rowHeight: number;
  /** Total rows. */
  rowCount: number;
  /** Extra rows rendered above and below the viewport. */
  overscan: number;
}

export interface WindowRange {
  /** First rendered row index. */
  start: number;
  /** One past the last rendered row index. */
  end: number;
  /** Offset of the first rendered row from the top of the rows area, px. */
  offsetTop: number;
  /** Height of the whole rows area, px. */
  totalHeight: number;
}

const finite = (n: number, fallback: number) => (Number.isFinite(n) ? n : fallback);

/** The slice of rows to render for a scroll position. */
export function computeWindow(input: WindowInput): WindowRange {
  const rowHeight = Math.max(1, finite(input.rowHeight, 1));
  const rowCount = Math.max(0, Math.floor(finite(input.rowCount, 0)));
  const overscan = Math.max(0, Math.floor(finite(input.overscan, 0)));
  const viewport = Math.max(0, finite(input.viewportHeight, 0));
  const totalHeight = rowCount * rowHeight;
  const scrollTop = Math.min(Math.max(0, finite(input.scrollTop, 0)), Math.max(0, totalHeight - viewport));
  const first = Math.floor(scrollTop / rowHeight);
  const last = Math.ceil((scrollTop + viewport) / rowHeight);
  const start = Math.max(0, Math.min(rowCount, first - overscan));
  const end = Math.max(start, Math.min(rowCount, last + overscan));
  return { start, end, offsetTop: start * rowHeight, totalHeight };
}

/**
 * The scroll offset that brings row `index` fully into view with the least movement (unchanged when
 * it is already visible).
 */
export function scrollTopToReveal(
  index: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
): number {
  const top = index * rowHeight;
  const bottom = top + rowHeight;
  if (top < scrollTop) return Math.max(0, top);
  if (bottom > scrollTop + viewportHeight) return Math.max(0, bottom - viewportHeight);
  return scrollTop;
}

/** Whole rows in a viewport, less one for context, at least one: how far PageUp and PageDown move. */
export function rowsPerPage(viewportHeight: number, rowHeight: number): number {
  return Math.max(1, Math.floor(finite(viewportHeight, 0) / Math.max(1, rowHeight)) - 1);
}
