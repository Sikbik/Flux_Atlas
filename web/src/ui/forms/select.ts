// Pure rules for the Select: which option is highlighted when the list opens, and how a scrolled list
// follows the highlight. No DOM, so they are unit tested.

export interface OptionLike {
  value: string;
  label: string;
  disabled?: boolean;
}

/** Index of the option holding `value`, or -1 (also for `null` and `undefined`). */
export function indexOfValue(options: readonly OptionLike[], value: string | null | undefined): number {
  return value === null || value === undefined ? -1 : options.findIndex((o) => o.value === value);
}

/**
 * The option highlighted when the list opens: the selected one if it can be chosen, otherwise the
 * first (or last) option that can. -1 when none can.
 */
export function initialActive(
  options: readonly OptionLike[],
  value: string | null | undefined,
  from: 'first' | 'last' = 'first',
): number {
  const selected = indexOfValue(options, value);
  if (selected >= 0 && !options[selected]?.disabled) return selected;
  if (from === 'last') {
    for (let i = options.length - 1; i >= 0; i--) if (!options[i]?.disabled) return i;
    return -1;
  }
  return options.findIndex((o) => !o.disabled);
}

/**
 * The option `delta` places from `current` (PageUp and PageDown), clamped to the ends and moved to
 * the nearest option that can be chosen, preferring the direction of travel. -1 when none can.
 */
export function pageIndex(options: readonly OptionLike[], current: number, delta: number): number {
  const last = options.length - 1;
  if (last < 0 || delta === 0) return -1;
  const dir = delta > 0 ? 1 : -1;
  const from = current < 0 || current > last ? (dir > 0 ? -1 : options.length) : current;
  const target = Math.min(Math.max(from + delta, 0), last);
  for (let i = target; i >= 0 && i <= last; i += dir) if (!options[i]?.disabled) return i;
  for (let i = target; i >= 0 && i <= last; i -= dir) if (!options[i]?.disabled) return i;
  return -1;
}

/**
 * The `scrollTop` that brings an item fully into a scrolled list with `pad` px of clearance. Returns
 * the current position when the item already fits; never negative.
 */
export function scrollTopToReveal(
  view: { scrollTop: number; height: number },
  item: { top: number; height: number },
  pad = 0,
): number {
  const top = item.top - pad;
  const bottom = item.top + item.height + pad;
  if (item.height + pad * 2 > view.height) return Math.max(0, item.top - pad);
  if (top < view.scrollTop) return Math.max(0, top);
  if (bottom > view.scrollTop + view.height) return Math.max(0, bottom - view.height);
  return view.scrollTop;
}
