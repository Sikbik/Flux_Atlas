// Pure rules for a roving-tabindex group (tabs, segmented controls): which item holds the single
// tab stop, and how a key press maps to the item that should take focus. No DOM, so they are unit tested.

export interface RovingItem {
  /** Stable id of the item. */
  id: string;
  /** Disabled items are never the tab stop and arrow keys skip them. */
  disabled?: boolean;
}

/**
 * The id that carries `tabindex="0"`: the item focus last rested on while focus is inside the group,
 * else the selected item, else the first enabled item (so the group is always reachable with Tab).
 */
export function resolveStop(
  items: readonly RovingItem[],
  focused: string | undefined,
  selected: string | undefined,
): string | undefined {
  const usable = (id: string | undefined): id is string =>
    id !== undefined && items.some((i) => i.id === id && !i.disabled);
  if (usable(focused)) return focused;
  if (usable(selected)) return selected;
  return items.find((i) => !i.disabled)?.id;
}
