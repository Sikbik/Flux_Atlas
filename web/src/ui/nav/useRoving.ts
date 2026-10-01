// Roving tabindex for a group of buttons (tabs, segmented control segments): one item is in the Tab
// order, arrow keys / Home / End move focus between enabled items, and the group reports where focus
// went so callers can select on move (automatic activation) or only focus (manual activation).

import { type FocusEvent, type KeyboardEvent, type RefObject, useState } from 'react';
import { navigateIndex, type Orientation } from '../internal/keys';
import { type RovingItem, resolveStop } from './roving';

export interface UseRovingOptions<T extends RovingItem> {
  /** The element that contains the items (and receives the key handlers). */
  ref: RefObject<HTMLElement | null>;
  /** The items, in DOM order (one button each). */
  items: readonly T[];
  /** The selected item; it holds the tab stop whenever focus is outside the group. */
  selectedId: string | undefined;
  /** CSS selector matching exactly the item buttons inside the group. */
  itemSelector: string;
  /** Which arrow keys move focus (`both` for radio groups). */
  orientation: Orientation;
  /** Called after focus moved to another item with a navigation key. */
  onNavigate?: (item: T, index: number) => void;
}

export interface Roving {
  /** `0` for the one item in the Tab order, `-1` for the rest. */
  tabIndexFor: (id: string) => 0 | -1;
  /** Spread on the group element. */
  handlers: {
    onFocus: (e: FocusEvent<HTMLElement>) => void;
    onBlur: (e: FocusEvent<HTMLElement>) => void;
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  };
}

function itemElements(root: HTMLElement | null, selector: string): HTMLElement[] {
  return root ? Array.from(root.querySelectorAll<HTMLElement>(selector)) : [];
}

/** Roving focus for a button group; see {@link UseRovingOptions}. */
export function useRoving<T extends RovingItem>(opts: UseRovingOptions<T>): Roving {
  const { ref, items, selectedId, itemSelector, orientation, onNavigate } = opts;
  const [focusedId, setFocusedId] = useState<string | undefined>(undefined);
  const stop = resolveStop(items, focusedId, selectedId);

  const indexOfTarget = (target: EventTarget | null): number => {
    if (!(target instanceof Element)) return -1;
    const el = target.closest<HTMLElement>(itemSelector);
    return el ? itemElements(ref.current, itemSelector).indexOf(el) : -1;
  };

  return {
    tabIndexFor: (id) => (id === stop ? 0 : -1),
    handlers: {
      onFocus: (e) => {
        const item = items[indexOfTarget(e.target)];
        if (item && !item.disabled) setFocusedId(item.id);
      },
      onBlur: (e) => {
        const next = e.relatedTarget;
        if (!(next instanceof Node) || !e.currentTarget.contains(next)) setFocusedId(undefined);
      },
      onKeyDown: (e) => {
        if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
        const current = indexOfTarget(e.target);
        if (current < 0) return;
        const next = navigateIndex(e.key, current, items.length, {
          orientation,
          isDisabled: (i) => !!items[i]?.disabled,
        });
        if (next === null) return;
        e.preventDefault();
        const item = items[next];
        if (next === current || !item) return;
        itemElements(ref.current, itemSelector)[next]?.focus({ preventScroll: true });
        onNavigate?.(item, next);
      },
    },
  };
}
