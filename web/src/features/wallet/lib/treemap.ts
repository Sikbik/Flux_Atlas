// A squarified treemap (Bruls, Huizing and van Wijk): each item's area is its share of the whole, and the
// rectangles are laid out to be as close to square as they can, so labels fit and sizes compare by eye.
// Pure geometry; `viz/AppsTreemap.tsx` draws it.

export interface TreemapItem {
  id: string;
  label: string;
  value: number;
}

export interface TreemapCell extends TreemapItem {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The worst (largest) aspect ratio in a row of `areas` laid along a side of length `side`. */
function worst(areas: readonly number[], side: number): number {
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  for (const a of areas) {
    sum += a;
    if (a < min) min = a;
    if (a > max) max = a;
  }
  const s2 = side * side;
  return Math.max((s2 * max) / (sum * sum), (sum * sum) / (s2 * min));
}

/**
 * Lays the items out in a `width` by `height` box. Items with no value are dropped; the biggest comes first
 * (top left). `gap` is the space left between cells, taken from each cell's own edge, so the cells never
 * overlap and a tiny cell is not shrunk to nothing.
 */
export function squarify(
  items: readonly TreemapItem[],
  width: number,
  height: number,
  gap = 0,
): TreemapCell[] {
  const list = items.filter((i) => i.value > 0 && Number.isFinite(i.value)).sort((a, b) => b.value - a.value);
  if (list.length === 0 || !(width > 0) || !(height > 0)) return [];
  const total = list.reduce((s, i) => s + i.value, 0);
  const scale = (width * height) / total;
  const areas = list.map((i) => i.value * scale);
  const cells: TreemapCell[] = [];
  let box: Box = { x: 0, y: 0, w: width, h: height };

  let i = 0;
  while (i < list.length) {
    const side = Math.min(box.w, box.h);
    let end = i + 1;
    let row = areas.slice(i, end);
    let score = worst(row, side);
    while (end < list.length) {
      const next = areas.slice(i, end + 1);
      const nextScore = worst(next, side);
      if (nextScore > score) break;
      row = next;
      score = nextScore;
      end++;
    }
    const sum = row.reduce((s, a) => s + a, 0);
    const wide = box.w >= box.h;
    // A wide box takes the row as a column on its left; a tall one as a strip along its top.
    const thickness = sum / (wide ? box.h : box.w);
    let at = wide ? box.y : box.x;
    row.forEach((a, k) => {
      const length = a / thickness;
      const item = list[i + k] as TreemapItem;
      const cell: Box = wide
        ? { x: box.x, y: at, w: thickness, h: length }
        : { x: at, y: box.y, w: length, h: thickness };
      cells.push({ ...item, ...inset(cell, gap) });
      at += length;
    });
    box = wide
      ? { x: box.x + thickness, y: box.y, w: box.w - thickness, h: box.h }
      : { x: box.x, y: box.y + thickness, w: box.w, h: box.h - thickness };
    i = end;
  }
  return cells;
}

function inset(b: Box, gap: number): Box {
  if (gap <= 0) return b;
  // Never shrink a cell past a hairline.
  const gx = Math.min(gap / 2, Math.max(0, (b.w - 1) / 2));
  const gy = Math.min(gap / 2, Math.max(0, (b.h - 1) / 2));
  return { x: b.x + gx, y: b.y + gy, w: b.w - 2 * gx, h: b.h - 2 * gy };
}

/** The id of the item `foldTail` makes out of the long tail. */
export const OTHER_ID = '__other';

/**
 * How many cells a box can hold before they are too small to point at: each gets at least `minArea` px squared (the
 * default is a 30 px square), and never fewer than `floor`, so even a small box shows its biggest items.
 */
export function cellLimit(width: number, height: number, minArea = 900, floor = 12): number {
  if (!(width > 0) || !(height > 0)) return floor;
  return Math.max(floor, Math.floor((width * height) / minArea));
}

/**
 * The items to draw: the biggest `limit`, with the rest folded into one "other" item so the picture stays legible
 * (a hundred slivers are not information). The fold is left out when it would hold a single item.
 */
export function foldTail(
  items: readonly TreemapItem[],
  limit: number,
  otherLabel: (n: number) => string,
): TreemapItem[] {
  const sorted = [...items].filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length <= limit) return sorted;
  const head = sorted.slice(0, limit - 1);
  const tail = sorted.slice(limit - 1);
  return [
    ...head,
    { id: OTHER_ID, label: otherLabel(tail.length), value: tail.reduce((s, i) => s + i.value, 0) },
  ];
}

/** Whether a cell is big enough to carry its own label (`minW` by `minH` px). */
export function fitsLabel(c: Pick<TreemapCell, 'w' | 'h'>, minW = 64, minH = 30): boolean {
  return c.w >= minW && c.h >= minH;
}
