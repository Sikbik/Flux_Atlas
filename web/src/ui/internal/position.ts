// Pure placement math for floating layers (tooltips, hover cards, popovers, menus, select
// listboxes). No DOM access: callers pass measured boxes, so it is unit tested. A layer is placed
// on one side of its anchor, flipped to the opposite side when there is no room, then clamped into
// the viewport on both axes.

export type Side = 'top' | 'bottom' | 'left' | 'right';
export type Align = 'start' | 'center' | 'end';
/** A side, optionally aligned to the start or end of the anchor: `bottom`, `bottom-start`, `top-end`. */
export type Placement = Side | `${Side}-start` | `${Side}-end`;

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface PositionInput {
  /** The anchor's box in viewport coordinates (`getBoundingClientRect()`). */
  anchor: Box;
  /** The floating layer's measured size. */
  floating: Size;
  /** The viewport size. */
  viewport: Size;
  /** Preferred placement (default `bottom`). */
  placement?: Placement;
  /** Gap between anchor and layer in px (default 6). */
  offset?: number;
  /** Minimum distance kept to the viewport edges in px (default 8). */
  padding?: number;
  /** Flip to the opposite side when the preferred side lacks room (default true). */
  flip?: boolean;
}

export interface PositionResult {
  /** Left edge in viewport coordinates (for `position: fixed`). */
  left: number;
  /** Top edge in viewport coordinates. */
  top: number;
  /** The placement actually used, after flipping. */
  placement: Placement;
  side: Side;
  /** Room left in the viewport for the layer's height; use as `max-height` on scrollable content. */
  maxHeight: number;
  maxWidth: number;
}

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

export function parsePlacement(p: Placement): { side: Side; align: Align } {
  const [side, align] = p.split('-') as [Side, Align | undefined];
  return { side, align: align ?? 'center' };
}

function compose(side: Side, align: Align): Placement {
  return align === 'center' ? side : (`${side}-${align}` as Placement);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

/** Room available on `side` of the anchor, after the offset and the viewport padding. */
export function spaceOn(side: Side, anchor: Box, viewport: Size, offset: number, padding: number): number {
  switch (side) {
    case 'top':
      return anchor.top - offset - padding;
    case 'bottom':
      return viewport.height - (anchor.top + anchor.height) - offset - padding;
    case 'left':
      return anchor.left - offset - padding;
    case 'right':
      return viewport.width - (anchor.left + anchor.width) - offset - padding;
  }
}

function place(side: Side, align: Align, a: Box, f: Size, offset: number): { left: number; top: number } {
  if (side === 'top' || side === 'bottom') {
    const top = side === 'top' ? a.top - f.height - offset : a.top + a.height + offset;
    const left =
      align === 'start'
        ? a.left
        : align === 'end'
          ? a.left + a.width - f.width
          : a.left + (a.width - f.width) / 2;
    return { left, top };
  }
  const left = side === 'left' ? a.left - f.width - offset : a.left + a.width + offset;
  const top =
    align === 'start'
      ? a.top
      : align === 'end'
        ? a.top + a.height - f.height
        : a.top + (a.height - f.height) / 2;
  return { left, top };
}

/** Places a floating layer next to an anchor; see {@link PositionInput}. */
export function computePosition(input: PositionInput): PositionResult {
  const { anchor, floating, viewport } = input;
  const offset = input.offset ?? 6;
  const padding = input.padding ?? 8;
  const preferred = parsePlacement(input.placement ?? 'bottom');
  let side = preferred.side;
  if (input.flip !== false) {
    const need = side === 'top' || side === 'bottom' ? floating.height : floating.width;
    const have = spaceOn(side, anchor, viewport, offset, padding);
    if (have < need) {
      const opposite = OPPOSITE[side];
      if (spaceOn(opposite, anchor, viewport, offset, padding) > have) side = opposite;
    }
  }
  const raw = place(side, preferred.align, anchor, floating, offset);
  const left = clamp(raw.left, padding, viewport.width - floating.width - padding);
  const top = clamp(raw.top, padding, viewport.height - floating.height - padding);
  return {
    left,
    top,
    placement: compose(side, preferred.align),
    side,
    maxHeight: Math.max(0, viewport.height - padding * 2),
    maxWidth: Math.max(0, viewport.width - padding * 2),
  };
}
