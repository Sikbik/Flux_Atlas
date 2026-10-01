// Window specs: default placement, size, docking, tether and key per window type (design 2.3).
// Sizes are the 1600 x 900 reference values; the reducer clamps them into the workspace.

import { currentNodeTable, isOutpoint } from '../../store/nodeKeys';
import tokens from '../../styles/tokens.json';
import type { Placement, Rect, Size, WindowType } from './types';

function px(v: string | undefined, fallback: number): number {
  const n = Number.parseFloat(v ?? '');
  return Number.isFinite(n) ? n : fallback;
}

const all = tokens.all as Record<string, string | undefined>;

/** `--window-min-w` x `--window-min-h` (320 x 240 at design v0.3). */
export const WINDOW_MIN: Size = { w: px(all['window-min-w'], 320), h: px(all['window-min-h'], 240) };
/** Phone tab bar height (`--tabbar-h`). */
export const TABBAR_H = px(all['tabbar-h'], 56);
/** Within this many px of a workspace edge a drag shows a drop zone (design 2.4, 6.4 B). */
export const SNAP_PX = 24;
/** Gap between the globe's free area and a docked or left-floating window (design 3.2). */
export const FREE_GAP = 24;
/** Margin a default floating window keeps from the workspace edges. */
export const FLOAT_MARGIN = 14;
/** Floating windows open at most this many at once, plus the docked one (design 2.3). */
export const MAX_FLOATING = 2;
/** Under this viewport width the window manager switches to the phone sheet (`--bp-phone`). */
export const PHONE_MAX_W = 720;
/** Phone sheet heights (design 3.6): peek and half are fixed; tall and full follow the viewport. */
export const SHEET = { peek: 132, half: 372, tallGap: 250, fullGap: 16 } as const;

export interface WindowSpec {
  type: WindowType;
  title(key: string | null): string;
  /** `window`: framed. `strip` and `layer` are tracked by the WM but never framed (time machine, weather). */
  chrome: 'window' | 'strip' | 'layer';
  placement: Placement;
  dockable: boolean;
  /** Docked inspector width: default, min, max. */
  dock: { w: number; min: number; max: number };
  /** Default floating rectangle. `x`: px from the viewport's left edge (right of the dock). */
  float: { x: number | 'center' | 'right'; y: 'top' | 'center' | 'bottom'; w: number; h: number | 'fill' };
  min: Size;
  /** Which side of the globe a floating window of this type occupies (the globe's left inset). */
  side: 'left' | 'right' | 'center';
  /** What the tether points at; resolved by the frame. */
  tether: 'node' | 'cluster' | 'moon' | null;
  /** Keyboard launcher letter from design 2.3 (the shell binds it; the WM only documents it). */
  key: string | null;
}

const DOCK = { w: 420, min: 360, max: 640 };
const EXPLORER_FLOAT = { x: 118, y: 'top', w: 820, h: 'fill' } as const;
const DOCKED_FLOAT = (w: number) => ({ x: 'right', y: 'top', w, h: 'fill' }) as const;

function spec(
  type: WindowType,
  title: (key: string | null) => string,
  o: Partial<Omit<WindowSpec, 'type' | 'title'>>,
): WindowSpec {
  return {
    type,
    title,
    chrome: 'window',
    placement: 'floating',
    dockable: false,
    dock: DOCK,
    float: EXPLORER_FLOAT,
    min: WINDOW_MIN,
    side: 'left',
    tether: null,
    key: null,
    ...o,
  };
}

const docked = (w: number, o: Partial<WindowSpec> = {}): Partial<WindowSpec> => ({
  placement: 'docked',
  dockable: true,
  dock: { w, min: DOCK.min, max: DOCK.max },
  float: DOCKED_FLOAT(w),
  side: 'right',
  ...o,
});

const short = (k: string) => (k.length > 20 ? `${k.slice(0, 10)}...${k.slice(-6)}` : k);
const named = (base: string) => (key: string | null) => (key ? `${base} ${short(key)}` : base);

/**
 * A node window is keyed by outpoint (ARCHITECTURE 8.1), which reads poorly: the title names the
 * node by its endpoint when the loaded snapshot knows it, and falls back to the shortened key.
 */
const nodeTitle = (key: string | null): string => {
  if (!key) return 'Node';
  const table = currentNodeTable();
  const id = table && isOutpoint(key) ? table.idOfOutpoint(key) : -1;
  const ep = id >= 0 && table ? table.endpoint(table.indexOf(id)) : '';
  return `Node ${ep || short(key)}`;
};

export const WINDOW_SPECS: Record<WindowType, WindowSpec> = {
  node: spec('node', nodeTitle, docked(420, { tether: 'node', key: 'N' })),
  host: spec('host', named('Host'), docked(420, { tether: 'cluster' })),
  app: spec('app', named('App'), docked(452, { key: 'A' })),
  operator: spec('operator', named('Operator'), docked(440, { key: 'O' })),
  about: spec('about', () => 'About Flux', docked(464, { tether: 'moon', key: 'M' })),
  block: spec('block', named('Block'), { key: 'E' }),
  tx: spec('tx', named('Transaction'), { key: 'E' }),
  address: spec('address', named('Address'), { key: 'E' }),
  mempool: spec('mempool', () => 'Mempool', { key: 'E' }),
  supply: spec('supply', () => 'Supply', { key: 'E' }),
  richlist: spec('richlist', () => 'Rich list', { key: 'E' }),
  queue: spec('queue', (k) => (k ? `Payment queue, ${k}` : 'Payment queue'), { key: 'Q' }),
  analytics: spec('analytics', (k) => (k ? `Analytics, ${k}` : 'Analytics'), {
    float: { x: 118, y: 'top', w: 1112, h: 'fill' },
    key: 'S',
  }),
  terminal: spec('terminal', () => 'Terminal', {
    float: { x: 118, y: 'bottom', w: 760, h: 420 },
    key: '`',
  }),
  settings: spec('settings', () => 'Settings', {
    float: { x: 'center', y: 'center', w: 560, h: 620 },
    side: 'center',
  }),
  time: spec('time', () => 'Time machine', { chrome: 'strip', side: 'center', key: 'T' }),
  weather: spec('weather', () => 'Network weather', { chrome: 'layer', side: 'center', key: 'W' }),
};

export const WINDOW_TYPES = Object.keys(WINDOW_SPECS) as WindowType[];

export function isWindowType(v: string): v is WindowType {
  return Object.hasOwn(WINDOW_SPECS, v);
}

/** True for types the WM frames (everything but the time strip and the weather layer). */
export function isFramed(type: WindowType): boolean {
  return WINDOW_SPECS[type].chrome === 'window';
}

/** The default floating rectangle of a type inside a workspace (before clamping). */
export function defaultFloatRect(type: WindowType, ws: Rect, viewportW: number): Rect {
  const f = WINDOW_SPECS[type].float;
  const w = Math.min(f.w, Math.max(0, ws.w - 2 * FLOAT_MARGIN));
  const h = f.h === 'fill' ? ws.h - 2 * FLOAT_MARGIN : Math.min(f.h, ws.h - 2 * FLOAT_MARGIN);
  const x =
    f.x === 'center'
      ? ws.x + (ws.w - w) / 2
      : f.x === 'right'
        ? ws.x + ws.w - w - FLOAT_MARGIN
        : Math.max(ws.x + FLOAT_MARGIN, Math.min(f.x, viewportW));
  const y =
    f.y === 'center'
      ? ws.y + (ws.h - h) / 2
      : f.y === 'bottom'
        ? ws.y + ws.h - h - FLOAT_MARGIN
        : ws.y + FLOAT_MARGIN;
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}
