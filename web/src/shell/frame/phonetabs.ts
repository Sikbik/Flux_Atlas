// The phone's five tabs (design 3.6) and which one is lit, as plain logic. The tab bar is the dock's
// replacement: Globe is the bare globe, Live the sheet of everything happening, Search the palette, Apps the
// app launcher (the dock's A) and You the operator view, or settings until there is an operator to show.

import type { WindowType } from '../wm/types';

export type PhoneTab = 'globe' | 'live' | 'search' | 'apps' | 'you';

export const PHONE_TABS: readonly { id: PhoneTab; label: string }[] = [
  { id: 'globe', label: 'Globe' },
  { id: 'live', label: 'Live' },
  { id: 'search', label: 'Search' },
  { id: 'apps', label: 'Apps' },
  { id: 'you', label: 'You' },
];

export interface TabState {
  /** The palette is open (the URL carries `?q=`, even empty). */
  paletteOpen: boolean;
  /** The Live sheet is asked for. */
  liveOpen: boolean;
  /** The window in the sheet, if any. */
  sheet: WindowType | null;
}

/** The tab to light: the palette is the whole screen when it is open, then the sheet's own window, then Live. */
export function activeTab(s: TabState): PhoneTab {
  if (s.paletteOpen) return 'search';
  if (s.sheet)
    return s.sheet === 'app' ? 'apps' : s.sheet === 'operator' || s.sheet === 'settings' ? 'you' : 'globe';
  return s.liveOpen ? 'live' : 'globe';
}
