// Where a window comes from, and where it goes back to (motion language 3.5, design 6.1.3: everything comes
// from somewhere). On the desktop that is the dock launcher that stands for its type (`launcherOf` names it,
// the dock writes its id on the button as `data-launcher`); on a phone it is the middle of the sheet's own foot,
// where the tab bar is. Read at the moment of the open or the close, so it is wherever the launcher is then. A
// window whose launcher is not on screen has no source and opens out of its own middle.

import type { Origin } from '../../motion';
import { launcherOf } from '../frame/dock';
import { SHEET_FOOT } from './sheet';
import type { WindowType } from './types';

/** The element or point a window of this type opens from and closes toward. */
export function windowOrigin(type: WindowType, phone: boolean): Origin {
  if (typeof document === 'undefined') return undefined;
  if (phone) return SHEET_FOOT;
  const id = launcherOf(type);
  return id ? document.querySelector<HTMLElement>(`[data-launcher="${id}"]`) : null;
}
