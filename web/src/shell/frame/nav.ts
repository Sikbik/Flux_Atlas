// Navigation the frame performs on behalf of its launchers (dock, menus, top bar, keys, phone tabs):
// opening a window keeps the others in `?w=` as the design asks (2.2: the path is the focused window,
// at most two more ride in the query), the bare globe closes them all, and the palette opens by
// putting `q` in the URL (the palette is open while the URL carries `?q=`, even empty).

import { useRouter } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import {
  MAX_EXTRA,
  parseExtraWindows,
  pathForWindow,
  serializeExtraWindows,
  windowForPath,
} from '../wm/route';
import { WINDOW_SPECS } from '../wm/specs';
import type { WindowRef } from '../wm/types';

export type Search = Record<string, unknown>;

/**
 * True for a route that draws a panel of its own in the stage's page slot: search results, the dev galleries
 * and not found. Not the bare globe, not ambient, and not a window or a strip or layer type, which have their
 * own place. The Pulse and the aim strip stand where that panel opens, so the shell has them step aside.
 */
export function isPagePanel(pathname: string): boolean {
  if (pathname === '/' || pathname === '/ambient') return false;
  return windowForPath(pathname) === null;
}

export interface Here {
  path: string;
  search: Search;
  extras: WindowRef[];
  primary: WindowRef | null;
}

/** Keeps a framed primary window alive when `next` opens, unless both want the one docked slot. */
export function carriesOver(primary: WindowRef | null, next: WindowRef): boolean {
  if (!primary || primary.type === next.type) return false;
  if (WINDOW_SPECS[primary.type].chrome !== 'window') return false;
  // The docked inspector slot swaps in place: a docked window replaces the docked window.
  return !(WINDOW_SPECS[primary.type].dockable && WINDOW_SPECS[next.type].dockable);
}

/** The `?w=` list after opening `next` from `here`: the old primary rides along, the newest last. */
export function extrasAfterOpen(here: Pick<Here, 'primary' | 'extras'>, next: WindowRef): WindowRef[] {
  const rest = here.extras.filter((r) => r.type !== next.type);
  if (here.primary && carriesOver(here.primary, next)) rest.push(here.primary);
  return rest.slice(-MAX_EXTRA);
}

export interface ShellNav {
  here(): Here;
  go(path: string, search: Search, replace?: boolean): void;
  /** Opens a window as the path's focused window; the others keep riding in `?w=`. */
  open(ref: WindowRef, opts?: { search?: Search }): void;
  /** The bare globe: no windows, no selection (the key G). */
  globe(): void;
  /** Opens the command palette with `text` in the field (empty by default). */
  palette(text?: string): void;
  /** Sets or clears search params on the current path (filters, layers). */
  patchSearch(patch: Search, replace?: boolean): void;
}

/** Navigation helpers over the router; stable for the lifetime of the router. */
export function useShellNav(): ShellNav {
  const router = useRouter();

  const here = useCallback((): Here => {
    const loc = router.state.location;
    const search = { ...(loc.search as Search) };
    return {
      path: loc.pathname,
      search,
      extras: parseExtraWindows(typeof search.w === 'string' ? search.w : undefined),
      primary: windowForPath(loc.pathname),
    };
  }, [router]);

  const go = useCallback(
    (path: string, search: Search, replace = false) => {
      const clean: Search = {};
      for (const [k, v] of Object.entries(search)) if (v !== undefined) clean[k] = v;
      void router.navigate({ href: path + router.options.stringifySearch(clean), replace });
    },
    [router],
  );

  return useMemo<ShellNav>(
    () => ({
      here,
      go,
      open(ref, opts) {
        const h = here();
        const path = pathForWindow(ref.type, ref.key);
        if (!path) return;
        go(path, { ...h.search, ...opts?.search, w: serializeExtraWindows(extrasAfterOpen(h, ref)) });
      },
      globe() {
        const h = here();
        go('/', { ...h.search, w: undefined, sel: undefined });
      },
      palette(text = '') {
        const h = here();
        go(h.path, { ...h.search, q: text });
      },
      patchSearch(patch, replace = true) {
        const h = here();
        go(h.path, { ...h.search, ...patch }, replace);
      },
    }),
    [here, go],
  );
}
