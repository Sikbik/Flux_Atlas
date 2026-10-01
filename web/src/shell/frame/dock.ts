// What each dock launcher shows (design 2.7, 8.5): idle, open (a window of its kind exists), focus
// (the focused window is one of its kind, or it is the bare globe), or min (all of its windows are
// minimized). Pure over the window manager's state so it can be tested and selected narrowly.

import { windowOfType } from '../wm/machine';
import { WINDOW_SPECS } from '../wm/specs';
import type { WindowType, WmState } from '../wm/types';
import { LAUNCHERS, type LauncherId } from './launchers';

export type DockState = 'idle' | 'open' | 'focus' | 'min';

type Slice = Pick<WmState, 'windows' | 'order' | 'focused'>;

export function dockState(s: Slice, id: LauncherId): DockState {
  const l = LAUNCHERS[id];
  if (id === 'globe') {
    // The bare globe is "focused" while no framed window is on screen.
    const anyFramed = s.order.some((wid) => {
      const w = s.windows[wid];
      return !!w && w.mode !== 'minimized' && WINDOW_SPECS[w.type].chrome === 'window';
    });
    return anyFramed ? 'idle' : 'focus';
  }
  if (l.types.length === 0) return 'idle';
  const mine = s.order
    .map((wid) => s.windows[wid])
    .filter((w): w is NonNullable<typeof w> => !!w && l.types.includes(w.type));
  if (mine.length === 0) return 'idle';
  const focusedType = s.focused ? s.windows[s.focused]?.type : undefined;
  if (focusedType && l.types.includes(focusedType)) return 'focus';
  // Strip and layer types (time machine, weather) are never framed: while present they are the focus.
  if (mine.some((w) => WINDOW_SPECS[w.type].chrome !== 'window')) return 'focus';
  return mine.some((w) => w.mode !== 'minimized') ? 'open' : 'min';
}

/** All launchers' states as one comparable string (`id:state,...`), so a selector re-renders on change only. */
export function dockKey(s: Slice, ids: readonly LauncherId[]): string {
  return ids.map((id) => `${id}:${dockState(s, id)}`).join(',');
}

export function parseDockKey(key: string): Record<string, DockState> {
  const out: Record<string, DockState> = {};
  for (const part of key.split(',')) {
    const [id, st] = part.split(':');
    if (id && st) out[id] = st as DockState;
  }
  return out;
}

/**
 * The launcher a window of this type opens from (a block or a transaction from the Explorer, a node or a host
 * from Nodes), or null for a type no launcher stands for. The dock writes the id on its button as
 * `data-launcher`, so a window's origin is `document.querySelector('[data-launcher="<id>"]')`.
 */
export function launcherOf(type: WindowType): LauncherId | null {
  for (const id of Object.keys(LAUNCHERS) as LauncherId[]) if (LAUNCHERS[id].types.includes(type)) return id;
  return null;
}

export { windowOfType };
