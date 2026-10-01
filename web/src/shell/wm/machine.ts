// The window manager as a pure reducer: `wmReduce(state, action) -> state`. No DOM, no timers, no
// React. Unchanged state is returned by identity, so subscribers can skip work. See README.md.

import { DEFAULT_FRAMING } from '../../globe/engine/framing';
import { homeView } from '../../globe/engine/moon/orbit';
import {
  defaultFloatRect,
  FREE_GAP,
  isFramed,
  MAX_FLOATING,
  PHONE_MAX_W,
  SHEET,
  SNAP_PX,
  TABBAR_H,
  WINDOW_SPECS,
} from './specs';
import type {
  Binding,
  Insets,
  PlacementMemory,
  Rect,
  SheetSnap,
  Size,
  SnapZone,
  TetherAnchor,
  WindowRef,
  WindowState,
  WindowType,
  WmAction,
  WmState,
} from './types';

export type { WmAction } from './types';

// ---------------------------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Clamps a rectangle into the workspace, honouring the type's minimum size where it fits. */
export function clampRect(r: Rect, ws: Rect, min: Size): Rect {
  const w = Math.round(clamp(r.w, Math.min(min.w, ws.w), ws.w));
  const h = Math.round(clamp(r.h, Math.min(min.h, ws.h), ws.h));
  const x = Math.round(clamp(r.x, ws.x, ws.x + ws.w - w));
  const y = Math.round(clamp(r.y, ws.y, ws.y + ws.h - h));
  return { x, y, w, h };
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function clampDock(type: WindowType, w: number): number {
  const d = WINDOW_SPECS[type].dock;
  return Math.round(clamp(w, d.min, d.max));
}

/** The default workspace for a viewport: below the 52 px top bar, above the rail and status bar. */
export function defaultWorkspace(v: Size): Rect {
  const top = 52;
  const bottom = 104 + 28;
  return { x: 0, y: top, w: v.w, h: Math.max(0, v.h - top - bottom) };
}

export function initialWmState(viewport: Size, workspace: Rect = defaultWorkspace(viewport)): WmState {
  return {
    windows: {},
    order: [],
    focused: null,
    viewport: { ...viewport },
    workspace: { ...workspace },
    layout: viewport.w < PHONE_MAX_W ? 'phone' : 'desktop',
    sheet: 'half',
    drag: null,
    memory: {},
  };
}

// ---------------------------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------------------------

export const windowId = (type: WindowType, key: string | null) => `${type}:${key ?? ''}`;

/** The open window of a type (one window per type: opening the type again retargets it). */
export function windowOfType(s: WmState, type: WindowType): WindowState | null {
  for (const id of s.order) {
    const w = s.windows[id];
    if (w && w.type === type) return w;
  }
  return null;
}

function framedOpen(s: WmState): WindowState[] {
  const out: WindowState[] = [];
  for (const id of s.order) {
    const w = s.windows[id];
    if (w && isFramed(w.type) && w.mode !== 'minimized') out.push(w);
  }
  return out;
}

/** The topmost framed, non-minimized window. */
export function topmost(s: WmState): WindowState | null {
  const list = framedOpen(s);
  return list[list.length - 1] ?? null;
}

/** The window in the docked inspector slot (not minimized), if any. */
export function dockedWindow(s: WmState): WindowState | null {
  for (const id of s.order) {
    const w = s.windows[id];
    if (w && w.placement === 'docked' && w.mode !== 'minimized' && isFramed(w.type)) return w;
  }
  return null;
}

/** Windows to draw, bottom to top. On the phone only the sheet (the focused window) is shown. */
export function visibleWindows(s: WmState): WindowState[] {
  const list = framedOpen(s);
  if (s.layout !== 'phone') return list;
  const f = s.focused ? s.windows[s.focused] : undefined;
  const sheet = f && isFramed(f.type) && f.mode !== 'minimized' ? f : list[list.length - 1];
  return sheet ? [sheet] : [];
}

/** Minimized windows (the dock shows them as restore dots). */
export function minimizedWindows(s: WmState): WindowState[] {
  return s.order.map((id) => s.windows[id]!).filter((w) => w && w.mode === 'minimized');
}

function sheetHeight(s: WmState, snap: SheetSnap = s.sheet): number {
  const avail = s.viewport.h - TABBAR_H;
  switch (snap) {
    case 'peek':
      return Math.min(SHEET.peek, avail);
    case 'half':
      return Math.min(SHEET.half, avail);
    case 'tall':
      return Math.max(SHEET.half, avail - SHEET.tallGap);
    case 'full':
      return Math.max(0, avail - SHEET.fullGap);
  }
}

function dockedRect(s: WmState, w: WindowState): Rect {
  const ws = s.workspace;
  const width = Math.min(w.dockWidth, ws.w);
  return { x: ws.x + ws.w - width, y: ws.y, w: width, h: ws.h };
}

/** A window's resolved on-screen rectangle (docked slot, maximized workspace, phone sheet, or its rect). */
export function windowRect(s: WmState, id: string): Rect {
  const w = s.windows[id];
  if (!w) return { x: 0, y: 0, w: 0, h: 0 };
  if (s.layout === 'phone') {
    const h = sheetHeight(s);
    return { x: 0, y: s.viewport.h - TABBAR_H - h, w: s.viewport.w, h };
  }
  if (w.mode === 'maximized') return { ...s.workspace };
  if (w.placement === 'docked') return dockedRect(s, w);
  return { ...w.rect };
}

const LEFT_TYPES = new Set<WindowType>(
  (Object.keys(WINDOW_SPECS) as WindowType[]).filter((t) => WINDOW_SPECS[t].side === 'left'),
);

const NO_INSET = { left: 0, right: 0, top: 0, bottom: 0 } as const;
let minWidthFor = { w: 0, h: 0, px: 0 };

/**
 * The narrowest the planet is ever drawn on a desktop viewport, CSS px: the framing never shrinks it below
 * `minFit` of its design size (framing.ts), and the design size is what the camera shows at the home zoom
 * (`homeView` mirrors the rig). A free area narrower than this cannot hold the planet at all.
 */
export function planetMinWidth(w: number, h: number): number {
  if (minWidthFor.w !== w || minWidthFor.h !== h)
    minWidthFor = { w, h, px: 2 * DEFAULT_FRAMING.minFit * homeView(w, h, NO_INSET).planetR };
  return minWidthFor.px;
}

/**
 * Insets for `engine.setInset` so the globe and the moon centre in the free area (design 3.2): the
 * workspace edges, plus the docked inspector (its width + 24) on the right and a left-floating
 * explorer, queue or analytics window (its right edge + 24) on the left. Phone: the sheet's height.
 *
 * Docked windows always reserve their side. A maximized window covers the whole workspace and reserves
 * nothing: the planet stays framed behind it. A floating window reserves its side only while the free
 * area left after it is still as wide as the planet's minimum (`planetMinWidth`); beyond that it floats
 * over the globe, and the planet frames in what the docked windows leave. So an 820 px explorer beside
 * a docked About Flux on a 1600 px screen no longer squeezes the planet out of its free area.
 *
 * A page panel (search results, a dev page, not found) stands in the stage's left column, where a left-floating
 * window would, and reserves its side by the same rule: `pageEdge` is its right edge in CSS px (0 when there is
 * none, and on the phone, where the panel is the page and the planet stays framed behind it).
 */
export function globeInset(s: WmState, pageEdge = 0): Insets {
  const ws = s.workspace;
  const v = s.viewport;
  if (s.layout === 'phone') {
    const vis = visibleWindows(s)[0];
    const top = ws.y;
    const bottom = vis ? v.h - windowRect(s, vis.id).y : TABBAR_H;
    return { left: 0, right: 0, top, bottom };
  }
  let left = ws.x;
  let right = Math.max(0, v.w - (ws.x + ws.w));
  const top = ws.y;
  const bottom = Math.max(0, v.h - (ws.y + ws.h));
  const floating: number[] = [];
  for (const w of framedOpen(s)) {
    if (w.mode === 'maximized') continue;
    if (w.placement === 'docked') {
      right = Math.max(right, v.w - dockedRect(s, w).x + FREE_GAP);
    } else if (LEFT_TYPES.has(w.type) && w.rect.x + w.rect.w / 2 < v.w / 2) {
      floating.push(w.rect.x + w.rect.w + FREE_GAP);
    }
  }
  if (pageEdge > 0) floating.push(pageEdge + FREE_GAP);
  // The nearest edges first: a window that does not fit leaves every wider one over the globe as well.
  const room = planetMinWidth(v.w, v.h);
  for (const edge of floating.sort((a, b) => a - b)) {
    const next = Math.max(left, edge);
    if (v.w - next - right < room) break;
    left = next;
  }
  // Never leave less than a sliver of globe.
  if (left + right > v.w - 120) left = Math.max(ws.x, v.w - 120 - right);
  return {
    left: Math.round(left),
    right: Math.round(right),
    top: Math.round(top),
    bottom: Math.round(bottom),
  };
}

function zoneRect(s: WmState, w: WindowState, zone: SnapZone): Rect | null {
  const ws = s.workspace;
  if (!zone) return null;
  if (zone === 'top') return { ...ws };
  const spec = WINDOW_SPECS[w.type];
  if (zone === 'right' && spec.dockable) {
    const width = Math.min(w.dockWidth, ws.w);
    return { x: ws.x + ws.w - width, y: ws.y, w: width, h: ws.h };
  }
  const width = Math.min(Math.max(w.rect.w, spec.min.w), ws.w);
  return zone === 'left'
    ? { x: ws.x, y: ws.y, w: width, h: ws.h }
    : { x: ws.x + ws.w - width, y: ws.y, w: width, h: ws.h };
}

/** The drop-zone rectangle while a window is dragged over a snap zone. */
export function snapPreview(s: WmState): Rect | null {
  const d = s.drag;
  if (d?.kind !== 'move' || !d.zone) return null;
  const w = s.windows[d.id];
  return w ? zoneRect(s, w, d.zone) : null;
}

// ---------------------------------------------------------------------------------------------
// Reducer internals (all return new objects; callers compare identity)
// ---------------------------------------------------------------------------------------------

function put(s: WmState, w: WindowState): WmState {
  return { ...s, windows: { ...s.windows, [w.id]: w } };
}

function patch(s: WmState, id: string, p: Partial<WindowState>): WmState {
  const w = s.windows[id];
  if (!w) return s;
  let changed = false;
  for (const k of Object.keys(p) as (keyof WindowState)[]) {
    const a = w[k];
    const b = p[k];
    if (a === b) continue;
    if (k === 'rect' || k === 'restoreRect') {
      if (sameRect(a as Rect | null, b as Rect | null)) continue;
    }
    changed = true;
  }
  return changed ? put(s, { ...w, ...p }) : s;
}

function raise(s: WmState, id: string): WmState {
  const w = s.windows[id];
  if (!w) return s;
  const focusable = isFramed(w.type);
  const top = s.order[s.order.length - 1] === id;
  if (top && (!focusable || s.focused === id)) return s;
  const order = top ? s.order : [...s.order.filter((x) => x !== id), id];
  return { ...s, order, focused: focusable ? id : s.focused };
}

function refocus(s: WmState): WmState {
  const f = s.focused ? s.windows[s.focused] : undefined;
  if (f && f.mode !== 'minimized' && isFramed(f.type)) return s;
  const t = topmost(s);
  const focused = t ? t.id : null;
  return focused === s.focused ? s : { ...s, focused };
}

function remove(s: WmState, id: string): WmState {
  if (!s.windows[id]) return s;
  const windows = { ...s.windows };
  delete windows[id];
  const drag = s.drag?.id === id ? null : s.drag;
  return refocus({
    ...s,
    windows,
    order: s.order.filter((x) => x !== id),
    drag,
    focused: s.focused === id ? null : s.focused,
  });
}

function defaultTether(type: WindowType, key: string | null): TetherAnchor {
  const t = WINDOW_SPECS[type].tether;
  if (t === 'moon') return { kind: 'moon' };
  if (t === 'node' && key !== null && /^\d+$/.test(key)) return { kind: 'node', id: Number(key) };
  // Endpoint keys and host clusters are resolved by the bindings (`setTether`).
  return null;
}

function remember(s: WmState, w: WindowState): WmState {
  if (!isFramed(w.type)) return s;
  const m: PlacementMemory = { placement: w.placement, rect: { ...w.rect }, dockWidth: w.dockWidth };
  const cur = s.memory[w.type];
  if (cur && cur.placement === m.placement && cur.dockWidth === m.dockWidth && sameRect(cur.rect, m.rect))
    return s;
  return { ...s, memory: { ...s.memory, [w.type]: m } };
}

/** Frees the docked slot for `incoming`: a route-bound primary closes, anything else floats. */
function vacateDock(s: WmState, incoming: string): WmState {
  let out = s;
  for (const id of s.order) {
    const w = out.windows[id];
    if (!w || id === incoming || w.placement !== 'docked' || !isFramed(w.type)) continue;
    out = w.binding === 'primary' ? remove(out, id) : patch(out, id, { placement: 'floating' });
  }
  return out;
}

/** Keeps at most `MAX_FLOATING` floating windows: the oldest non-primary ones close first. */
function enforceFloating(s: WmState, keep: string): WmState {
  let out = s;
  const floating = () =>
    out.order
      .map((id) => out.windows[id]!)
      .filter((w) => w && w.placement === 'floating' && isFramed(w.type));
  let list = floating();
  while (list.length > MAX_FLOATING) {
    const victim = list
      .filter((w) => w.id !== keep && w.binding !== 'primary')
      .sort((a, b) => a.openedAt - b.openedAt)[0];
    if (!victim) break;
    out = remove(out, victim.id);
    list = floating();
  }
  return out;
}

function create(s: WmState, type: WindowType, key: string | null, binding: Binding, now: number): WmState {
  const spec = WINDOW_SPECS[type];
  const mem = s.memory[type];
  const ws = s.workspace;
  let placement = mem
    ? mem.placement === 'docked' && !spec.dockable
      ? 'floating'
      : mem.placement
    : spec.placement;
  // Only a primary or an explicitly opened window takes the dock from another; an extra floats.
  if (placement === 'docked' && binding === 'extra' && dockedWindow(s)) placement = 'floating';
  const rect = clampRect(mem?.rect ?? defaultFloatRect(type, ws, s.viewport.w), ws, spec.min);
  const w: WindowState = {
    id: windowId(type, key),
    type,
    key,
    title: spec.title(key),
    placement: isFramed(type) ? placement : 'floating',
    mode: 'normal',
    rect,
    restoreRect: null,
    dockWidth: clampDock(type, mem?.dockWidth ?? spec.dock.w),
    tether: defaultTether(type, key),
    binding,
    openedAt: now,
  };
  let out = put(s, w);
  out = { ...out, order: [...out.order.filter((x) => x !== w.id), w.id] };
  if (isFramed(type)) out = { ...out, focused: w.id };
  if (w.placement === 'docked') out = vacateDock(out, w.id);
  else if (isFramed(type)) out = enforceFloating(out, w.id);
  return out;
}

/** Opens a window, or retargets the open window of that type (node to node keeps the window). */
function openOrRetarget(s: WmState, ref: WindowRef, binding: Binding, now: number, focus: boolean): WmState {
  const cur = windowOfType(s, ref.type);
  if (!cur) {
    const out = create(s, ref.type, ref.key, binding, now);
    return focus ? out : { ...out, focused: s.focused && out.windows[s.focused] ? s.focused : out.focused };
  }
  const p: Partial<WindowState> = { binding };
  if (cur.key !== ref.key) {
    p.key = ref.key;
    p.title = WINDOW_SPECS[ref.type].title(ref.key);
    p.tether = defaultTether(ref.type, ref.key);
  }
  if (cur.mode === 'minimized') p.mode = 'normal';
  // A route rebinding never demotes a primary window to `extra` while it is still the primary.
  if (cur.binding === 'primary' && binding === 'extra') delete p.binding;
  let out = patch(s, cur.id, p);
  if (focus) out = raise(out, cur.id);
  return out;
}

function focusCandidates(s: WmState): WindowState[] {
  return framedOpen(s).sort((a, b) => a.openedAt - b.openedAt || (a.id < b.id ? -1 : 1));
}

// ---------------------------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------------------------

export function wmReduce(s: WmState, a: WmAction): WmState {
  switch (a.t) {
    case 'syncRoute': {
      const now = a.now ?? 0;
      const want: { ref: WindowRef; binding: Binding }[] = [];
      if (a.primary) want.push({ ref: a.primary, binding: 'primary' });
      for (const e of a.extras) {
        if (want.some((x) => x.ref.type === e.type)) continue;
        want.push({ ref: e, binding: 'extra' });
      }
      let out = s;
      // Route-bound windows whose type left the URL close; a former primary that is now an extra stays.
      for (const id of s.order) {
        const w = out.windows[id];
        if (!w || w.binding === 'free') continue;
        if (!want.some((x) => x.ref.type === w.type)) out = remove(out, id);
      }
      for (const x of want) if (x.binding === 'extra') out = openOrRetarget(out, x.ref, 'extra', now, false);
      // Demote the old primary when the primary moved to another type.
      for (const id of out.order) {
        const w = out.windows[id];
        if (w && w.binding === 'primary' && w.type !== a.primary?.type)
          out = patch(out, id, { binding: 'extra' });
      }
      if (a.primary) {
        const before = windowOfType(out, a.primary.type);
        const changed =
          !before ||
          before.key !== a.primary.key ||
          before.binding !== 'primary' ||
          before.mode === 'minimized';
        out = openOrRetarget(out, a.primary, 'primary', now, changed);
        const w = windowOfType(out, a.primary.type);
        if (w && w.placement === 'docked') out = vacateDock(out, w.id);
      }
      return refocus(out);
    }

    case 'open':
      return refocus(openOrRetarget(s, { type: a.type, key: a.key }, a.binding ?? 'free', a.now ?? 0, true));

    case 'close':
      return remove(s, a.id);

    case 'focus': {
      const w = s.windows[a.id];
      if (!w) return s;
      const out = w.mode === 'minimized' ? patch(s, a.id, { mode: 'normal' }) : s;
      return raise(out, a.id);
    }

    case 'cycleFocus': {
      const list = focusCandidates(s);
      if (list.length === 0) return s;
      const n = list.length;
      const i = list.findIndex((w) => w.id === s.focused);
      const base = i < 0 ? (a.dir > 0 ? -1 : 0) : i;
      const next = list[(((base + a.dir) % n) + n) % n]!;
      return raise(s, next.id);
    }

    case 'minimize': {
      const w = s.windows[a.id];
      if (!w || !isFramed(w.type) || w.mode === 'minimized') return s;
      const out = patch(s, a.id, {
        mode: 'minimized',
        restoreRect: w.mode === 'maximized' ? w.restoreRect : null,
      });
      return refocus({ ...out, focused: out.focused === a.id ? null : out.focused });
    }

    case 'maximize': {
      const w = s.windows[a.id];
      if (!w || !isFramed(w.type) || w.mode === 'maximized') return s;
      return raise(patch(s, a.id, { mode: 'maximized', restoreRect: { ...w.rect } }), a.id);
    }

    case 'restore': {
      const w = s.windows[a.id];
      if (!w || w.mode === 'normal') return s;
      const rect = w.restoreRect ? clampRect(w.restoreRect, s.workspace, WINDOW_SPECS[w.type].min) : w.rect;
      return raise(patch(s, a.id, { mode: 'normal', rect, restoreRect: null }), a.id);
    }

    case 'toggleDock': {
      const w = s.windows[a.id];
      if (!w || !WINDOW_SPECS[w.type].dockable) return s;
      if (w.placement === 'docked') {
        const out = patch(s, a.id, {
          placement: 'floating',
          mode: w.mode === 'maximized' ? 'normal' : w.mode,
        });
        const ww = out.windows[a.id]!;
        return raise(enforceFloating(remember(out, ww), a.id), a.id);
      }
      let out = patch(s, a.id, { placement: 'docked', mode: w.mode === 'maximized' ? 'normal' : w.mode });
      out = vacateDock(out, a.id);
      return raise(remember(out, out.windows[a.id]!), a.id);
    }

    case 'dragStart': {
      const w = s.windows[a.id];
      if (!w || !isFramed(w.type) || s.layout === 'phone') return s;
      let out = s;
      const start = windowRect(s, a.id);
      if (a.kind === 'move' && w.mode === 'maximized') {
        // Tearing a maximized window off: it returns to its size under the pointer.
        const r = w.restoreRect ?? w.rect;
        const x = a.px - r.w * ((a.px - start.x) / Math.max(1, start.w));
        out = patch(out, a.id, { mode: 'normal', restoreRect: null, rect: { ...r, x, y: start.y } });
      } else if (a.kind === 'move' && w.placement === 'docked') {
        // Dragging the docked inspector by its title bar undocks it where it is.
        out = patch(out, a.id, { placement: 'floating', rect: start });
      }
      const from = windowRect(out, a.id);
      out = raise(out, a.id);
      return {
        ...out,
        drag: { id: a.id, kind: a.kind, edges: a.edges, start: from, px: a.px, py: a.py, zone: null },
      };
    }

    case 'dragMove': {
      const d = s.drag;
      const w = d ? s.windows[d.id] : undefined;
      if (!d || !w) return s;
      const dx = a.px - d.px;
      const dy = a.py - d.py;
      const min = WINDOW_SPECS[w.type].min;
      const ws = s.workspace;
      if (d.kind === 'move') {
        const rect = { ...d.start, x: Math.round(d.start.x + dx), y: Math.round(d.start.y + dy) };
        // Keep the title bar reachable while dragging; the final clamp happens on release.
        rect.y = clamp(rect.y, ws.y, ws.y + ws.h - 32);
        let zone: SnapZone = null;
        if (a.px <= ws.x + SNAP_PX) zone = 'left';
        else if (a.px >= ws.x + ws.w - SNAP_PX) zone = 'right';
        else if (a.py <= ws.y + SNAP_PX) zone = 'top';
        const out = patch(s, d.id, { rect });
        return zone === d.zone ? out : { ...out, drag: { ...d, zone } };
      }
      if (w.placement === 'docked') {
        if (!d.edges.includes('w')) return s;
        return patch(s, d.id, { dockWidth: clampDock(w.type, d.start.w - dx) });
      }
      let { x, y, w: rw, h } = d.start;
      if (d.edges.includes('e')) rw = Math.max(min.w, d.start.w + dx);
      if (d.edges.includes('s')) h = Math.max(min.h, d.start.h + dy);
      if (d.edges.includes('w')) {
        rw = Math.max(min.w, d.start.w - dx);
        x = d.start.x + d.start.w - rw;
      }
      if (d.edges.includes('n')) {
        h = Math.max(min.h, d.start.h - dy);
        y = d.start.y + d.start.h - h;
      }
      return patch(s, d.id, {
        rect: { x: Math.round(x), y: Math.round(y), w: Math.round(rw), h: Math.round(h) },
      });
    }

    case 'dragEnd': {
      const d = s.drag;
      if (!d) return s;
      let out: WmState = { ...s, drag: null };
      const w = out.windows[d.id];
      if (!w) return out;
      const spec = WINDOW_SPECS[w.type];
      if (d.kind === 'move' && d.zone) {
        if (d.zone === 'top') {
          out = patch(out, d.id, {
            mode: 'maximized',
            restoreRect: clampRect(d.start, s.workspace, spec.min),
          });
          return out;
        }
        if (d.zone === 'right' && spec.dockable) {
          out = patch(out, d.id, { placement: 'docked', rect: clampRect(d.start, s.workspace, spec.min) });
          out = vacateDock(out, d.id);
          return remember(out, out.windows[d.id]!);
        }
        out = patch(out, d.id, { rect: zoneRect(out, w, d.zone)! });
      }
      const cur = out.windows[d.id]!;
      if (cur.placement === 'floating')
        out = patch(out, d.id, { rect: clampRect(cur.rect, s.workspace, spec.min) });
      return remember(out, out.windows[d.id]!);
    }

    case 'resize': {
      const w = s.windows[a.id];
      if (!w) return s;
      const spec = WINDOW_SPECS[w.type];
      const out =
        w.placement === 'docked'
          ? patch(s, a.id, { dockWidth: clampDock(w.type, a.rect.w) })
          : patch(s, a.id, { rect: clampRect(a.rect, s.workspace, spec.min) });
      return out === s ? s : remember(out, out.windows[a.id]!);
    }

    case 'nudge': {
      const w = s.windows[a.id];
      if (w?.mode !== 'normal' || !isFramed(w.type)) return s;
      const spec = WINDOW_SPECS[w.type];
      const out =
        w.placement === 'docked'
          ? patch(s, a.id, { dockWidth: clampDock(w.type, w.dockWidth + a.dw) })
          : patch(s, a.id, {
              rect: clampRect(
                {
                  x: w.rect.x + a.dx,
                  y: w.rect.y + a.dy,
                  w: Math.max(spec.min.w, w.rect.w + a.dw),
                  h: Math.max(spec.min.h, w.rect.h + a.dh),
                },
                s.workspace,
                spec.min,
              ),
            });
      return out === s ? s : remember(out, out.windows[a.id]!);
    }

    case 'setViewport': {
      const layout = a.viewport.w < PHONE_MAX_W ? 'phone' : 'desktop';
      if (
        layout === s.layout &&
        a.viewport.w === s.viewport.w &&
        a.viewport.h === s.viewport.h &&
        sameRect(a.workspace, s.workspace)
      )
        return s;
      let out: WmState = {
        ...s,
        viewport: { ...a.viewport },
        workspace: { ...a.workspace },
        layout,
        drag: null,
      };
      for (const id of out.order) {
        const w = out.windows[id]!;
        out = patch(out, id, { rect: clampRect(w.rect, a.workspace, WINDOW_SPECS[w.type].min) });
      }
      return out;
    }

    case 'setTether': {
      const w = s.windows[a.id];
      if (!w || sameTether(w.tether, a.tether)) return s;
      return put(s, { ...w, tether: a.tether });
    }

    case 'setSheet':
      return a.snap === s.sheet ? s : { ...s, sheet: a.snap };

    case 'setTitle':
      return patch(s, a.id, { title: a.title });
  }
}

function sameTether(a: TetherAnchor, b: TetherAnchor): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
