// Keeping a label or a tooltip off the chart's own line. Both Chain charts put small things on the plot
// (the name of the change of rules, the reading under the pointer); where they go is a choice among a few
// spots, taking the first that no line runs through. Pure geometry, no DOM, no React.

/** The pixel positions of a polyline a label must stay clear of: `y` is null (or undefined) where unknown. */
export interface Avoid {
  x: readonly number[];
  y: readonly (number | null | undefined)[];
}

/** A line within this many px of a box is in its way. */
export const CLEARANCE = 4;

/** Whether the polyline passes through, or within `CLEARANCE` of, the rectangle (x0..x1, y0..y1). */
export function lineCrosses(
  avoid: Avoid | undefined,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): boolean {
  if (!avoid) return false;
  const { x, y } = avoid;
  const top = y0 - CLEARANCE;
  const bottom = y1 + CLEARANCE;
  for (let i = 0; i < x.length; i++) {
    const ax = x[i]!;
    const ay = y[i];
    if (ay === null || ay === undefined) continue;
    if (ax >= x0 && ax <= x1 && ay >= top && ay <= bottom) return true;
    const bx = x[i + 1];
    const by = y[i + 1];
    if (bx === undefined || by === null || by === undefined || bx === ax) continue;
    // The part of the segment inside the rectangle's columns.
    const lo = Math.max(x0, Math.min(ax, bx));
    const hi = Math.min(x1, Math.max(ax, bx));
    if (lo > hi) continue;
    const at = (px: number) => ay + ((px - ax) / (bx - ax)) * (by - ay);
    const [s, e] = [at(lo), at(hi)];
    if (Math.max(s, e) >= top && Math.min(s, e) <= bottom) return true;
  }
  return false;
}

/** The gap between the crosshair and a tooltip, and the room above or below it, as the CSS gives them. */
export const TIP = { gap: 14, edge: 6 } as const;

export interface TipPlace {
  side: 'left' | 'right';
  v: 'top' | 'bottom';
}

/** The chart's box and its margins (the room the axes take around the plot). */
export interface TipBox {
  width: number;
  height: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Where a tooltip of `size` goes: beside the crosshair at `crossX`, in the top or the bottom of the plot.
 * Preferred: the side with the room (the right, until the crosshair is past 58% of the width) and the
 * half away from the dot at `dotY`. The first spot that keeps to the plot (not over the axis labels) and
 * that no line runs through is taken: this side's two halves, then the other side's; then the same
 * allowing the margins; with none clear, the first of them. Where it fits on neither side (a phone), the
 * side with more room.
 */
export function placeTip(
  g: TipBox,
  crossX: number,
  dotY: number | null,
  size: { w: number; h: number },
  avoid?: Avoid,
): TipPlace {
  const wantLeft = crossX > g.width * 0.58;
  const plotH = g.height - g.top - g.bottom;
  const dotLow = dotY !== null && dotY > g.top + plotH * 0.5;
  const sides: ('left' | 'right')[] = wantLeft ? ['left', 'right'] : ['right', 'left'];
  const halves: ('top' | 'bottom')[] = dotY === null || dotLow ? ['top', 'bottom'] : ['bottom', 'top'];
  const x0Of = (side: 'left' | 'right') => (side === 'right' ? crossX + TIP.gap : crossX - TIP.gap - size.w);
  const spots: TipPlace[] = [];
  for (const [lo, hi] of [
    [g.left, g.width - g.right],
    [0, g.width],
  ] as const) {
    for (const side of sides) {
      const x0 = x0Of(side);
      if (x0 < lo || x0 + size.w > hi) continue;
      for (const v of halves) if (!spots.some((s) => s.side === side && s.v === v)) spots.push({ side, v });
    }
  }
  // With every spot crossed, the first one: a side it fits on. With no spot at all (a phone), the side with more room.
  const roomier = crossX > g.width / 2 ? 'left' : 'right';
  const first: TipPlace = spots[0] ?? { side: roomier, v: halves[0]! };
  for (const spot of spots) {
    const x0 = x0Of(spot.side);
    const y0 = spot.v === 'top' ? g.top + TIP.edge : g.height - g.bottom - TIP.edge - size.h;
    if (!lineCrosses(avoid, x0, x0 + size.w, y0, y0 + size.h)) return spot;
  }
  return first;
}
