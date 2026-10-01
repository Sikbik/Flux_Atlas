// Navigation shared by the palette, the results page and the terminal. Every command surface ends in a
// route change, and the globe follows the URL (`globe/bindings.ts`), so a command never touches the
// engine to open something: it builds a target here and navigates.
//
// Windows are routes: the path names the focused window and `?w=` carries up to two more (design 2.2).
// So "open alongside" demotes the current window into `?w=`, and the terminal stays open while its
// commands open inspectors by riding in `?w=` the same way.

import type { AnyRouter } from '@tanstack/react-router';
import { MAX_EXTRA, parseExtraWindows, serializeExtraWindows, windowForPath } from '../../shell/wm/route';
import type { WindowRef } from '../../shell/wm/types';
import { inheritedSearch, type NavigateArg } from './paletteUrl';

type SearchRecord = Record<string, unknown>;

/** Where a command goes. `to` is a route pattern (`/node/$key`) and `params` fill its segments. */
export interface NavTarget {
  to: string;
  params?: Record<string, string>;
  /** Search params merged over the ones the destination inherits. */
  search?: SearchRecord;
  /** Search params to remove (filters being cleared). */
  clear?: readonly string[];
  /** Stay on the current route and only change the search (filters, layers). */
  stay?: boolean;
  /** A URL fragment (the settings tab). */
  fragment?: string;
}

export type OpenMode = 'open' | 'alongside' | 'keepTerminal';

/** The concrete path of a target: `/node/$key` with `{ key: 'a:b' }` becomes `/node/a%3Ab`. */
export function pathFromTarget(t: Pick<NavTarget, 'to' | 'params'>): string {
  return t.to.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_m, name: string) => {
    const v = t.params?.[name];
    return v === undefined ? '' : encodeURIComponent(v);
  });
}

function sameWindow(a: WindowRef, b: WindowRef): boolean {
  return a.type === b.type;
}

/**
 * The `?w=` list when a new window opens alongside the current one: the current primary joins the
 * extras (most recent last), the destination's own type is removed, and at most two remain.
 */
export function alongsideExtras(
  current: WindowRef | null,
  extras: readonly WindowRef[],
  destination: WindowRef | null,
): WindowRef[] {
  const list = current ? [...extras.filter((e) => !sameWindow(e, current)), current] : [...extras];
  const kept = destination ? list.filter((e) => !sameWindow(e, destination)) : list;
  return kept.slice(-MAX_EXTRA);
}

/** The `?w=` list that keeps the terminal open when its command moves the primary window elsewhere. */
export function keepTerminalExtras(
  current: WindowRef | null,
  extras: readonly WindowRef[],
  destination: WindowRef | null,
): WindowRef[] {
  const terminal: WindowRef = { type: 'terminal', key: null };
  const hadTerminal = current?.type === 'terminal' || extras.some((e) => e.type === 'terminal');
  const base = extras.filter((e) => e.type !== 'terminal');
  const list = hadTerminal ? [...base, terminal] : [...base];
  const kept = destination ? list.filter((e) => !sameWindow(e, destination)) : list;
  return kept.slice(-MAX_EXTRA);
}

export interface LocationLike {
  pathname: string;
  search: SearchRecord;
}

/** Builds the `to` and `search` for navigating to `target` from `loc` in the given mode. */
export function resolveNavigation(
  loc: LocationLike,
  target: NavTarget,
  mode: OpenMode,
): { to: string; params: Record<string, string> | undefined; search: SearchRecord; hash?: string } {
  const destination = windowForPath(pathFromTarget(target));
  const current = windowForPath(loc.pathname);
  const extras = parseExtraWindows(typeof loc.search.w === 'string' ? loc.search.w : undefined);
  // `clear` removes what the destination would inherit; `search` then sets (so a target can clear a
  // whole family of params and set one of them again).
  const inherited = inheritedSearch(loc.search);
  for (const k of target.clear ?? []) delete inherited[k];
  const search: SearchRecord = { ...inherited, ...(target.search ?? {}) };
  if (target.stay) {
    return { to: '.', params: undefined, search };
  }
  if (mode === 'alongside') {
    search.w = serializeExtraWindows(alongsideExtras(current, extras, destination));
  } else if (mode === 'keepTerminal') {
    search.w = serializeExtraWindows(keepTerminalExtras(current, extras, destination));
  }
  return {
    to: target.to,
    params: target.params,
    search,
    ...(target.fragment ? { hash: target.fragment } : {}),
  };
}

/** Navigates to `target`, replacing the palette's own history entry when `replace` is set. */
export function navigateTo(
  router: AnyRouter,
  target: NavTarget,
  mode: OpenMode = 'open',
  opts: { replace?: boolean } = {},
): void {
  const loc = router.state.location;
  const r = resolveNavigation({ pathname: loc.pathname, search: loc.search as SearchRecord }, target, mode);
  void router.navigate({
    to: r.to,
    ...(r.params ? { params: r.params } : {}),
    ...(r.hash ? { hash: r.hash } : {}),
    search: (() => r.search) as never,
    replace: opts.replace ?? false,
  } as NavigateArg);
}

/** A target for a route with no params and no search. */
export const route = (to: string, search?: SearchRecord): NavTarget => ({
  to,
  ...(search ? { search } : {}),
});
