// React access to the globe: the engine (once its chunk has loaded), the store bindings, the anchor
// system and the hover state. The engine itself never re-renders React; components read these
// handles and register DOM with the anchor system (`useGlobeAnchor`, `GlobeLabel`, `Tether`).

import {
  type CSSProperties,
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { type Anchor, AnchorSystem, type PlaceOptions } from './anchors';
import type { GlobeBinding, GlobeHover, GlobeTarget } from './bindings';

export type GlobeStatus = 'loading' | 'ready' | 'unsupported' | 'error';

/** A small external store (no React state for per-frame or per-pointer-move data). */
export class Signal<T> {
  private value: T;
  private readonly listeners = new Set<() => void>();
  constructor(v: T) {
    this.value = v;
  }
  get = (): T => this.value;
  set(v: T): void {
    if (Object.is(v, this.value)) return;
    this.value = v;
    for (const fn of [...this.listeners]) fn();
  }
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
}

export interface GlobeHandles {
  anchors: AnchorSystem;
  /** The engine and its binding, once loaded (null while the chunk loads, or without WebGL2). */
  engine: Signal<GlobeTarget | null>;
  binding: Signal<GlobeBinding | null>;
  status: Signal<GlobeStatus>;
  /** What the pointer is over: a node (with its pick info) or the moon. */
  hover: Signal<GlobeHover | null>;
}

const GlobeContext = createContext<GlobeHandles | null>(null);

export function createGlobeHandles(): GlobeHandles {
  return {
    anchors: new AnchorSystem(),
    engine: new Signal<GlobeTarget | null>(null),
    binding: new Signal<GlobeBinding | null>(null),
    status: new Signal<GlobeStatus>('loading'),
    hover: new Signal<GlobeHover | null>(null),
  };
}

export function GlobeProvider({ children, handles }: { children: ReactNode; handles?: GlobeHandles }) {
  const [h] = useState(() => handles ?? createGlobeHandles());
  return <GlobeContext.Provider value={h}>{children}</GlobeContext.Provider>;
}

export function useGlobeHandles(): GlobeHandles {
  const h = useContext(GlobeContext);
  if (!h) throw new Error('useGlobeHandles must be used inside GlobeProvider');
  return h;
}

export function useSignal<T>(s: Signal<T>): T {
  return useSyncExternalStore(s.subscribe, s.get, s.get);
}

/** The engine (re-renders when it loads or is replaced after a lost context). */
export const useGlobeEngine = () => useSignal(useGlobeHandles().engine);
export const useGlobeBinding = () => useSignal(useGlobeHandles().binding);
export const useGlobeStatus = () => useSignal(useGlobeHandles().status);
/** Hover state for tooltips (re-renders on hover changes only, not per frame). */
export const useGlobeHover = () => useSignal(useGlobeHandles().hover);

function anchorKey(a: Anchor | null): string {
  if (!a) return 'none';
  switch (a.kind) {
    case 'world':
      return `w:${a.lat}:${a.lon}:${a.alt ?? ''}`;
    case 'node':
      return `n:${a.id}`;
    case 'moon':
      return `m:${a.at ?? ''}`;
    case 'element':
      return `e:${a.fx ?? ''}:${a.fy ?? ''}:${a.dx ?? ''}:${a.dy ?? ''}`;
    case 'point':
      return `p:${a.x}:${a.y}`;
  }
}

/**
 * Keeps `ref`'s element on `anchor` every frame (no re-render). Pass null to hide it. The element
 * should be absolutely positioned at the top left of a fixed, full-viewport layer.
 */
export function useGlobeAnchor(
  ref: RefObject<HTMLElement | null>,
  anchor: Anchor | null,
  opts: PlaceOptions = {},
): void {
  const { anchors } = useGlobeHandles();
  const handle = useRef<ReturnType<AnchorSystem['place']> | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const elementTarget = anchor?.kind === 'element' ? anchor.el : null;
  const key = anchorKey(anchor);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-registers when the anchor's identity (key) changes
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    handle.current = anchors.place(el, anchor, optsRef.current);
    return () => {
      handle.current?.remove();
      handle.current = null;
    };
  }, [anchors, key, elementTarget, ref]);
}

/** An HTML label pinned to a globe anchor. */
export function GlobeLabel({
  anchor,
  children,
  className,
  style,
  options,
}: {
  anchor: Anchor | null;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  options?: PlaceOptions;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useGlobeAnchor(ref, anchor, options);
  return (
    <div ref={ref} className={className ? `globe-label ${className}` : 'globe-label'} style={style}>
      {children}
    </div>
  );
}

/**
 * A tether line from a globe anchor (node, host site, the moon) to a target (usually a window header
 * element). Drawn as one SVG path with a 45 degree elbow, updated every frame by the anchor system.
 */
export function Tether({
  from,
  to,
  className,
}: {
  from: Anchor | null;
  to: Anchor | null;
  className?: string;
}) {
  const { anchors } = useGlobeHandles();
  const pathRef = useRef<SVGPathElement>(null);
  const fromKey = anchorKey(from);
  const toKey = anchorKey(to);
  const toEl = to?.kind === 'element' ? to.el : null;
  const fromEl = from?.kind === 'element' ? from.el : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-registers when either end's identity changes
  useLayoutEffect(() => {
    const path = pathRef.current;
    if (!path || !from || !to) return;
    const h = anchors.tether(path, from, to);
    return () => h.remove();
  }, [anchors, fromKey, toKey, toEl, fromEl]);
  const svgClass = useMemo(() => (className ? `globe-tether ${className}` : 'globe-tether'), [className]);
  if (!from || !to) return null;
  return (
    <svg className={svgClass} aria-hidden="true">
      <path ref={pathRef} />
    </svg>
  );
}
