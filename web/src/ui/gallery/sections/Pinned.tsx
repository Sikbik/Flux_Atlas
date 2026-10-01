// Gallery-only: a stage that holds an overlay open while it is on screen. Overlays are fixed to the
// viewport, so a specimen that pins one open must close it when the gallery scrolls past, or it would
// be left stuck to the edge of the window.

import { type ReactNode, useEffect, useRef, useState } from 'react';

export interface PinnedProps {
  /** Room kept under the trigger for the open overlay, in px. */
  height?: number;
  /** Renders the specimen; `open` is true while the stage is mostly on screen. */
  children: (open: boolean) => ReactNode;
}

/** A stage that tells its content when it is on screen. */
export function Pinned({ height = 320, children }: PinnedProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setVisible(!!entry?.isIntersecting), {
      threshold: 0.6,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className="kgc-pin" style={{ minHeight: height }}>
      {children(visible)}
    </div>
  );
}
