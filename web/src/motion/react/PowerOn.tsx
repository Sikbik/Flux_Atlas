// <PowerOn open>: a window or panel that opens and closes. It mounts its children when `open`
// turns true, plays the entrance, and on `open` false plays the (faster) exit and unmounts. In `off`
// mode both are instant. The wrapper is a plain element with no clip, shadow or mask of its own, so
// the circle reveal is safe; put the chamfered, shadowed frame inside it.

import { type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { installEngine, powerOff, powerOn } from '../engine';
import type { Origin } from '../fxRunners';
import '../motion.css';

export interface PowerOnProps {
  open: boolean;
  /** Where it comes from: client coordinates, an element or a rect (its centre). Read when it opens or closes. */
  origin?: Origin | (() => Origin);
  variant?: 'window' | 'panel';
  aperture?: 'auto' | boolean;
  /** Called after the exit animation, when the children have been unmounted. */
  onExited?: () => void;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export function PowerOn({
  open,
  origin,
  variant,
  aperture,
  onExited,
  className,
  style,
  children,
}: PowerOnProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(open);
  const latest = useRef({ origin, variant, aperture, onExited });
  latest.current = { origin, variant, aperture, onExited };
  if (open && !mounted) setMounted(true);

  useLayoutEffect(() => {
    const release = installEngine();
    const el = ref.current;
    const { origin: o, variant: v, aperture: a, onExited: done } = latest.current;
    const from = typeof o === 'function' ? o() : o;
    let off: (() => void) | undefined;
    if (el && open) {
      const h = powerOn(el, { origin: from, variant: v, aperture: a });
      off = () => h?.cancel();
    } else if (el) {
      let live = true;
      const h = powerOff(el, { origin: from, variant: v, aperture: a });
      void h.done.then(() => {
        if (!live) return;
        setMounted(false);
        done?.();
      });
      off = () => {
        live = false;
        h.cancel();
      };
    }
    return () => {
      off?.();
      release();
    };
  }, [open]);

  if (!mounted) return null;
  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}
