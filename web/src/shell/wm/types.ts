// Window-manager types. The window manager is headless: plain data and a pure reducer
// (machine.ts), a tiny store (store.ts) and a thin React layer (react.tsx). See README.md.

/** Every window kind in the design IA (section 2.3). `time` and `weather` are tracked, never framed. */
export type WindowType =
  | 'nodes'
  | 'node'
  | 'host'
  | 'apps'
  | 'app'
  | 'explorer'
  | 'block'
  | 'tx'
  | 'address'
  | 'mempool'
  | 'supply'
  | 'richlist'
  | 'queue'
  | 'analytics'
  | 'operator'
  | 'wallet'
  | 'terminal'
  | 'time'
  | 'weather'
  | 'about'
  | 'settings';

/** CSS pixels in viewport coordinates. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}

/** `docked`: the right inspector slot (one at a time). `floating`: a free rectangle over the globe. */
export type Placement = 'docked' | 'floating';
export type WinMode = 'normal' | 'minimized' | 'maximized';
/** Drop zone under the pointer while a window is dragged by its title bar. */
export type SnapZone = 'left' | 'right' | 'top' | null;
/** Phone bottom-sheet snap points (design 3.6). */
export type SheetSnap = 'peek' | 'half' | 'tall' | 'full';

/** What a window's tether line points at (design 6.4 A); the frame resolves it to screen space. */
export type TetherAnchor =
  | { kind: 'node'; id: number }
  | { kind: 'cluster'; lat: number; lon: number }
  | { kind: 'moon' }
  | { kind: 'element'; elementId: string }
  | null;

/**
 * How a window came to be: `primary` is the URL path's window, `extra` rides in `?w=`, `free` was
 * opened imperatively (not in the URL).
 */
export type Binding = 'primary' | 'extra' | 'free';

/** A window type plus its subject (node key, app name, block key...). */
export interface WindowRef {
  type: WindowType;
  key: string | null;
}

export interface WindowState {
  /** `${type}:${key}` of the key it opened with; stable when the window is retargeted. */
  id: string;
  type: WindowType;
  key: string | null;
  title: string;
  placement: Placement;
  mode: WinMode;
  /** The floating rectangle (docked windows keep it for when they float again). */
  rect: Rect;
  /** The rectangle to return to after `maximized`. */
  restoreRect: Rect | null;
  /** Width in the docked inspector slot. */
  dockWidth: number;
  tether: TetherAnchor;
  binding: Binding;
  openedAt: number;
}

export interface DragState {
  id: string;
  kind: 'move' | 'resize';
  /** Resize edges as letters from `nsew` (`'w'`, `'se'`); empty for a move. */
  edges: string;
  /** The window's resolved rectangle when the drag started. */
  start: Rect;
  /** Pointer position when the drag started. */
  px: number;
  py: number;
  zone: SnapZone;
}

export interface PlacementMemory {
  placement: Placement;
  rect: Rect;
  dockWidth: number;
}

export interface WmState {
  windows: Record<string, WindowState>;
  /** Z-order, bottom to top. */
  order: string[];
  focused: string | null;
  viewport: Size;
  /** The area windows may occupy (viewport minus top bar, rail and status bar); the frame sets it. */
  workspace: Rect;
  layout: 'desktop' | 'phone';
  sheet: SheetSnap;
  drag: DragState | null;
  /** Last placement per window type (design 2.4 Memory); persisted by the store. */
  memory: Partial<Record<WindowType, PlacementMemory>>;
}

/** Everything the reducer understands. `now` defaults to the store's clock when omitted. */
export type WmAction =
  | { t: 'syncRoute'; primary: WindowRef | null; extras: WindowRef[]; now?: number }
  | { t: 'open'; type: WindowType; key: string | null; now?: number; binding?: Binding }
  | { t: 'close'; id: string }
  | { t: 'focus'; id: string }
  | { t: 'cycleFocus'; dir: 1 | -1 }
  | { t: 'minimize'; id: string }
  | { t: 'maximize'; id: string }
  | { t: 'restore'; id: string }
  | { t: 'toggleDock'; id: string }
  | { t: 'dragStart'; id: string; kind: 'move' | 'resize'; edges: string; px: number; py: number }
  | { t: 'dragMove'; px: number; py: number }
  | { t: 'dragEnd' }
  | { t: 'resize'; id: string; rect: Rect }
  | { t: 'nudge'; id: string; dx: number; dy: number; dw: number; dh: number }
  | { t: 'setViewport'; viewport: Size; workspace: Rect }
  | { t: 'setTether'; id: string; tether: TetherAnchor }
  | { t: 'setSheet'; snap: SheetSnap }
  | { t: 'setTitle'; id: string; title: string };

export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
