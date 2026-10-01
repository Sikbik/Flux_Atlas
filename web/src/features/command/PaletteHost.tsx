// The palette's host: eager, tiny, and the only part of the palette in the shell chunk. It watches the
// URL (the palette is open while `?q=` is present), keeps the palette mounted while it animates out,
// shows a stand-in panel (with a live input) until the lazy chunk arrives, and decides how closing
// moves history: if opening pushed an entry that is still the current one, close goes back, so Back
// and Forward walk the user's real story and a palette round trip leaves no trace.

import { useRouter, useRouterState } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { effectiveMotion, useUi } from '../../store/ui';
import { registerPaletteCloser, takeOpenVia } from './paletteBridge';
import { closePalette, paletteTextFromSearch } from './paletteUrl';

const loadPalette = () => import('./palette/Palette');
const LazyPalette = lazy(loadPalette);

/** Fetches the palette chunk (called when the browser is idle, so the first open is instant). */
export function preloadPalette(): void {
  void loadPalette();
}

type Phase = 'closed' | 'open' | 'closing';

/** Matches `--dur-fast` (the panel's exit). */
const EXIT_MS = 150;

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
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    via.current = takeOpenVia();
    seed.current = '';
  }
  if (urlText !== null) lastText.current = urlText;

  useEffect(() => {
    if (!open) prevIndex.current = histIndex;
  }, [open, histIndex]);

  const close = useCallback(() => {
    closePalette(router, pushedAt.current);
    const el = returnFocus.current;
    // Give focus back to what had it, unless something else took it in the meantime.
    window.setTimeout(() => {
      const a = document.activeElement;
      if (el?.isConnected && (!a || a === document.body || (a as HTMLElement).closest?.('.pal-layer')))
        el.focus({ preventScroll: true });
    }, EXIT_MS + 40);
  }, [router]);

  useEffect(() => {
    registerPaletteCloser(close);
    return () => registerPaletteCloser(null);
  }, [close]);

  useEffect(() => {
    if (!open && phase === 'open') setPhase('closing');
  }, [open, phase]);

  useEffect(() => {
    if (phase !== 'closing') return;
    const animated = effectiveMotion(useUi.getState().motion) === 'full';
    const t = window.setTimeout(() => setPhase('closed'), animated ? EXIT_MS : 0);
    return () => window.clearTimeout(t);
  }, [phase]);

  if (phase === 'closed') return null;
  return (
    <div className="pal-layer" data-phase={phase}>
      <div className="pal-scrim" onPointerDown={close} aria-hidden="true" />
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
          seed={seed.current || lastText.current}
          close={close}
          via={via.current}
        />
      </Suspense>
    </div>
  );
}
