// The window manager's route binding, on the React side: the URL drives which windows are open
// (path = the primary window, `?w=` = extras), and window actions that change what is open (close,
// focusing an extra, Esc) go back through the URL, so reload and Back/Forward always restore the
// same desktop (design 2.2, 2.4, 2.6).

import { useRouter, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect } from 'react';
import { isBooting, subscribeBoot } from '../../features/chrome/boot/state';
import { usePhone } from '../../features/chrome/phone';
import { useGlobeHandles } from '../../globe';
import { globeInset, visibleWindows } from '../wm/machine';
import { parseExtraWindows, pathForWindow, serializeExtraWindows, windowForPath } from '../wm/route';
import { sheetHeights } from '../wm/sheet';
import { TABBAR_H } from '../wm/specs';
import { type WindowManager, wmKeyHandler } from '../wm/store';
import type { Insets, WindowRef, WindowState, WmState } from '../wm/types';

type Search = Record<string, unknown>;

/** Navigation helpers that rewrite the path and `?w=` while keeping every other search param. */
export function useWindowRouting(wm: WindowManager) {
  const router = useRouter();
  const location = useRouterState({ select: (s) => s.location });

  // URL -> window manager.
  useEffect(() => {
    const search = location.search as Search;
    wm.dispatch({
      t: 'syncRoute',
      primary: windowForPath(location.pathname),
      extras: parseExtraWindows(typeof search.w === 'string' ? search.w : undefined),
      now: Date.now(),
    });
  }, [wm, location]);

  const go = useCallback(
    (path: string, search: Search, replace = false) => {
      const clean: Search = {};
      for (const [k, v] of Object.entries(search)) if (v !== undefined) clean[k] = v;
      const href = path + router.options.stringifySearch(clean);
      void router.navigate({ href, replace });
    },
    [router],
  );

  const current = useCallback(() => {
    const loc = router.state.location;
    const search = { ...(loc.search as Search) };
    const extras = parseExtraWindows(typeof search.w === 'string' ? search.w : undefined);
    return { path: loc.pathname, search, extras, primary: windowForPath(loc.pathname) };
  }, [router]);

  /** Close control or Esc: route windows leave the URL; free windows just close. */
  const requestClose = useCallback(
    (win: WindowState) => {
      if (win.binding === 'free') {
        wm.dispatch({ t: 'close', id: win.id });
        return;
      }
      const { path, search, extras } = current();
      const same = (r: WindowRef) => r.type === win.type;
      if (win.binding === 'extra') {
        go(path, { ...search, w: serializeExtraWindows(extras.filter((r) => !same(r))) });
        return;
      }
      // The primary closes: the newest extra (if any) becomes the primary, otherwise the bare globe.
      const next = extras.at(-1);
      const nextPath = next ? pathForWindow(next.type, next.key) : null;
      if (next && nextPath) {
        go(nextPath, { ...search, w: serializeExtraWindows(extras.slice(0, -1)), sel: undefined });
      } else {
        go('/', { ...search, w: undefined, sel: undefined });
      }
    },
    [wm, go, current],
  );

  /** Focusing an extra makes it the path's window; the old primary rides in `?w=` (design 2.2). */
  const focusWindow = useCallback(
    (win: WindowState) => {
      if (win.binding !== 'extra') return;
      const { search, extras, primary } = current();
      const path = pathForWindow(win.type, win.key);
      if (!path) return;
      const rest = extras.filter((r) => r.type !== win.type);
      if (primary) rest.push(primary);
      go(path, { ...search, w: serializeExtraWindows(rest.slice(-2)) }, true);
    },
    [go, current],
  );

  // Keyboard: Esc clears the selection first, then closes the topmost window; the rest of the map
  // (focus cycle, move, resize, dock, minimize, maximize) is the window manager's.
  useEffect(() => {
    const onKey = wmKeyHandler(wm, {
      onEscape: () => {
        const { path, search } = current();
        if (typeof search.sel === 'string' && search.sel) {
          go(path, { ...search, sel: undefined });
          return true;
        }
        return false;
      },
      onCloseRoute: requestClose,
    });
    const listener = (e: KeyboardEvent) => {
      onKey(e);
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [wm, go, current, requestClose]);

  return { requestClose, focusWindow };
}

/**
 * The inset the globe centres in: the window manager's, and on the phone also the Live sheet (a sheet that is not
 * a window, so the window manager does not know it), the time machine's sheet (`tmSheet`, its height in px while
 * it rests on the tab bar) and the bottom safe area (the window manager's viewport ends where the safe area
 * begins). On the desktop the time machine's strip is part of the rail, which the workspace already measures.
 */
export function insetFor(s: WmState, ambient: boolean, liveOpen: boolean, tmSheet = 0): Insets {
  if (ambient) return { left: 0, right: 0, top: 0, bottom: 0 };
  const inset = globeInset(s);
  if (s.layout !== 'phone') return inset;
  const live = liveOpen && visibleWindows(s).length === 0;
  const sheet = live ? TABBAR_H + sheetHeights(s.viewport.h)[s.sheet] : inset.bottom;
  const bottom = Math.max(sheet, tmSheet > 0 ? TABBAR_H + tmSheet : 0);
  const safe = typeof window === 'undefined' ? 0 : Math.max(0, window.innerHeight - s.viewport.h);
  return { ...inset, bottom: bottom + safe };
}

/** The height of the time machine's sheet on the phone, which it writes to the shell while the sheet is up. */
function readTmSheet(shell: Element | null): number {
  const v =
    shell instanceof HTMLElement ? Number.parseFloat(shell.style.getPropertyValue('--tm-sheet-h')) : 0;
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

/** Keeps the globe centred in the free area the windows leave (engine.setInset, 300 ms). */
export function useGlobeInsetSync(wm: WindowManager, ambient: boolean) {
  const handles = useGlobeHandles();
  useEffect(() => {
    let last = '';
    const shell = document.querySelector('.shell');
    const apply = () => {
      const engine = handles.engine.get();
      // While the boot runs it places the globe itself (centred, then easing into the free area).
      if (!engine || isBooting()) return;
      const inset = insetFor(wm.getState(), ambient, usePhone.getState().live, readTmSheet(shell));
      const key = `${inset.left},${inset.right},${inset.top},${inset.bottom}`;
      if (key === last) return;
      last = key;
      engine.setInset(inset, 300);
    };
    apply();
    const offWm = wm.subscribe(apply);
    const offEngine = handles.engine.subscribe(() => {
      last = '';
      apply();
    });
    const offBoot = subscribeBoot(() => {
      last = '';
      apply();
    });
    const offLive = usePhone.subscribe(apply);
    // The time machine's sheet announces its height as a style on the shell, the way the phone header does.
    const watch = shell ? new MutationObserver(apply) : null;
    if (shell) watch?.observe(shell, { attributes: true, attributeFilter: ['style'] });
    return () => {
      watch?.disconnect();
      offLive();
      offWm();
      offEngine();
      offBoot();
    };
  }, [wm, handles, ambient]);
}
