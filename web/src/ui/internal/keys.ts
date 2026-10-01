// Keyboard navigation helpers shared by tabs, segmented controls, menus and listboxes. Pure, so the
// arrow-key rules are unit tested without a DOM.

export type Orientation = 'horizontal' | 'vertical' | 'both';

export interface NavigateOptions {
  /** Which arrow keys move: left and right, up and down, or all four (default `horizontal`). */
  orientation?: Orientation;
  /** Wrap around at the ends (default true). */
  loop?: boolean;
  /** Items that cannot take focus are skipped. */
  isDisabled?: (index: number) => boolean;
}

/**
 * The index a navigation key moves to, or `null` when the key does not navigate (or nothing is
 * enabled). Arrow keys step by one and skip disabled items; Home and End jump to the first and last
 * enabled item. `current` may be -1 (nothing active): forward keys then land on the first item and
 * backward keys on the last.
 */
export function navigateIndex(
  key: string,
  current: number,
  count: number,
  opts: NavigateOptions = {},
): number | null {
  if (count <= 0) return null;
  const orientation = opts.orientation ?? 'horizontal';
  const loop = opts.loop ?? true;
  const disabled = opts.isDisabled ?? (() => false);
  const horizontal = orientation === 'horizontal' || orientation === 'both';
  const vertical = orientation === 'vertical' || orientation === 'both';

  let dir = 0;
  let edge: 'first' | 'last' | null = null;
  if (key === 'Home') edge = 'first';
  else if (key === 'End') edge = 'last';
  else if ((horizontal && key === 'ArrowRight') || (vertical && key === 'ArrowDown')) dir = 1;
  else if ((horizontal && key === 'ArrowLeft') || (vertical && key === 'ArrowUp')) dir = -1;
  else return null;

  if (edge === 'first') {
    for (let i = 0; i < count; i++) if (!disabled(i)) return i;
    return null;
  }
  if (edge === 'last') {
    for (let i = count - 1; i >= 0; i--) if (!disabled(i)) return i;
    return null;
  }

  let i = current;
  if (i < 0 || i >= count) i = dir > 0 ? -1 : count;
  for (let step = 0; step < count; step++) {
    i += dir;
    if (i < 0 || i >= count) {
      if (!loop) return null;
      i = (i + count) % count;
    }
    if (!disabled(i)) return i;
  }
  return null;
}

/** Index of the next item whose label starts with the typed prefix (typeahead), starting after `current`. */
export function typeaheadIndex(
  labels: readonly string[],
  prefix: string,
  current: number,
  isDisabled: (index: number) => boolean = () => false,
): number | null {
  const p = prefix.trim().toLowerCase();
  if (!p || labels.length === 0) return null;
  // A single repeated character cycles through items starting with it.
  const cycle = p.length > 1 && [...p].every((c) => c === p[0]);
  const needle = cycle ? p[0]! : p;
  const n = labels.length;
  for (let step = 1; step <= n; step++) {
    const i = (((current + step) % n) + n) % n;
    if (!isDisabled(i) && labels[i]!.toLowerCase().startsWith(needle)) return i;
  }
  return null;
}
