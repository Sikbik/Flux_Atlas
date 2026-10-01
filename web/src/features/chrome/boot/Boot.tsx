// The boot's gate (design 6.4 J, 9.1). Which boot to play is decided here, from the URL, the storage and the
// motion setting, before the first paint: the screen is black from the first frame either way. The full
// sequence (the log, the numeral, the symbol's four pieces: FullBoot.tsx) is its own chunk, fetched only when a
// first-visit, return or reduced-motion boot is the one to play. The quick path (a reload in the same tab, a
// driven browser, `?boot=off`) is this file and nothing else: the veil with the lockup, then a 300 ms fade as
// soon as the data and the globe are ready. Esc, any key or a click skips either one.

import { type ComponentType, lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useRuntime } from '../../../app/context';
import { useGlobeHandles } from '../../../globe/context';
import { globeInset } from '../../../shell/wm/machine';
import { useWindowManager } from '../../../shell/wm/react';
import { FluxRound } from '../brand';
import { type BootChoice, chooseBootNow, markBootedNow } from './mode';
import type { BootMode } from './model';
import { bootPhase, finishBoot } from './state';
import './veil.css';

/** A quick path that has seen neither data nor globe by now lets the shell show what is wrong (design 8.8). */
const QUICK_GIVE_UP_MS = 6000;

const reducedNow = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// A chunk that will not load (offline, a stale deploy) plays the quick path instead: the boot never blocks the app.
const FullBoot = lazy<ComponentType<{ choice: BootMode }>>(() =>
  import('./FullBoot').then(
    (m) => ({ default: m.FullBoot }),
    () => ({ default: QuickBoot }),
  ),
);

export function Boot() {
  const [choice] = useState<BootChoice>(() => chooseBootNow(reducedNow()));
  // Mounted after the boot already ended (the ambient screen, a hot reload): there is nothing to show.
  const [over] = useState(() => bootPhase() === 'done');
  if (over) return null;
  if (choice === 'instant') return <QuickBoot />;
  return (
    <Suspense fallback={<div className="boot" data-testid="boot" data-mode="loading" aria-hidden="true" />}>
      <FullBoot choice={choice} />
    </Suspense>
  );
}

/** The quick path: the lockup on black until the data and the globe are ready, then a fade. */
function QuickBoot(_: { choice?: BootMode }) {
  const runtime = useRuntime();
  const handles = useGlobeHandles();
  const wm = useWindowManager();
  const [gone, setGone] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const skipRef = useRef<() => void>(() => {});

  // biome-ignore lint/correctness/useExhaustiveDependencies: set up once per mount; everything it reads is a ref or a store
  useEffect(() => {
    const root = rootRef.current;
    if (!root || bootPhase() === 'done') return;
    const t0 = performance.now();
    let ended = false;
    let raf = 0;
    let timer = 0;
    const end = () => {
      if (ended) return;
      ended = true;
      cancelAnimationFrame(raf);
      markBootedNow();
      root.dataset.done = '';
      finishBoot({ instant: true });
      timer = window.setTimeout(() => setGone(true), 800);
    };
    const tick = () => {
      if (ended) return;
      const ready = runtime.store.loaded && handles.status.get() !== 'loading';
      if (ready || performance.now() - t0 > QUICK_GIVE_UP_MS) end();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    skipRef.current = () => {
      if (ended) return;
      // Jump to the assembled shell: the globe takes the shell's inset at once.
      handles.engine.get()?.setInset(globeInset(wm.getState()), 1);
      end();
    };
    const onKey = (e: KeyboardEvent) => {
      if (['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'CapsLock'].includes(e.key)) return;
      skipRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, []);

  if (gone) return null;
  return (
    <div
      ref={rootRef}
      className="boot"
      data-testid="boot"
      data-mode="instant"
      onPointerDown={() => skipRef.current()}
    >
      <header className="boot-brand">
        <FluxRound size={34} />
        <b className="boot-word">Atlas</b>
      </header>
      <p className="sr-only" role="status">
        Loading Flux Atlas
      </p>
    </div>
  );
}
