// Column geometry for the table's CSS grid: one `grid-template-columns` value shared by the header,
// every row and the skeleton rows, so nothing shifts when data arrives. Pure, so it is unit tested.

export const DEFAULT_MIN_WIDTH = 96;

export interface ColumnGeometry {
  width?: number | string;
  minWidth?: number;
}

const FR = /^\s*(\d*\.?\d+)\s*fr\s*$/;

function minOf(c: ColumnGeometry): number {
  if (typeof c.width === 'number') return c.width;
  return c.minWidth ?? DEFAULT_MIN_WIDTH;
}

/** The track for one column: a number is px, `"2fr"` a share of the free space, other strings pass through. */
export function columnTrack(c: ColumnGeometry): string {
  const min = c.minWidth ?? DEFAULT_MIN_WIDTH;
  const w = c.width;
  if (w === undefined) return `minmax(${min}px, 1fr)`;
  if (typeof w === 'number') return `${w}px`;
  const fr = FR.exec(w);
  if (fr) return `minmax(${min}px, ${fr[1]}fr)`;
  return w;
}

/** `grid-template-columns` for a column list. */
export function gridTemplate(columns: readonly ColumnGeometry[]): string {
  return columns.map(columnTrack).join(' ');
}

/** The narrowest the table can be before it scrolls horizontally, px. */
export function minTableWidth(columns: readonly ColumnGeometry[]): number {
  return columns.reduce((sum, c) => sum + minOf(c), 0);
}

/** Row height in px for the `rowHeight` prop, raised to the touch minimum (40) when `touch` is set. */
export function resolveRowHeight(rowHeight: number | 'compact' | undefined, touch: boolean): number {
  const base = rowHeight === 'compact' ? 28 : (rowHeight ?? 34);
  return touch ? Math.max(base, 40) : base;
}
