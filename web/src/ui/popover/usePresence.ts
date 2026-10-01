import { useEffect, useState } from 'react';

export interface Presence {
  /** Render the layer: true from the moment it opens until its exit has played. */
  mounted: boolean;
  /** The layer is leaving: keep it drawn (and inert) while the exit animation runs. */
  closing: boolean;
}

/**
 * Keeps a layer mounted for `exitMs` after `open` turns false, so its exit animation can play.
 * `exitMs` of 0 unmounts at once. Opening again during the exit cancels it.
 */
export function usePresence(open: boolean, exitMs: number): Presence {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open || !mounted) return;
    if (exitMs <= 0) {
      setMounted(false);
      return;
    }
    const timer = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(timer);
  }, [open, mounted, exitMs]);

  return { mounted: mounted || open, closing: mounted && !open };
}
