// A hub section can be linked to by name (`/nodes#operators`, the palette's "Top node operators"). Once the section
// has rendered, the window scrolls to it; with motion reduced or off it jumps instead of gliding.

import { useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useMotionMode } from '../../ui';

/** Scrolls to the element named by the URL fragment when `ready` turns true (once per fragment). */
export function useHashAnchor(ready: boolean): void {
  const hash = useRouterState({ select: (s) => s.location.hash });
  const mode = useMotionMode();
  useEffect(() => {
    const id = hash.replace(/^#/, '');
    if (!ready || !id) return;
    const raf = requestAnimationFrame(() => {
      document
        .getElementById(id)
        ?.scrollIntoView({ block: 'start', behavior: mode === 'full' ? 'smooth' : 'auto' });
    });
    return () => cancelAnimationFrame(raf);
  }, [hash, ready, mode]);
}
