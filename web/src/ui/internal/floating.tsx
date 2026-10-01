// Shared plumbing for floating layers: a portal into `document.body` (layers escape window
// overflow and stacking), live positioning against an anchor, and outside-press / Escape dismissal.

import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  type Box,
  computePosition,
  intersect,
  isOutOfView,
  type Placement,
  type PositionResult,
} from './position';

/** Renders children into `document.body` (nothing on the server). */
export function Portal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}

type AnchorRef = HTMLElement | null | RefObject<HTMLElement | null>;

const resolve = (a: AnchorRef): HTMLElement | null => (a && 'current' in a ? a.current : a);

export interface FloatingOptions {
  /** Position only while open. */
  open: boolean;
  /** The element the layer is placed against (an element or a ref to one). */
  anchor: AnchorRef;
  /** Preferred placement (default `bottom`). */
  placement?: Placement;
  /** Gap between anchor and layer in px (default 6). */
  offset?: number;
  /** Give the layer at least the anchor's width (listboxes). */
  matchWidth?: boolean;
}

export interface FloatingResult {
  /** Attach to the floating element (a callback ref, so the layer measures once mounted). */
  floatingRef: (el: HTMLElement | null) => void;
  /** `position: fixed` style to spread on the floating element. */
  style: CSSProperties;
  /** The placement in use after flipping (null before the first measurement). */
  placement: Placement | null;
}

function same(a: PositionResult | null, b: PositionResult): boolean {
  return !!a && a.left === b.left && a.top === b.top && a.placement === b.placement;
}

const CLIPS = /auto|scroll|hidden|clip/;

/** The part of the viewport an element can show in: the viewport less what scrolling ancestors clip. */
function visibleRegion(el: HTMLElement): Box {
  let region: Box = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (!CLIPS.test(s.overflowX) && !CLIPS.test(s.overflowY)) continue;
    const r = p.getBoundingClientRect();
    region = intersect(region, { left: r.left, top: r.top, width: r.width, height: r.height });
  }
  return region;
}

/**
 * Keeps a floating element positioned against its anchor, re-measuring on scroll, resize and size
 * changes of either element. The layer is hidden until its first measurement so it never flashes
 * at the wrong place, and while its anchor is scrolled out of view.
 */
export function useFloatingPosition(opts: FloatingOptions): FloatingResult {
  const { open, anchor, placement, offset, matchWidth } = opts;
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [pos, setPos] = useState<PositionResult | null>(null);
  const [anchorWidth, setAnchorWidth] = useState<number | null>(null);
  const [away, setAway] = useState(false);

  useLayoutEffect(() => {
    const anchorEl = resolve(anchor);
    if (!open || !el || !anchorEl) {
      setPos(null);
      return;
    }
    const update = () => {
      const a = anchorEl.getBoundingClientRect();
      if (matchWidth) setAnchorWidth(a.width);
      // An anchor scrolled out of view takes its layer with it, instead of leaving it clamped to an edge.
      setAway(
        isOutOfView({ left: a.left, top: a.top, width: a.width, height: a.height }, visibleRegion(anchorEl)),
      );
      const next = computePosition({
        anchor: { left: a.left, top: a.top, width: a.width, height: a.height },
        floating: { width: el.offsetWidth, height: el.offsetHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        placement: placement ?? 'bottom',
        offset: offset ?? 6,
      });
      setPos((prev) => (same(prev, next) ? prev : next));
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    ro?.observe(el);
    ro?.observe(anchorEl);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      ro?.disconnect();
    };
  }, [open, el, anchor, placement, offset, matchWidth]);

  const style: CSSProperties = {
    position: 'fixed',
    left: pos?.left ?? 0,
    top: pos?.top ?? 0,
    visibility: pos && !away ? 'visible' : 'hidden',
    ...(matchWidth && anchorWidth !== null ? { minWidth: anchorWidth } : null),
  };
  return { floatingRef: setEl, style, placement: pos?.placement ?? null };
}

export interface DismissOptions {
  /** Listen only while open. */
  open: boolean;
  /** Called on an outside press or Escape. */
  onDismiss: (reason: 'outside' | 'escape') => void;
  /** Presses inside any of these elements do not dismiss (the layer itself and its trigger). */
  inside: ReadonlyArray<RefObject<HTMLElement | null> | HTMLElement | null>;
}

/**
 * Dismisses a layer on a press outside it or on Escape. Escape is handled in the capture phase and
 * swallowed, so the shell's own Escape handling (close the top window) never also fires.
 */
export function useDismiss({ open, onDismiss, inside }: DismissOptions): void {
  const cb = useRef(onDismiss);
  cb.current = onDismiss;
  const insideRef = useRef(inside);
  insideRef.current = inside;
  const onPointer = useCallback((e: PointerEvent) => {
    const target = e.target as Node | null;
    for (const ref of insideRef.current) {
      const node = ref && 'current' in ref ? ref.current : ref;
      if (node && target && node.contains(target)) return;
    }
    cb.current('outside');
  }, []);
  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    e.preventDefault();
    cb.current('escape');
  }, []);
  useEffect(() => {
    if (!open) return;
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, onPointer, onKey]);
}
