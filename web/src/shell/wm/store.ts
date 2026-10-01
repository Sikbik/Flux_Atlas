// The window manager store (vanilla, no React): the reducer plus subscriptions and the persisted
// per-type placement memory, and a keyboard handler. React reads it through react.tsx.

import { defaultWorkspace, initialWmState, topmost, wmReduce } from './machine';
import { isWindowType, WINDOW_SPECS } from './specs';
import type { PlacementMemory, Rect, Size, WindowState, WindowType, WmAction, WmState } from './types';

export const WM_STORAGE_KEY = 'atlas.wm.v1';

export interface WindowManager {
  getState(): WmState;
  subscribe(fn: (s: WmState, prev: WmState) => void): () => void;
  dispatch(action: WmAction): void;
}

export interface WindowManagerOptions {
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  now?: () => number;
  viewport?: Size;
  workspace?: Rect;
}

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isRect = (r: unknown): r is Rect => {
  const o = r as Record<string, unknown> | null;
  return !!o && num(o.x) && num(o.y) && num(o.w) && num(o.h) && o.w > 0 && o.h > 0;
};

/** Reads the persisted placement memory; anything malformed is dropped. */
export function loadMemory(storage: Pick<Storage, 'getItem'> | null): WmState['memory'] {
  if (!storage) return {};
  try {
    const raw = storage.getItem(WM_STORAGE_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw) as { memory?: Record<string, unknown> };
    const out: WmState['memory'] = {};
    for (const [k, m] of Object.entries(v.memory ?? {})) {
      if (!isWindowType(k)) continue;
      const o = m as Partial<PlacementMemory>;
      if ((o.placement !== 'docked' && o.placement !== 'floating') || !isRect(o.rect) || !num(o.dockWidth))
        continue;
      if (o.placement === 'docked' && !WINDOW_SPECS[k].dockable) continue;
      out[k as WindowType] = { placement: o.placement, rect: o.rect, dockWidth: o.dockWidth };
    }
    return out;
  } catch {
    return {};
  }
}

function saveMemory(storage: Pick<Storage, 'setItem'> | null, memory: WmState['memory']): void {
  if (!storage) return;
  try {
    storage.setItem(WM_STORAGE_KEY, JSON.stringify({ memory }));
  } catch {
    // Storage unavailable (private mode, quota): placements last for the session only.
  }
}

export function createWindowManager(opts: WindowManagerOptions = {}): WindowManager {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const now = opts.now ?? (() => Date.now());
  const viewport = opts.viewport ?? { w: 1600, h: 900 };
  let state: WmState = {
    ...initialWmState(viewport, opts.workspace ?? defaultWorkspace(viewport)),
    memory: loadMemory(storage),
  };
  const listeners = new Set<(s: WmState, prev: WmState) => void>();
  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    dispatch(action) {
      const a =
        (action.t === 'open' || action.t === 'syncRoute') && action.now === undefined
          ? { ...action, now: now() }
          : action;
      const prev = state;
      const next = wmReduce(prev, a);
      if (next === prev) return;
      state = next;
      if (next.memory !== prev.memory) saveMemory(storage, next.memory);
      for (const fn of [...listeners]) fn(next, prev);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------------------------

/** The subset of KeyboardEvent the handler reads (so tests can pass plain objects). */
export interface WmKeyEvent {
  key: string;
  code?: string;
  altKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  target?: EventTarget | null;
  preventDefault(): void;
}

export interface WmKeyOptions {
  /** Runs first on Esc; return true when it consumed the key (for example clearing the selection). */
  onEscape?: () => boolean;
  /** Closes a route-bound window by navigating (the URL then closes it through `syncRoute`). */
  onCloseRoute?: (win: WindowState) => void;
}

export const NUDGE_PX = 16;
export const NUDGE_PX_BIG = 64;

function isEditable(t: EventTarget | null | undefined): boolean {
  const el = t as (HTMLElement & { isContentEditable?: boolean }) | null | undefined;
  if (!el || typeof el !== 'object') return false;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

/**
 * Window keys (see README): Esc closes the topmost window (after `onEscape`); Alt+` / Alt+Shift+`
 * cycle focus; Alt+Arrow moves the focused floating window 16 px (Shift: 64); Alt+Ctrl+Arrow resizes
 * it (the docked inspector: Left/Right change its width); Alt+D docks or floats; Alt+M minimizes;
 * Alt+Enter maximizes or restores. Keys typed into a field are ignored, except Esc, which blurs it.
 * Returns true (and prevents the default) when it handled the key.
 */
export function wmKeyHandler(wm: WindowManager, opts: WmKeyOptions = {}): (e: WmKeyEvent) => boolean {
  const done = (e: WmKeyEvent) => {
    e.preventDefault();
    return true;
  };
  return (e) => {
    if (e.key === 'Escape') {
      if (isEditable(e.target)) {
        (e.target as HTMLElement).blur?.();
        return done(e);
      }
      if (opts.onEscape?.()) return done(e);
      const top = topmost(wm.getState());
      if (!top) return false;
      if (top.binding !== 'free' && opts.onCloseRoute) opts.onCloseRoute(top);
      else wm.dispatch({ t: 'close', id: top.id });
      return done(e);
    }
    if (!e.altKey || e.metaKey || isEditable(e.target)) return false;
    const s = wm.getState();
    if (e.code === 'Backquote' || e.key === '`' || e.key === '~') {
      wm.dispatch({ t: 'cycleFocus', dir: e.shiftKey ? -1 : 1 });
      return done(e);
    }
    const id = s.focused;
    const win = id ? s.windows[id] : undefined;
    if (!id || !win) return false;
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const dir = arrows[e.key];
    if (dir) {
      const step = e.shiftKey ? NUDGE_PX_BIG : NUDGE_PX;
      const [x, y] = dir;
      if (e.ctrlKey) {
        // The docked inspector grows to the left: Left widens it.
        const dw = win.placement === 'docked' ? -x * step : x * step;
        wm.dispatch({ t: 'nudge', id, dx: 0, dy: 0, dw, dh: y * step });
      } else {
        if (win.placement === 'docked') return false;
        wm.dispatch({ t: 'nudge', id, dx: x * step, dy: y * step, dw: 0, dh: 0 });
      }
      return done(e);
    }
    if (e.code === 'KeyD' || e.key.toLowerCase() === 'd') {
      wm.dispatch({ t: 'toggleDock', id });
      return done(e);
    }
    if (e.code === 'KeyM' || e.key.toLowerCase() === 'm') {
      wm.dispatch({ t: 'minimize', id });
      return done(e);
    }
    if (e.key === 'Enter') {
      wm.dispatch(win.mode === 'maximized' ? { t: 'restore', id } : { t: 'maximize', id });
      return done(e);
    }
    return false;
  };
}
