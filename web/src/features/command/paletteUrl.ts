// The palette's URL contract (design 2.6): the palette is open while the URL carries `?q=`, and `q` holds
// its text. F2a's top-bar field and dock launcher open it by setting `q` to the empty string (or to
// `operator ` for the operator launcher); closing it removes `q`.
//
// Two router quirks shape this file:
//   - the search validator (`app/search.ts`) drops an empty `q`, so "open with no text" is only visible
//     in the raw search string, never in `useSearch()`;
//   - the router JSON-quotes strings that look like JSON scalars (`65.109` becomes `"65.109"`), and
//     trims values through the validator (`operator ` becomes `operator`).
// So the palette reads the raw search string (`paletteTextFromSearch`) and treats its own text as the
// truth while it is open: the URL only receives debounced `replace` writes.

import type { AnyRouter } from '@tanstack/react-router';

/** Undoes the router's JSON quoting of scalar-looking strings (`"65.109"` to `65.109`). */
export function decodeQValue(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    try {
      const v: unknown = JSON.parse(raw);
      if (typeof v === 'string') return v;
    } catch {
      // Not JSON after all: use it as typed.
    }
  }
  return raw;
}

/** The palette text carried by a raw search string (`?q=...`), or null when `q` is absent (closed). */
export function paletteTextFromSearch(searchStr: string): string | null {
  const params = new URLSearchParams(searchStr);
  if (!params.has('q')) return null;
  return decodeQValue(params.get('q') ?? '');
}

type SearchRecord = Record<string, unknown>;

/** Search params the palette must not carry into a destination: the palette text and the selection. */
const DROPPED = ['q', 'sel'] as const;

/** Navigation options for `router.navigate`, loosely typed (targets are built at run time). */
export type NavigateArg = Parameters<AnyRouter['navigate']>[0];

/** Opens the palette on the current route (pushes a history entry unless `replace`). */
export function openPalette(router: AnyRouter, text = '', opts: { replace?: boolean } = {}): void {
  void router.navigate({
    to: '.',
    search: ((prev: SearchRecord) => ({ ...prev, q: text })) as never,
    replace: opts.replace ?? false,
  } as NavigateArg);
}

/** True when the palette's own history entry is the current one and there is somewhere to go back to. */
function canPopPaletteEntry(router: AnyRouter, pushedAtIndex: number | null): boolean {
  if (pushedAtIndex === null) return false;
  const here = router.history.location.state.__TSR_index;
  return here === pushedAtIndex && router.history.canGoBack();
}

/**
 * Closes the palette by removing `q`. When the palette pushed its own history entry and nothing else
 * has happened since, going back keeps Back and Forward walking the user's real story; otherwise `q`
 * is removed in place.
 */
export function closePalette(router: AnyRouter, pushedAtIndex: number | null = null): void {
  if (canPopPaletteEntry(router, pushedAtIndex)) {
    router.history.back();
    return;
  }
  void router.navigate({
    to: '.',
    search: ((prev: SearchRecord) => ({ ...prev, q: undefined })) as never,
    replace: true,
  } as NavigateArg);
}

/** The history index the palette's entry sits at right now (used to decide how to close). */
export function currentHistoryIndex(router: AnyRouter): number | null {
  const i = router.history.location.state.__TSR_index;
  return typeof i === 'number' ? i : null;
}

/** Writes the typed text into `q` without adding history entries. */
export function writePaletteText(router: AnyRouter, text: string): void {
  void router.navigate({
    to: '.',
    search: ((prev: SearchRecord) => ({ ...prev, q: text })) as never,
    replace: true,
  } as NavigateArg);
}

/** Removes the palette-only params from a search object (what a destination inherits). */
export function inheritedSearch(prev: SearchRecord): SearchRecord {
  const next: SearchRecord = { ...prev };
  for (const k of DROPPED) delete next[k];
  return next;
}
