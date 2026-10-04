// What the globe is focused on beyond one node: a fleet picked out with "Show on the globe" (`?sel=` naming
// several nodes) or the watchlist (`?watched`). Both outlive the page that set them, so the shell names
// them in a pill with a way out (GlobeFocus.tsx), and Esc clears them before it closes a window.

import { flag } from '../../app/search';
import { formatInt } from '../../lib/format';

export interface GlobeFocus {
  /** Nodes picked out by `?sel=`, counted from two up (one node is an ordinary selection). */
  fleet: number;
  /** The watchlist filter is on. */
  watched: boolean;
}

/** The focus a location's search holds, or `null` when the globe shows everything as usual. */
export function globeFocus(search: { sel?: unknown; watched?: unknown }): GlobeFocus | null {
  const keys =
    typeof search.sel === 'string' ? search.sel.split(',').filter((k) => k.trim() !== '').length : 0;
  const fleet = keys >= 2 ? keys : 0;
  const watched = flag(search.watched) === true;
  return fleet > 0 || watched ? { fleet, watched } : null;
}

/** What the pill says: "Your 20 watched nodes on the globe", "A fleet of 50 nodes on the globe". */
export function focusLabel(f: GlobeFocus, watchedCount: number): string {
  const parts: string[] = [];
  if (f.watched)
    parts.push(watchedCount === 1 ? 'Your watched node' : `Your ${formatInt(watchedCount)} watched nodes`);
  if (f.fleet > 0) parts.push(`${parts.length ? 'a' : 'A'} fleet of ${formatInt(f.fleet)} nodes`);
  return `${parts.join(' and ')} on the globe`;
}
