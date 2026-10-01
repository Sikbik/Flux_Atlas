// The Menu's item model and the pure step that turns a flat `items` array (actions, separators and
// group labels) into the sections the menu renders and the flat list of actions that keyboard
// navigation walks. No DOM, so it is unit tested.

import type { LucideIcon } from 'lucide-react';

/** One selectable row. */
export interface MenuAction {
  /** Stable id (the React key and the DOM id suffix). */
  id: string;
  /** Visible label and accessible name (sentence case). */
  label: string;
  /** Icon in the leading column (a lucide icon component). */
  icon?: LucideIcon;
  /** The shortcut shown at the right, one entry per key (`['ctrl', 'K']`). */
  shortcut?: readonly string[];
  /** A destructive action: critical colour. Put it last, after a separator. */
  danger?: boolean;
  /** Not selectable; keyboard navigation skips it. */
  disabled?: boolean;
  /** Makes the row a checkbox item (`menuitemcheckbox`): `true` shows a check, `false` an empty slot. */
  checked?: boolean;
  /** Called when the row is chosen (click, Enter or Space). The menu closes first. */
  onSelect: () => void;
}

/** A hairline between groups of actions. */
export interface MenuSeparator {
  type: 'separator';
  id?: string;
}

/** A heading for the actions that follow it, up to the next separator or heading. */
export interface MenuLabel {
  type: 'label';
  label: string;
  id?: string;
}

/** Anything a Menu can list. Actions have no `type`. */
export type MenuItem = MenuAction | MenuSeparator | MenuLabel;

export interface MenuEntry {
  action: MenuAction;
  /** Index in the flat list of actions (what keyboard navigation and focus use). */
  index: number;
}

export type MenuBlock =
  | { kind: 'separator'; key: string }
  | { kind: 'group'; key: string; label?: { id: string; text: string }; entries: MenuEntry[] };

export interface MenuModel {
  blocks: MenuBlock[];
  /** Every action in display order, disabled ones included. */
  actions: MenuAction[];
}

const isSeparator = (i: MenuItem): i is MenuSeparator => 'type' in i && i.type === 'separator';
const isLabel = (i: MenuItem): i is MenuLabel => 'type' in i && i.type === 'label';

/**
 * Groups items into blocks. A label starts a labelled group; a separator ends the current group. A
 * leading, trailing or repeated separator is dropped, and empty groups are not drawn.
 */
export function buildMenu(items: readonly MenuItem[], idBase = 'menu'): MenuModel {
  const blocks: MenuBlock[] = [];
  const actions: MenuAction[] = [];
  let current: Extract<MenuBlock, { kind: 'group' }> | null = null;
  let pendingSeparator: string | null = null;

  const flush = () => {
    if (current && current.entries.length > 0) {
      if (pendingSeparator !== null && blocks.length > 0)
        blocks.push({ kind: 'separator', key: pendingSeparator });
      pendingSeparator = null;
      blocks.push(current);
    }
    current = null;
  };

  items.forEach((item, i) => {
    if (isSeparator(item)) {
      flush();
      if (blocks.length > 0) pendingSeparator = item.id ?? `${idBase}-sep-${i}`;
    } else if (isLabel(item)) {
      flush();
      current = {
        kind: 'group',
        key: `${idBase}-group-${i}`,
        label: { id: item.id ?? `${idBase}-label-${i}`, text: item.label },
        entries: [],
      };
    } else {
      current ??= { kind: 'group', key: `${idBase}-group-${i}`, entries: [] };
      current.entries.push({ action: item, index: actions.length });
      actions.push(item);
    }
  });
  flush();
  return { blocks, actions };
}
