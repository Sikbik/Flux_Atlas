// The phone's five tabs (design 3.6) and which one is lit, as plain logic. The tab bar is the dock's
// replacement: Globe is the bare globe, Live the sheet of everything happening, Search the palette, Apps the
// app launcher (the dock's A) and You the operator view, or settings until there is an operator to show.

import { paletteTextFromSearch } from '../../features/command/paletteUrl';
import type { WindowType } from '../wm/types';

export type PhoneTab = 'globe' | 'live' | 'search' | 'apps' | 'you';

export const PHONE_TABS: readonly { id: PhoneTab; label: string }[] = [
  { id: 'globe', label: 'Globe' },
  { id: 'live', label: 'Live' },
  { id: 'search', label: 'Search' },
  { id: 'apps', label: 'Apps' },
  { id: 'you', label: 'You' },
];

/** The palette as the tab bar sees it: shut, open, or open on the apps prefix (what the Apps tab opens). */
export type PaletteView = 'closed' | 'open' | 'apps';

/** Which of those a raw search string (`?q=app%20`) says. The palette is open while `q` is there, even empty. */
export function paletteView(searchStr: string): PaletteView {
  const text = paletteTextFromSearch(searchStr);
  if (text === null) return 'closed';
  return /^\s*apps?\s/i.test(text) ? 'apps' : 'open';
}

export interface TabState {
  /** The palette (the URL carries `?q=`, even empty). */
  palette: PaletteView;
  /** The Live sheet is asked for. */
  liveOpen: boolean;
  /** The window in the sheet, if any. */
  sheet: WindowType | null;
  /** The search results page (`/q/...`) is what the stage shows. */
  results: boolean;
}

/**
 * The tab to light: the palette is the whole screen when it is open (Apps while it is open on the apps prefix,
 * so the tab that was pressed stays lit), then the sheet's own window, then Live, then Search on the results
 * page, which is the screen a search leaves behind.
 */
export function activeTab(s: TabState): PhoneTab {
  if (s.palette !== 'closed') return s.palette === 'apps' ? 'apps' : 'search';
  if (s.sheet)
    return s.sheet === 'app' ? 'apps' : s.sheet === 'operator' || s.sheet === 'settings' ? 'you' : 'globe';
  if (s.liveOpen) return 'live';
  return s.results ? 'search' : 'globe';
}
