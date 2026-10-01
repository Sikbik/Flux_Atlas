// The palette's host: eager, tiny, and the only part of the palette in the shell chunk. It watches the
// URL (the palette is open while `?q=` is present), keeps the palette mounted while it animates out,
// shows a stand-in panel (with a live input) until the lazy chunk arrives, and decides how closing
// moves history: if opening pushed an entry that is still the current one, close goes back, so Back
// and Forward walk the user's real story and a palette round trip leaves no trace.
//
// The panel opens and closes with the motion language's Power-on (panel variant): the slot below is the
// element it scales, fades and runs its light along, and it calls back when the exit has played.

import { useRouter, useRouterState } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { PowerOn } from '../../motion/react/PowerOn';
import { registerPaletteCloser, takeOpenVia } from './paletteBridge';
import { closePalette, paletteTextFromSearch } from './paletteUrl';
import { drainTypeAhead } from './typeAhead';

const loadPalette = () => import('./palette/Palette');
const LazyPalette = lazy(loadPalette);

/** Fetches the palette chunk (called when the browser is idle, so the first open is instant). */
export function preloadPalette(): void {
  void loadPalette();
}

type Phase = 'closed' | 'open' | 'closing';

/**
 * Where the panel comes from and goes back to: the middle of its own top edge, so the edge the light runs
 * along stays put while the rest scales. Read when it opens and when it closes.
 */
function slotOrigin(): { x: number; y: number } | undefined {
  const r = document.querySelector('.pal-slot')?.getBoundingClientRect();
  return r ? { x: r.left + r.width / 2, y: r.top } : undefined;
}

const historyIndexOf = (state: unknown): number | null => {
  const i = (state as { __TSR_index?: unknown } | null | undefined)?.__TSR_index;
  return typeof i === 'number' ? i : null;
};

export function PaletteHost() {
  const router = useRouter();
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  const histIndex = useRouterState({ select: (s) => historyIndexOf(s.location.state) });
  const urlText = paletteTextFromSearch(searchStr);
  const open = urlText !== null;

  const [phase, setPhase] = useState<Phase>(open ? 'open' : 'closed');
  const pushedAt = useRef<number | null>(null);
  const prevIndex = useRef<number | null>(histIndex);
  const returnFocus = useRef<HTMLElement | null>(null);
  const via = useRef<'key' | 'url'>('url');
  const seed = useRef('');
  const lastText = useRef(urlText ?? '');

  // Opening: note whether the palette pushed its own history entry, and where focus came from.
  if (open && phase !== 'open') {
    setPhase('open');
    pushedAt.current =
      prevIndex.current !== null && histIndex !== null && histIndex === prevIndex.current + 1
        ? histIndex
        : null;
    // Reopened while the last close was still playing: focus is inside the palette, keep what it came from.
    const from = document.activeElement;
    if (!(from instanceof HTMLElement && from.closest('.pal-layer'))) {
      returnFocus.current = from instanceof HTMLElement ? from : null;
    }
    via.current = takeOpenVia();
    seed.current = '';
  }
  if (urlText !== null) lastText.current = urlText;

  useEffect(() => {
    if (!open) prevIndex.current = histIndex;
  }, [open, histIndex]);

  const close = useCallback(() => {
    closePalette(router, pushedAt.current);
  }, [router]);

  // The exit has played (at once when motion is off): unmount, and give focus back to what had it, unless
  // something else took it in the meantime.
  const exited = useCallback(() => {
    setPhase('closed');
    const el = returnFocus.current;
    const a = document.activeElement;
    if (el?.isConnected && (!a || a === document.body || (a as HTMLElement).closest?.('.pal-layer')))
      el.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    registerPaletteCloser(close);
    return () => registerPaletteCloser(null);
  }, [close]);

  useEffect(() => {
    if (!open && phase === 'open') setPhase('closing');
  }, [open, phase]);

  if (phase === 'closed') return null;
  return (
    <div className="pal-layer" data-phase={phase}>
      <div className="pal-scrim" onPointerDown={close} aria-hidden="true" />
      <PowerOn
        open={phase === 'open'}
        variant="panel"
        origin={slotOrigin}
        onExited={exited}
        className="pal-slot"
      >
        <Suspense
          fallback={
            <div className="pal-stand" role="dialog" aria-modal="true" aria-label="Search and commands">
              <div className="pal-stand-in">
                <Search size={20} strokeWidth={1.9} aria-hidden="true" />
                <input
                  // biome-ignore lint/a11y/noAutofocus: the palette exists to be typed into
                  autoFocus
                  type="text"
                  aria-label="Search or run a command"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  placeholder="Search nodes, apps, blocks, addresses, or type a command"
                  defaultValue={urlText ?? ''}
                  ref={(el) => {
                    // Keys typed between the shortcut and this field are its first characters.
                    if (!el) return;
                    const early = drainTypeAhead();
                    if (early) {
                      el.value += early;
                      seed.current = el.value;
                    }
                  }}
                  onChange={(e) => {
                    seed.current = e.target.value;
                  }}
                />
              </div>
              <div className="pal-stand-body" />
            </div>
          }
        >
          <LazyPalette
            phase={phase === 'closing' ? 'closing' : 'open'}
            urlText={urlText}
            seed={() => seed.current || lastText.current}
            close={close}
            via={via.current}
          />
        </Suspense>
      </PowerOn>
    </div>
  );
}
