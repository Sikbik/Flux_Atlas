// The moon in the phone's header (design 3.6, 7.10.6). While a tall or full sheet covers the moon's orbit it parks as
// a small flat symbol in the header's Beat mini: the ring that already counts the chain's 30 seconds takes the
// moon into its window, so the chain stays on screen and one tap away. The engine does the gliding
// (`GlobeTarget.setMoonPark`, 450 ms there and back); this file decides when, and where.

import { type RefObject, useLayoutEffect } from 'react';
import { useGlobeEngine } from '../../globe';
import type { MoonPark } from '../../globe/target';
import { visibleWindows } from '../wm/machine';
import { sheetHeights } from '../wm/sheet';
import type { WmState } from '../wm/types';

/**
 * The symbol's height, CSS px (design 3.6 says 24). The Beat ring's window is 23 px across; phoneheader.css grows
 * the ring by 14 percent while the moon is in it, which makes the window 26 px, and a 22 px symbol leaves two
 * pixels of the ring's dark all round it. A 24 px symbol would touch the ring's track.
 */
export const PARK_SIZE = 22;

/**
 * Whether the moon is parked: on the phone, with a sheet up (a window or the Live sheet) that is as tall as the
 * tall snap or taller. It goes by height rather than by the snap's name, because a short phone folds tall into
 * half (sheet.ts), and a half sheet that tall covers the orbit just the same.
 */
export function moonParked(s: WmState, liveOpen: boolean): boolean {
  if (s.layout !== 'phone') return false;
  if (!liveOpen && visibleWindows(s).length === 0) return false;
  const heights = sheetHeights(s.viewport.h);
  return heights[s.sheet] >= heights.tall;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where the moon parks for a ring: the ring's centre (to a tenth of a pixel). Null while the ring has no size. */
export function parkAt(ring: Box, size = PARK_SIZE): MoonPark | null {
  if (!(ring.width > 0 && ring.height > 0)) return null;
  const tenth = (n: number) => Math.round(n * 10) / 10;
  return { x: tenth(ring.left + ring.width / 2), y: tenth(ring.top + ring.height / 2), size };
}

/**
 * Parks the moon in the header's Beat ring while `parked`, and sends it back to its orbit when that ends or the
 * header goes. The ring's place is read again when the header or the live chips change size (a longer connection
 * state moves the Beat), on a window resize and once the fonts are in. The place also goes to the header as
 * `--moon-x` and `--moon-y`, where the scrim opens its window for the moon (phoneheader.css).
 */
export function useMoonPark(header: RefObject<HTMLElement | null>, parked: boolean): void {
  const engine = useGlobeEngine();
  useLayoutEffect(() => {
    const el = header.current;
    if (!engine || !el || !parked) return;
    const apply = () => {
      const ring = el.querySelector('.beat-ring');
      const at = ring ? parkAt(ring.getBoundingClientRect()) : null;
      if (!at) return;
      el.style.setProperty('--moon-x', `${at.x}px`);
      el.style.setProperty('--moon-y', `${at.y}px`);
      engine.setMoonPark(at);
    };
    apply();
    let live = true;
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply);
    ro?.observe(el);
    const group = el.querySelector('.ph-live');
    if (group) ro?.observe(group);
    window.addEventListener('resize', apply);
    void document.fonts?.ready.then(() => {
      if (live) apply();
    });
    return () => {
      live = false;
      ro?.disconnect();
      window.removeEventListener('resize', apply);
      engine.setMoonPark(null);
      // `--moon-x` and `--moon-y` stay: the scrim's window closes around them while the moon leaves.
    };
  }, [engine, header, parked]);
}
