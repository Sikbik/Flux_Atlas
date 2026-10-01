// React layer over the headless window manager: a provider, selector hooks, and a minimal,
// token-driven window frame. The shell team restyles `wm.css`; behaviour lives in machine.ts.

import {
  createContext,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  Suspense,
  useCallback,
  useContext,
  useRef,
  useSyncExternalStore,
} from 'react';
import { minimizedWindows, snapPreview, visibleWindows, windowRect } from './machine';
import { WINDOW_SPECS } from './specs';
import type { WindowManager } from './store';
import type { Rect, SheetSnap, WindowState, WmAction, WmState } from './types';
import './wm.css';

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

export interface WindowLayerProps {
  renderContent: (win: WindowState) => ReactNode;
  /** Close control or Esc on a window; route-bound windows should navigate instead of closing. */
  onRequestClose: (win: WindowState) => void;
  onFocusWindow?: (win: WindowState) => void;
}

/** Every visible window in z-order, plus the drop-zone preview while a window is dragged. */
export function WindowLayer({ renderContent, onRequestClose, onFocusWindow }: WindowLayerProps) {
  const wins = useWm(visibleWindows);
  const layout = useWm((s) => s.layout);
  const preview = useWm(snapPreview, (a, b) => a === b || (!!a && !!b && rectEqual(a, b)));
  return (
    <div className="wm-layer" data-layout={layout}>
      {wins.map((w, i) => (
        <WindowFrame
          key={w.id}
          win={w}
          z={i}
          phone={layout === 'phone'}
          onRequestClose={onRequestClose}
          onFocusWindow={onFocusWindow}
        >
          {renderContent(w)}
        </WindowFrame>
      ))}
      {preview ? (
        <div
          className="wm-drop-zone"
          aria-hidden="true"
          style={{ left: preview.x, top: preview.y, width: preview.w, height: preview.h }}
        />
      ) : null}
    </div>
  );
}

const SNAPS: SheetSnap[] = ['peek', 'half', 'tall', 'full'];
const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

interface FrameProps {
  win: WindowState;
  z: number;
  phone: boolean;
  children: ReactNode;
  onRequestClose: (win: WindowState) => void;
  onFocusWindow: ((win: WindowState) => void) | undefined;
}

/** Minimal window chrome: title bar (drag handle), controls, resize handles, content. */
export function WindowFrame({ win, z, phone, children, onRequestClose, onFocusWindow }: FrameProps) {
  const wm = useWindowManager();
  const { dispatch } = wm;
  const rect = useWm((s) => windowRect(s, win.id), rectEqual);
  const focused = useWm((s) => s.focused === win.id);
  const dragging = useWm((s) => s.drag?.id === win.id);
  const sheet = useWm((s) => s.sheet);
  const spec = WINDOW_SPECS[win.type];
  const titleId = `wm-title-${win.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

  const focus = useCallback(() => {
    if (wm.getState().focused !== win.id) dispatch({ t: 'focus', id: win.id });
    onFocusWindow?.(win);
  }, [wm, dispatch, win, onFocusWindow]);

  const startDrag = (e: ReactPointerEvent<HTMLElement>, kind: 'move' | 'resize', edges: string) => {
    if (e.button !== 0 || phone) return;
    if (kind === 'move' && (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    focus();
    dispatch({ t: 'dragStart', id: win.id, kind, edges, px: e.clientX, py: e.clientY });
  };
  const moveDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (wm.getState().drag?.id === win.id) dispatch({ t: 'dragMove', px: e.clientX, py: e.clientY });
  };
  const endDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (wm.getState().drag?.id === win.id) dispatch({ t: 'dragEnd' });
  };
  const dragHandlers = (kind: 'move' | 'resize', edges: string) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => startDrag(e, kind, edges),
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  });

  const maximized = win.mode === 'maximized';
  const docked = win.placement === 'docked';
  const nextSnap = SNAPS[(SNAPS.indexOf(sheet) + 1) % SNAPS.length]!;
  return (
    <section
      className="wm-window"
      role="dialog"
      aria-labelledby={titleId}
      data-window-type={win.type}
      data-window-id={win.id}
      data-placement={phone ? 'sheet' : docked ? 'docked' : 'floating'}
      data-mode={win.mode}
      data-focused={focused || undefined}
      data-dragging={dragging || undefined}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        zIndex: `min(calc(var(--z-window) + ${z}), var(--z-window-max))`,
      }}
      onPointerDownCapture={focus}
    >
      {phone ? (
        <button
          type="button"
          className="wm-grabber"
          aria-label={`Sheet size ${sheet}, switch to ${nextSnap}`}
          onClick={() => dispatch({ t: 'setSheet', snap: nextSnap })}
        />
      ) : null}
      <header className="wm-titlebar" {...dragHandlers('move', '')}>
        <h2 className="wm-title" id={titleId}>
          {win.title}
        </h2>
        <div className="wm-controls">
          {phone ? null : (
            <>
              <button
                type="button"
                className="wm-btn"
                aria-label="Minimize"
                onClick={() => dispatch({ t: 'minimize', id: win.id })}
              >
                <span aria-hidden="true">_</span>
              </button>
              <button
                type="button"
                className="wm-btn"
                aria-label={maximized ? 'Restore' : 'Maximize'}
                onClick={() =>
                  dispatch(maximized ? { t: 'restore', id: win.id } : { t: 'maximize', id: win.id })
                }
              >
                <span aria-hidden="true">{maximized ? '=' : '+'}</span>
              </button>
              {spec.dockable ? (
                <button
                  type="button"
                  className="wm-btn"
                  aria-label={docked ? 'Float window' : 'Dock window'}
                  aria-pressed={docked}
                  onClick={() => dispatch({ t: 'toggleDock', id: win.id })}
                >
                  <span aria-hidden="true">|</span>
                </button>
              ) : null}
            </>
          )}
          <button type="button" className="wm-btn" aria-label="Close" onClick={() => onRequestClose(win)}>
            <span aria-hidden="true">x</span>
          </button>
        </div>
      </header>
      <div className="wm-body">
        <Suspense fallback={null}>{children}</Suspense>
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
