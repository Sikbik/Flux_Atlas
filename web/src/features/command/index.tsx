// Command surfaces that float over the whole shell (F2b): the palette (open while the URL carries `?q=`),
// the idle timer that enters ambient mode, document-level preference attributes and achievement
// tracking. The frame mounts this once. It stays small on purpose: the palette, the terminal, the
// results page and everything else heavy are lazy chunks; only the hotkeys, the watch timers and a
// few lines of CSS ship with the shell.

import { useRouter, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useRuntime } from '../../app/context';
import { useGlobeHandles } from '../../globe';
import { useUi } from '../../store/ui';
import { track } from '../achievements/events';
import { asAmbientEngine } from '../ambient/engineAccess';
import { enterAmbient } from '../ambient/enter';
import { startIdleWatch } from '../ambient/idle';
import { syncLayerAttribute, syncPerfAttribute } from './documentAttributes';
import { bare, hasMod, isTypingTarget } from './keys';
import { PaletteHost, preloadPalette } from './PaletteHost';
import { closePaletteViaHost, markOpenedByKey } from './paletteBridge';
import { openPalette, paletteTextFromSearch } from './paletteUrl';
import './layer.css';

syncPerfAttribute();

type IdleCallback = (cb: () => void, opts?: { timeout: number }) => number;
const whenIdle = (cb: () => void, timeout = 3000): void => {
  const ric = (window as unknown as { requestIdleCallback?: IdleCallback }).requestIdleCallback;
  if (ric) ric(cb, { timeout });
  else window.setTimeout(cb, 1200);
};

export function CommandLayer() {
  const router = useRouter();
  const runtime = useRuntime();
  const handles = useGlobeHandles();
  const labels = useRouterState({ select: (s) => (s.location.search as Record<string, unknown>).l });

  useEffect(() => useUi.subscribe(syncPerfAttribute), []);
  useEffect(() => syncLayerAttribute(labels), [labels]);

  // The idle watch (ambient entry) runs while the shell is mounted.
  useEffect(() => startIdleWatch(router), [router]);

  // Hotkeys: the palette (Cmd or Ctrl and K, or `/`), ambient mode (Shift and A) and the egg ("stache").
  useEffect(() => {
    let typed = '';
    const paletteOpen = () => paletteTextFromSearch(router.state.location.searchStr ?? '') !== null;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const k = e.key;
      if (hasMod(e) && !e.altKey && !e.shiftKey && k.toLowerCase() === 'k') {
        e.preventDefault();
        if (paletteOpen()) {
          if (!closePaletteViaHost()) router.history.back();
        } else {
          markOpenedByKey();
          openPalette(router, '');
        }
        return;
      }
      if (isTypingTarget(e.target) || paletteOpen()) return;
      if (k === '/' && bare(e)) {
        e.preventDefault();
        markOpenedByKey();
        openPalette(router, '');
        return;
      }
      if (e.code === 'KeyA' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        enterAmbient(router, 'manual');
        return;
      }
      // Typing "stache" anywhere on the globe is a small greeting.
      if (bare(e, true) && k.length === 1) {
        typed = (typed + k.toLowerCase()).slice(-6);
        if (typed === 'stache') {
          typed = '';
          const engine = asAmbientEngine(handles.engine.get());
          if (engine) {
            engine.ambient.egg();
            track({ type: 'egg' });
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, handles]);

  // After the first paint settles: the palette chunk (so the first open is instant) and the tracker.
  useEffect(() => {
    let cancelled = false;
    whenIdle(() => {
      if (cancelled) return;
      preloadPalette();
      void import('../achievements/tracker').then((m) => {
        if (!cancelled) m.startTracker({ runtime, router, engine: handles.engine });
      });
    });
    return () => {
      cancelled = true;
    };
  }, [runtime, router, handles]);

  return <PaletteHost />;
}
