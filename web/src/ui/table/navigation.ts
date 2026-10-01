// The keyboard model of the table's roving active row: which row an arrow, page or edge key moves
// to. Pure, so it is unit tested without a DOM.

import { navigateIndex } from '../internal/keys';

export interface RowNavigation {
  /** Index of the active row, or -1 when none is active yet. */
  current: number;
  /** Number of rows. */
  count: number;
  /** Rows a PageUp or PageDown moves. */
  page: number;
}

/**
 * The row index a key moves to, or `null` when the key does not navigate. Up and Down step by one
 * and stop at the ends (no wrap); PageUp and PageDown move by `page`; Home and End jump to the first
 * and last row. With no active row, forward keys land on the first row and backward keys on the last.
 */
export function navigateRow(key: string, nav: RowNavigation): number | null {
  const { current, count, page } = nav;
  if (count <= 0) return null;
  if (key === 'PageDown' || key === 'PageUp') {
    const dir = key === 'PageDown' ? 1 : -1;
    if (current < 0 || current >= count) return dir > 0 ? 0 : count - 1;
    return Math.min(count - 1, Math.max(0, current + dir * Math.max(1, page)));
  }
  return navigateIndex(key, current, count, { orientation: 'vertical', loop: false });
}
