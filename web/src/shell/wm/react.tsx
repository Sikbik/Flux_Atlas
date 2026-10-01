// React layer over the headless window manager: a provider, selector hooks, and the window chrome (design
// 8.3). A window is a wrapper that carries the geometry, the shadow and the state attributes, a slab that
// carries the material, the rim and the chamfer, a title bar (glyph disc, title, subtitle, freshness chip,
// controls) and a body. Windows open with a scale and a fade, leave as a ghost (a close fades, a minimise
// flies to its dot in the dock), and slide to a new rectangle when maximised, docked or snapped.
//
// Each frame selects its own window, so dragging one never re-renders the layer, and the view inside is
// memoised on the fields it depends on, so dragging never re-renders the view either.

import { Maximize2, Minimize2, Minus, PanelRight, X } from 'lucide-react';
import {
  createContext,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { cssValue, play } from '../../features/chrome/motion';
import { Freshness } from '../../ui';
import { flipBetween, flipTransform, stableOrder, withGutter } from './chrome';
import { ghostOut } from './ghost';
import { WINDOW_ACCENT, WindowGlyph } from './glyphs';
import { minimizedWindows, snapPreview, visibleWindows, windowRect } from './machine';
import { metaEqual, type WindowMeta, WindowMetaContext, type WindowMetaSink } from './meta';
import { useMoreBelow } from './scrollfade';
import { SNAP_ORDER } from './sheet';
import { WINDOW_SPECS } from './specs';
import type { WindowManager } from './store';
import type { Rect, WindowState, WmAction, WmState } from './types';
import { useSheetDrag } from './useSheetDrag';
import './wm.css';

export { useWindowMeta, type WindowMeta } from './meta';

const WmContext = createContext<WindowManager | null>(null);

export function WindowManagerProvider({ wm, children }: { wm: WindowManager; children: ReactNode }) {
  return <WmContext.Provider value={wm}>{children}</WmContext.Provider>;
}

export function useWindowManager(): WindowManager {
  const wm = useContext(WmContext);
  if (!wm) throw new Error('useWindowManager must be used inside WindowManagerProvider');
  return wm;
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

/** Shallow equality for arrays (the default for array selections). */
export function listEqual<T>(a: T, b: T): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return sameList(a, b);
  return Object.is(a, b);
}

function rectEqual(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/** Selects from the window manager; re-renders only when the selection changes. */
export function useWm<T>(selector: (s: WmState) => T, equal: (a: T, b: T) => boolean = listEqual): T {
  const wm = useWindowManager();
  const memo = useRef<{ state: WmState; value: T } | null>(null);
  const get = () => {
    const s = wm.getState();
    const cur = memo.current;
    if (cur && cur.state === s) return cur.value;
    const next = selector(s);
    const value = cur && equal(cur.value, next) ? cur.value : next;
    memo.current = { state: s, value };
    return value;
  };
  return useSyncExternalStore(wm.subscribe, get, get);
}

export function useWmDispatch(): (a: WmAction) => void {
  return useWindowManager().dispatch;
}

/** Whether the layer is still mounted: when the whole layer goes (ambient), its windows leave no ghosts. */
const LayerContext = createContext<{ alive: boolean }>({ alive: true });

export interface WindowLayerProps {
  renderContent: (win: WindowState) => ReactNode;
  /** Close control or Esc on a window; route-bound windows should navigate instead of closing. */
  onRequestClose: (win: WindowState) => void;
  onFocusWindow?: (win: WindowState) => void;
}

/** Every visible window in z-order, plus the drop-zone preview while a window is dragged. */
export function WindowLayer({ renderContent, onRequestClose, onFocusWindow }: WindowLayerProps) {
  const ids = useWm((s) => visibleWindows(s).map((w) => w.id));
  const layout = useWm((s) => s.layout);
  const preview = useWm(snapPreview, (a, b) => a === b || (!!a && !!b && rectEqual(a, b)));
  const order = useRef<string[]>([]);
  order.current = stableOrder(order.current, ids);
  const layer = useRef({ alive: true });
  useLayoutEffect(() => {
    const l = layer.current;
    l.alive = true;
    return () => {
      l.alive = false;
    };
  }, []);
  return (
    <LayerContext.Provider value={layer.current}>
      <div className="wm-layer" data-layout={layout}>
        {order.current.map((id) => (
          <WindowFrame
            key={id}
            id={id}
            z={ids.indexOf(id)}
            phone={layout === 'phone'}
            renderContent={renderContent}
            onRequestClose={onRequestClose}
            onFocusWindow={onFocusWindow}
          />
        ))}
        {preview ? (
          <div
            className="wm-drop-zone"
            aria-hidden="true"
            style={{ left: preview.x, top: preview.y, width: preview.w, height: preview.h }}
          />
        ) : null}
      </div>
    </LayerContext.Provider>
  );
}

const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

/** A window that fills the workspace's height keeps this gutter above and below (design 3.1). */
export const GUTTER = 12;

interface FrameProps {
  id: string;
  z: number;
  phone: boolean;
  renderContent: (win: WindowState) => ReactNode;
  onRequestClose: (win: WindowState) => void;
  onFocusWindow: ((win: WindowState) => void) | undefined;
}

export function WindowFrame(props: FrameProps) {
  const win = useWm((s) => s.windows[props.id], Object.is);
  return win ? <Frame {...props} win={win} /> : null;
}

function Frame({
  win,
  z,
  phone,
  renderContent,
  onRequestClose,
  onFocusWindow,
}: FrameProps & { win: WindowState }) {
  const wm = useWindowManager();
  const { dispatch } = wm;
  const layer = useContext(LayerContext);
  const id = win.id;
  const rect = useWm((s) => windowRect(s, id), rectEqual);
  const focused = useWm((s) => s.focused === id, Object.is);
  const dragging = useWm((s) => s.drag?.id === id, Object.is);
  const sheet = useWm((s) => s.sheet, Object.is);
  const viewport = useWm((s) => `${s.viewport.w}x${s.viewport.h}`, Object.is);
  const viewportH = useWm((s) => s.viewport.h, Object.is);
  const spec = WINDOW_SPECS[win.type];
  const titleId = `wm-title-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const rootRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const [meta, setMeta] = useState<WindowMeta | null>(null);
  const sink = useMemo<WindowMetaSink>(() => ({ set: (m) => setMeta((p) => (metaEqual(p, m) ? p : m)) }), []);

  const maximized = win.mode === 'maximized';
  const docked = win.placement === 'docked';
  const workspace = useWm((s) => s.workspace, rectEqual);
  const box: Rect = phone ? rect : withGutter(rect, workspace, GUTTER);

  // The view depends on these fields alone: a drag changes the rectangle every frame and must not re-render it.
  const winRef = useRef(win);
  winRef.current = win;
  const contentKey = [win.type, win.key ?? '', win.binding, win.placement, win.mode, win.title].join(
    '\u0000',
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: contentKey stands for the fields the view depends on
  const content = useMemo(() => renderContent(winRef.current), [contentKey, renderContent]);

  // Focus raises the window; for an extra it also makes it the path's window (design 2.2), except when the
  // pointer goes down on a control: closing or minimising an unfocused window must not swap the route first.
  const focus = useCallback(
    (route = true) => {
      if (wm.getState().focused !== id) dispatch({ t: 'focus', id });
      if (route) onFocusWindow?.(winRef.current);
    },
    [wm, dispatch, id, onFocusWindow],
  );

  // A window that is closed or minimised leaves a ghost in its place (design 8.3).
  useLayoutEffect(() => {
    const el = rootRef.current;
    const type = win.type;
    return () => {
      if (!el || !layer.alive) return;
      const now = wm.getState().windows[id];
      if (!now) ghostOut(el, 'close', type);
      else if (now.mode === 'minimized') ghostOut(el, 'minimize', type);
    };
  }, [wm, layer, id, win.type]);

  // A window that moves to a new rectangle (maximise, dock, float, snap) slides there instead of jumping;
  // dragging, resizing and a changing viewport follow the pointer or the screen and never animate.
  const last = useRef<{ box: Rect; viewport: string } | null>(null);
  useLayoutEffect(() => {
    const el = rootRef.current;
    const before = last.current;
    last.current = { box, viewport };
    if (!el || !before || dragging || phone || before.viewport !== viewport) return;
    const f = flipBetween(before.box, box);
    if (!f) return;
    const ease = cssValue('--ease-out-expo', 'cubic-bezier(0.16, 1, 0.3, 1)');
    play(
      el,
      [
        { transformOrigin: '0 0', transform: flipTransform(f) },
        { transformOrigin: '0 0', transform: 'none' },
      ],
      { duration: 340, easing: ease },
    );
  });

  // Retargeting (node to node) swaps the body with a short fade and a 6 px rise; the frame stays still.
  const lastKey = useRef(win.key);
  useEffect(() => {
    if (lastKey.current === win.key) return;
    lastKey.current = win.key;
    const body = bodyRef.current;
    if (!body) return;
    play(
      body,
      [
        { opacity: 0, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'none' },
      ],
      {
        duration: 320,
        easing: cssValue('--ease-out', 'cubic-bezier(0.22, 1, 0.36, 1)'),
        reduced: [{ opacity: 0 }, { opacity: 1 }],
      },
    );
  }, [win.key]);

  useMoreBelow(bodyRef);

  const startDrag = (e: ReactPointerEvent<HTMLElement>, kind: 'move' | 'resize', edges: string) => {
    if (e.button !== 0 || phone) return;
    if (kind === 'move' && (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    focus();
    dispatch({ t: 'dragStart', id, kind, edges, px: e.clientX, py: e.clientY });
  };
  const moveDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (wm.getState().drag?.id === id) dispatch({ t: 'dragMove', px: e.clientX, py: e.clientY });
  };
  const endDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (wm.getState().drag?.id === id) dispatch({ t: 'dragEnd' });
  };
  const dragHandlers = (kind: 'move' | 'resize', edges: string) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => startDrag(e, kind, edges),
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  });

  const toggleMaximize = () => dispatch(maximized ? { t: 'restore', id } : { t: 'maximize', id });
  const nextSnap = SNAP_ORDER[(SNAP_ORDER.indexOf(sheet) + 1) % SNAP_ORDER.length] ?? 'half';
  // The phone's sheet: the grabber and the title bar drag it between its snaps (sheet.ts, useSheetDrag.ts).
  const sheetDrag = useSheetDrag({
    elRef: rootRef,
    snap: sheet,
    viewportH,
    onSnap: (snap) => dispatch({ t: 'setSheet', snap }),
    onDismiss: () => onRequestClose(winRef.current),
  });
  const stepSheet = (dir: 1 | -1) => {
    const to = SNAP_ORDER[Math.min(SNAP_ORDER.length - 1, Math.max(0, SNAP_ORDER.indexOf(sheet) + dir))];
    if (to && to !== sheet) dispatch({ t: 'setSheet', snap: to });
  };
  const tier = win.type === 'node' && meta?.tier && meta.tier !== 'unknown' ? meta.tier : undefined;
  const accent = meta?.accent ?? WINDOW_ACCENT[win.type];
  return (
    <section
      ref={rootRef}
      className="wm-window"
      role="dialog"
      aria-labelledby={titleId}
      data-window-type={win.type}
      data-window-id={id}
      data-placement={phone ? 'sheet' : docked ? 'docked' : 'floating'}
      data-mode={win.mode}
      data-snap={phone ? sheet : undefined}
      data-focused={focused || undefined}
      data-dragging={dragging || undefined}
      data-tier={tier}
      data-accent={tier ? undefined : accent}
      style={{
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        zIndex: `min(calc(var(--z-window) + ${z}), var(--z-window-max))`,
      }}
      onPointerDownCapture={(e) => focus(!(e.target as Element).closest('.wm-controls'))}
    >
      <div className="wm-slab">
        {phone ? (
          <button
            type="button"
            className="wm-grabber"
            aria-label={`Sheet size ${sheet}, switch to ${nextSnap}`}
            {...sheetDrag.handlers}
            onClick={() => {
              if (!sheetDrag.wasDragged()) dispatch({ t: 'setSheet', snap: nextSnap });
            }}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
              e.preventDefault();
              stepSheet(e.key === 'ArrowUp' ? 1 : -1);
            }}
          />
        ) : null}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: a double-click on the title bar maximises, like any desktop window; the Maximize button is the keyboard route */}
        <header
          className="wm-titlebar"
          data-fx-density="dense"
          {...(phone ? sheetDrag.handlers : dragHandlers('move', ''))}
          onDoubleClick={(e) => {
            if (!phone && !(e.target as HTMLElement).closest('button')) toggleMaximize();
          }}
        >
          <span className="wm-glyph" aria-hidden="true">
            <WindowGlyph type={win.type} tier={tier} size={phone ? 20 : 16} />
          </span>
          <div className="wm-heading">
            <h2 className="wm-title" id={titleId} data-mono={meta?.mono || undefined}>
              {win.title}
            </h2>
            {meta?.subtitle ? <small className="wm-sub">{meta.subtitle}</small> : null}
          </div>
          {meta?.fresh ? (
            <Freshness
              ts={meta.fresh.evidenceMs}
              cadenceMs={meta.fresh.cadenceMs}
              label={meta.fresh.label}
              className="wm-fresh"
            />
          ) : null}
          <div className="wm-controls">
            {phone ? null : (
              <>
                {spec.dockable ? (
                  <button
                    type="button"
                    className="wm-btn"
                    aria-label={docked ? 'Float window' : 'Dock window'}
                    aria-pressed={docked}
                    onClick={() => dispatch({ t: 'toggleDock', id })}
                  >
                    <PanelRight size={15} strokeWidth={1.6} aria-hidden="true" />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="wm-btn wm-btn-min"
                  aria-label="Minimize"
                  onClick={() => dispatch({ t: 'minimize', id })}
                >
                  <Minus size={15} strokeWidth={1.6} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="wm-btn wm-btn-max"
                  aria-label={maximized ? 'Restore' : 'Maximize'}
                  onClick={toggleMaximize}
                >
                  {maximized ? (
                    <Minimize2 size={14} strokeWidth={1.6} aria-hidden="true" />
                  ) : (
                    <Maximize2 size={14} strokeWidth={1.6} aria-hidden="true" />
                  )}
                </button>
              </>
            )}
            <button
              type="button"
              className="wm-btn wm-btn-close"
              aria-label="Close"
              onClick={() => onRequestClose(win)}
            >
              <X size={15} strokeWidth={1.6} aria-hidden="true" />
            </button>
          </div>
        </header>
        <div className="wm-body" ref={bodyRef}>
          <WindowMetaContext.Provider value={sink}>
            <Suspense fallback={null}>{content}</Suspense>
          </WindowMetaContext.Provider>
        </div>
      </div>
      {phone || maximized ? null : docked ? (
        <div className="wm-resize" data-edge="w" aria-hidden="true" {...dragHandlers('resize', 'w')} />
      ) : (
        EDGES.map((edge) => (
          <div
            key={edge}
            className="wm-resize"
            data-edge={edge}
            aria-hidden="true"
            {...dragHandlers('resize', edge)}
          />
        ))
      )}
      <span className="wm-cut" aria-hidden="true" />
    </section>
  );
}

/** Minimized windows as restore buttons (the dock places them under its launchers). */
export function WindowDots({ className }: { className?: string }) {
  const dispatch = useWmDispatch();
  const mins = useWm(minimizedWindows);
  if (mins.length === 0) return null;
  return (
    <ul className={className ? `wm-dots ${className}` : 'wm-dots'} aria-label="Minimized windows">
      {mins.map((w) => (
        <li key={w.id}>
          <button
            type="button"
            className="wm-dot"
            data-window-type={w.type}
            aria-label={`Restore ${w.title}`}
            title={w.title}
            onClick={() => dispatch({ t: 'focus', id: w.id })}
          />
        </li>
      ))}
    </ul>
  );
}
