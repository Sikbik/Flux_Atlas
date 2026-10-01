// The one floating surface behind Popover, Menu and Select: a glass layer in a portal, placed against
// an anchor, dismissed by Escape or a press outside, with an enter and exit animation. Layers nest
// (a Select inside a Popover): presses inside a nested layer do not dismiss its parent, and Escape
// dismisses only the top-most layer.

import {
  type ComponentPropsWithoutRef,
  type CSSProperties,
  createContext,
  type ReactNode,
  type Ref,
  type RefObject,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cx } from '../internal/cx';
import { Portal, useDismiss, useFloatingPosition } from '../internal/floating';
import { type Placement, parsePlacement } from '../internal/position';
import { useMotionMode } from '../internal/useMotion';
import './Layer.css';
import { mergeRefs } from './refs';
import { usePresence } from './usePresence';

/** Why a layer asks to close: a press outside it, or Escape. */
export type DismissReason = 'outside' | 'escape';

export interface AnchoredLayerProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children' | 'style'> {
  /** Shown while true; the layer stays drawn briefly after it turns false so its exit can play. */
  open: boolean;
  /** The element the layer is placed against (usually the trigger). */
  anchor: RefObject<HTMLElement | null>;
  /** Called on a press outside (and not on the anchor) or on Escape (when this is the top-most layer). */
  onDismiss: (reason: DismissReason) => void;
  /** Preferred placement (default `bottom`); flips and clamps to stay on screen. */
  placement?: Placement;
  /** Gap between anchor and layer in px (default 6). */
  offset?: number;
  /** Give the layer at least the anchor's width (listboxes). */
  matchWidth?: boolean;
  /** Called once per opening, when the layer is measured, placed and visible: move focus here. */
  onPlaced?: (layer: HTMLDivElement) => void;
  /** A ref to the layer element. */
  layerRef?: Ref<HTMLDivElement>;
  /** Fixed width (px number or CSS length). */
  width?: number | string;
  style?: CSSProperties;
  children: ReactNode;
}

/** How long the exit animation keeps a closed layer drawn (a little under `--dur-fast`). */
const EXIT_MS = 100;

interface NestingApi {
  register: (el: HTMLElement) => () => void;
}

const NestingContext = createContext<NestingApi | null>(null);

/**
 * Whether `el` is the layer Escape belongs to: among the open layers that have no open layer nested
 * inside them (a parent defers to its child), the one latest in the document, which is the one that
 * opened last.
 */
function isTopmost(el: HTMLElement | null): boolean {
  const leaves = document.querySelectorAll('.ui-layer:not([data-state="closed"]):not([data-nested])');
  return !!el && leaves[leaves.length - 1] === el;
}

/** A layer anchored to an element; see the module comment. Renders nothing while closed. */
export function AnchoredLayer({
  open,
  anchor,
  onDismiss,
  placement = 'bottom',
  offset = 6,
  matchWidth,
  onPlaced,
  layerRef,
  width,
  style,
  className,
  children,
  ...rest
}: AnchoredLayerProps) {
  const motion = useMotionMode();
  const { mounted, closing } = usePresence(open, motion === 'off' ? 0 : EXIT_MS);
  const elRef = useRef<HTMLDivElement | null>(null);
  const floating = useFloatingPosition({ open: mounted, anchor, placement, offset, matchWidth });

  // Layers rendered inside this one (in the React tree) register their element, so a press inside
  // them does not count as outside this layer.
  const parent = useContext(NestingContext);
  const [nested, setNested] = useState<readonly HTMLElement[]>([]);
  const api = useMemo<NestingApi>(
    () => ({
      register: (el) => {
        setNested((prev) => [...prev, el]);
        return () => setNested((prev) => prev.filter((x) => x !== el));
      },
    }),
    [],
  );
  useEffect(() => {
    const el = elRef.current;
    if (!mounted || !el || !parent) return;
    return parent.register(el);
  }, [mounted, parent]);

  useDismiss({
    open,
    onDismiss: (reason) => {
      if (reason === 'escape' && !isTopmost(elRef.current)) return;
      onDismiss(reason);
    },
    inside: [elRef, anchor, ...nested],
  });

  const placedRef = useRef(false);
  const placement_ = floating.placement;
  useEffect(() => {
    if (!mounted || closing) {
      placedRef.current = false;
      return;
    }
    if (placement_ && !placedRef.current && elRef.current) {
      placedRef.current = true;
      onPlaced?.(elRef.current);
    }
  }, [mounted, closing, placement_, onPlaced]);

  const setEl = useMemo(
    () => mergeRefs<HTMLDivElement>(elRef, floating.floatingRef, layerRef),
    [floating.floatingRef, layerRef],
  );

  if (!mounted) return null;
  const side = parsePlacement(placement_ ?? placement).side;
  return (
    <Portal>
      <NestingContext.Provider value={api}>
        <div
          {...rest}
          ref={setEl}
          className={cx('ui-layer', className)}
          data-side={side}
          data-state={closing ? 'closed' : 'open'}
          data-nested={nested.length > 0 || undefined}
          aria-hidden={closing || undefined}
          style={{
            ...floating.style,
            ...(matchWidth && typeof floating.style.minWidth === 'number'
              ? ({ '--ui-anchor-w': `${floating.style.minWidth}px` } as CSSProperties)
              : null),
            ...(width !== undefined ? { width } : null),
            ...style,
          }}
        >
          {children}
        </div>
      </NestingContext.Provider>
    </Portal>
  );
}
