// Arrange actions the Window menu offers, built from the reducer's own actions (no new behaviour in the
// machine): snap a window to the left or right column of the workspace.

import { WINDOW_SPECS } from './specs';
import type { WindowManager } from './store';

/**
 * Snaps a window to the left or right column of the workspace (the same rectangles a drag-and-drop
 * snap produces). A dockable window snapped right docks into the inspector slot.
 */
export function snapWindow(wm: WindowManager, id: string, side: 'left' | 'right'): void {
  const w = wm.getState().windows[id];
  if (!w) return;
  const spec = WINDOW_SPECS[w.type];
  if (w.mode === 'maximized') wm.dispatch({ t: 'restore', id });
  if (side === 'right' && spec.dockable) {
    if (w.placement !== 'docked') wm.dispatch({ t: 'toggleDock', id });
    return;
  }
  if (w.placement === 'docked') wm.dispatch({ t: 'toggleDock', id });
  const s = wm.getState();
  const cur = s.windows[id];
  if (!cur) return;
  const ws = s.workspace;
  const width = Math.round(Math.min(Math.max(cur.rect.w, spec.min.w), ws.w));
  const x = side === 'left' ? ws.x : ws.x + ws.w - width;
  wm.dispatch({ t: 'resize', id, rect: { x, y: ws.y, w: width, h: ws.h } });
}
