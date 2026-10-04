// The geometry of the hexagon waffle in the hero: pointy-top hexagons in rows, every other row shifted half a cell, so
// the cells interlock like a honeycomb. Pure.

export interface HexCell {
  /** Reading order: row by row from the top left. */
  index: number;
  cx: number;
  cy: number;
  /** The corners as an SVG `points` value. */
  points: string;
}

export interface HexGrid {
  cells: HexCell[];
  width: number;
  height: number;
}

/**
 * A grid of `cols` by `rows` hexagons whose corners are `r` from their centres. `gap` shrinks the drawn hexagon (not the
 * pitch), leaving a hairline of the surface between neighbours.
 */
export function hexGrid(cols: number, rows: number, r: number, gap = 0.9): HexGrid {
  const w = Math.sqrt(3) * r;
  const drawn = r * gap;
  const cells: HexCell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = w / 2 + col * w + (row % 2 === 1 ? w / 2 : 0);
      const cy = r + row * 1.5 * r;
      const points = Array.from({ length: 6 }, (_, k) => {
        const a = (Math.PI / 180) * (60 * k - 90);
        return `${(cx + drawn * Math.cos(a)).toFixed(2)},${(cy + drawn * Math.sin(a)).toFixed(2)}`;
      }).join(' ');
      cells.push({ index: row * cols + col, cx, cy, points });
    }
  }
  return {
    cells,
    width: cols * w + (rows > 1 ? w / 2 : 0),
    height: (rows - 1) * 1.5 * r + 2 * r,
  };
}

/** The tier of each cell, in reading order, given how many cells each slice fills. */
export function cellOwners<T extends string>(slices: readonly { id: T; cells: number }[]): T[] {
  const out: T[] = [];
  for (const s of slices) for (let i = 0; i < s.cells; i++) out.push(s.id);
  return out;
}
