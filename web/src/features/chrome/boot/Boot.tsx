// The boot's gate (design 6.4 J, 9.1). Which boot to play is decided here, from the URL, the storage and the
// motion setting, before the first paint: the screen is black from the first frame either way. The full
// sequence (the log, the numeral, the symbol's four pieces: FullBoot.tsx) is its own chunk, fetched only when a
// first-visit, return or reduced-motion boot is the one to play. The quick path (a reload in the same tab, a
// driven browser, `?boot=off`) is this file and nothing else: the veil with the lockup, then a 300 ms fade as
// soon as the data and the globe are ready; if Atlas does not answer it says so, with a retry (`quickStep`).
// Esc, any key or a click skips either one.

import { type ComponentType, lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useNetwork, useRuntime } from '../../../app/context';
import { useGlobeHandles } from '../../../globe/context';
import { globeInset } from '../../../shell/wm/machine';
import { useWindowManager } from '../../../shell/wm/react';
import { FluxRound } from '../brand';
import { BootFail } from './BootFail';
import { type BootChoice, chooseBootNow, markBootedNow } from './mode';
import { type BootMode, quickStep, type StageId } from './model';
import { bootPhase, finishBoot } from './state';
import './veil.css';

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

/**
 * The quick path: the lockup on black until the data and the globe are ready, then a fade. With no answer from Atlas
 * it says so after a few seconds (the same offline state as the full boot), and lifts by itself once the data comes.
 */
function QuickBoot(_: { choice?: BootMode }) {
  const runtime = useRuntime();
  const handles = useGlobeHandles();
  const wm = useWindowManager();
  const [gone, setGone] = useState(false);
  const [failed, setFailed] = useState<StageId | null>(null);
  const hasSnapshot = useNetwork((s) => s.loaded);
  const rootRef = useRef<HTMLDivElement>(null);
  const skipRef = useRef<() => void>(() => {});
  const retryRef = useRef<() => void>(() => {});

  // biome-ignore lint/correctness/useExhaustiveDependencies: set up once per mount; everything it reads is a ref or a store
  useEffect(() => {
    const root = rootRef.current;
    if (!root || bootPhase() === 'done') return;
    const t0 = performance.now();
    let ended = false;
    let raf = 0;
    let timer = 0;
    let retriedAt: number | null = null;
    let shown: StageId | null = null;
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
      const status: string = runtime.store.connection.status;
      const step = quickStep({
        nowMs: performance.now(),
        startMs: t0,
        loaded: runtime.store.loaded,
        globeLoading: handles.status.get() === 'loading',
        live: status === 'live',
        status,
        retriedAtMs: retriedAt,
      });
      if (step.kind === 'end') {
        end();
        return;
      }
      if (step.failed !== shown) {
        shown = step.failed;
        setFailed(step.failed);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    retryRef.current = () => {
      retriedAt = performance.now();
      shown = null;
      setFailed(null);
      runtime.live.reconnectNow();
    };
    skipRef.current = () => {
      if (ended) return;
      // Jump to the assembled shell: the globe takes the shell's inset at once.
      handles.engine.get()?.setInset(globeInset(wm.getState()), 1);
      end();
    };
    const onKey = (e: KeyboardEvent) => {
      if (['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'CapsLock'].includes(e.key)) return;
      // Enter and Space on the offline state's buttons press them; they are not a skip.
      if ((e.target as HTMLElement | null)?.closest?.('.boot-fail')) return;
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
      onPointerDown={(e) => {
        if (!(e.target as HTMLElement).closest('.boot-fail')) skipRef.current();
      }}
    >
      <header className="boot-brand">
        <FluxRound size={34} />
        <b className="boot-word">Atlas</b>
      </header>
      {failed ? (
        <BootFail
          failed={failed}
          hasSnapshot={hasSnapshot}
          onRetry={() => retryRef.current()}
          onContinue={() => skipRef.current()}
        />
      ) : null}
      <p className="sr-only" role="status">
        Loading Flux Atlas
      </p>
    </div>
  );
}
