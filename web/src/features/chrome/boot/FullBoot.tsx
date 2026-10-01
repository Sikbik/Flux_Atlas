// The full boot (design 6.4 J, 9.1): the screen a first visit, a return visit and a reduced-motion visit open
// on. Black with a faint hexagon lattice; the log lines are the real stages and their numbers are the real
// numbers; the four pieces of the Flux symbol are drawn by the globe's own renderer and arrive as their data
// does (`setMoonBoot`), the symbol is whole when the nodes are in, holds and breathes until the stream opens,
// then lifts off and becomes the moon while the globe settles into the shell's free area. Esc, any key or a
// click skips; reduced motion cross-fades; a refused connection or a stream that will not open says so and
// offers Retry and "Continue with the last snapshot". This module is its own chunk: the gate (Boot.tsx)
// fetches it only when this boot is the one to play, and the quick path never pays for it.
//
// Everything that changes every frame is written straight to the DOM (no React state): the numeral, the bar,
// the log, the counters. React renders the structure once, plus the failure panel and the screen-reader line.

import { useEffect, useRef, useState } from 'react';
import { useNetwork, useRuntime } from '../../../app/context';
import { toEngineId } from '../../../globe/bindings';
import { useGlobeHandles } from '../../../globe/context';
import { HOME, homeView } from '../../../globe/engine/moon/orbit';
import { formatHeight, formatInt } from '../../../lib/format';
import { globeInset } from '../../../shell/wm/machine';
import { useWindowManager } from '../../../shell/wm/react';
import { TierGlyph } from '../../../ui';
import { FluxMarkWhite, FluxRound } from '../brand';
import { announce, type BootFacts, lineValue } from './lines';
import { markBootedNow } from './mode';
import {
  type BootFrame,
  type BootMode,
  BootTimeline,
  bootScale,
  driftShare,
  LIFT_MS,
  SETTLE_MS,
  STAGES,
  type StageId,
  type StageView,
  settleFlight,
} from './model';
import { BootSignalCollector, type Marks, readMarks } from './signals';
import { bootPhase, finishBoot } from './state';
import './boot.css';

/**
 * The globe while the symbol assembles (design 6.4 J): the planet is hidden behind the reveal's aperture
 * until the wave rolls over it, and drifts in from 0.84 to 0.94 of the size it ends at (model.ts, `driftShare`);
 * it settles from 0.94 to 1 over `SETTLE_MS` as the chrome assembles. The wave's front never jumps: it grows at
 * most `WAVE_MAX_RATE` fast (radians per second).
 */
const WAVE_MAX_RATE = 1.6;

const TIERS = ['cumulus', 'nimbus', 'stratus'] as const;

/** Where the globe sits while the symbol assembles: right of the log, then it eases to the shell's free area. */
const startInset = (phone: boolean) =>
  phone ? { left: 0, right: 0, top: 60, bottom: 300 } : { left: 420, right: 0, top: 20, bottom: 60 };

const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export function FullBoot({ choice }: { choice: BootMode }) {
  const runtime = useRuntime();
  const handles = useGlobeHandles();
  const wm = useWindowManager();
  const [gone, setGone] = useState(() => bootPhase() === 'done');
  const [failed, setFailed] = useState<StageId | null>(null);
  const [said, setSaid] = useState('Loading Flux Atlas');
  const hasSnapshot = useNetwork((s) => s.loaded);
  const rootRef = useRef<HTMLDivElement>(null);
  const actions = useRef<{ retry: () => void; skip: () => void }>({ retry: () => {}, skip: () => {} });

  // biome-ignore lint/correctness/useExhaustiveDependencies: the boot is set up once per mount; everything it reads is a ref or a store
  useEffect(() => {
    const root = rootRef.current;
    if (!root || bootPhase() === 'done') return;
    const phone = window.innerWidth < 720;
    const t0 = performance.now();
    const timeline = new BootTimeline(choice, t0);
    const collector = new BootSignalCollector(t0);
    const engine = () => handles.engine.get();
    const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel);
    const v = {
      pct: q('.boot-pct b'),
      bar: q('.boot-line i'),
      cap: q('.boot-cap'),
      tip: q('.boot-tip'),
      tipH: q('.boot-tip b'),
      next: q('.boot-tip i'),
      ring: q('.boot-ring'),
      lines: [...root.querySelectorAll<HTMLElement>('.boot-log li')],
      tiers: [...root.querySelectorAll<HTMLElement>('.boot-tiers .tc')],
      fallback: q('.boot-fallback'),
    };
    const lastText = new WeakMap<Element, string>();
    const setText = (el: Element | null, text: string) => {
      if (!el || lastText.get(el) === text) return;
      lastText.set(el, text);
      el.textContent = text;
    };

    let engineOn = false;
    let lifted = false;
    /** The camera was turned to face the newest producer, so it has to be sent home at the end. */
    let turned = false;
    let ended = false;
    let skipped = false;
    let raf = 0;
    let marks: Marks = {};
    let marksTries = 0;
    let lastFailed: StageId | null = null;
    let lastRunning: StageId | null = null;
    let ringed = false;
    const reduced = choice === 'reduced';
    const size = phone ? 150 : 250;
    const start = startInset(phone);
    const cx = start.left + (window.innerWidth - start.left - start.right) / 2;
    const cy = phone
      ? window.innerHeight * 0.36
      : start.top + (window.innerHeight - start.top - start.bottom) / 2;
    root.style.setProperty('--boot-cx', `${cx}px`);
    root.style.setProperty('--boot-cy', `${cy}px`);
    root.style.setProperty('--boot-size', `${size}px`);

    const end = (why: 'done' | 'skip') => {
      if (ended) return;
      ended = true;
      const e = engine();
      e?.setMoonBoot(null);
      e?.setReveal(null);
      // The globe settles from its boot scale while the chrome assembles; a skip lands at once.
      e?.setViewScale(1, why === 'skip' || reduced ? 0 : SETTLE_MS);
      // And the camera goes home over the same time, with no zoom-out (settleFlight): the shell's orbit is fitted to it.
      const home = e ? settleFlight(turned, why === 'skip') : null;
      if (e && home) void e.flyTo(HOME.lat, HOME.lon, e.homeRange, home);
      markBootedNow();
      root.dataset.done = '';
      cancelAnimationFrame(raf);
      finishBoot({ instant: why === 'skip' });
      window.setTimeout(() => setGone(true), 800);
    };
    const skip = () => {
      if (ended || skipped) return;
      skipped = true;
      // Jump to the assembled shell: the globe takes the shell's inset at once.
      engine()?.setInset(globeInset(wm.getState()), 1);
      end('skip');
    };
    actions.current = {
      skip,
      retry: () => {
        collector.retry(performance.now());
        runtime.live.reconnectNow();
        setFailed(null);
      },
    };

    const facts = (): BootFacts => {
      const s = runtime.store;
      const sum = s.summary;
      const beat = runtime.clock.beat();
      return {
        ttfbMs: marks.ttfbMs ?? null,
        tipHeight: s.tip?.height ?? null,
        nodes: sum ? sum.node_count : null,
        hosts: sum ? sum.host_count : null,
        countries: sum ? sum.country_count : null,
        apps: sum ? sum.app_count : null,
        instances: sum ? sum.instance_count : null,
        utcHM: new Date(runtime.clock.now()).toISOString().slice(11, 16),
        nextS: beat.height === null ? null : Math.max(0, Math.ceil(beat.remainingMs / 1000)),
      };
    };

    /** The node the reveal wave starts from: the newest block's producer, else any node there is. */
    const originOf = (): number | null => {
      const s = runtime.store;
      const prod = s.blocks.toArray()[0]?.producer;
      if (typeof prod === 'number' && s.nodes.indexOf(prod) >= 0) return toEngineId(prod);
      return s.nodes.count > 0 ? toEngineId(s.nodes.ids[0] ?? 0) : null;
    };
    let origin: number | null = null;
    /** The wave's front as drawn (it follows the model's, never faster than WAVE_MAX_RATE). */
    let wave = 0;
    let waveAt = performance.now();
    /** The planet's radius at the home zoom in the shell's free area (CSS px), kept while nothing it depends on moves. */
    let shell: { state: unknown; w: number; h: number; r: number } | null = null;
    const shellRadius = (): number => {
      const state = wm.getState();
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (!shell || shell.state !== state || shell.w !== w || shell.h !== h)
        shell = { state, w, h, r: homeView(w, h, globeInset(state)).planetR };
      return shell.r;
    };

    const paint = (f: BootFrame, fx: BootFacts) => {
      setText(v.pct, String(f.percent));
      if (v.bar) v.bar.style.transform = `scaleX(${f.progress.toFixed(4)})`;
      setText(v.cap, f.percent >= 100 ? 'Ready' : f.running ? f.running.label : 'Starting');
      for (let i = 0; i < STAGES.length; i++) {
        const st: StageView | undefined = f.stages[i];
        const li = v.lines[i];
        if (!st || !li) continue;
        if (li.dataset.state !== st.state) li.dataset.state = st.state;
        setText(li.querySelector('.v'), lineValue(st.id, st.state, st.u, fx));
      }
      const counts = [
        runtime.store.summary?.tiers.cumulus,
        runtime.store.summary?.tiers.nimbus,
        runtime.store.summary?.tiers.stratus,
      ];
      for (let k = 0; k < 3; k++) {
        const chip = v.tiers[k];
        const n = counts[k];
        if (!chip) continue;
        const u = f.tiers[k] ?? 0;
        setText(chip.querySelector('b'), n === undefined ? '0' : formatInt(Math.round(n * u)));
        const on = u >= 1 ? '' : undefined;
        if (on === '' && chip.dataset.on === undefined) chip.dataset.on = '';
      }
      if (fx.tipHeight !== null) {
        setText(v.tipH, formatHeight(fx.tipHeight));
        if (v.tip && v.tip.dataset.known === undefined) v.tip.dataset.known = '';
      }
      setText(v.next, fx.nextS === null ? '' : String(fx.nextS));
      if (root.dataset.phase !== f.phase) root.dataset.phase = f.phase;
      const late = f.lift > 0.15;
      if (root.classList.contains('is-late') !== late) root.classList.toggle('is-late', late);
      if (f.white > 0 && !ringed && v.ring) {
        ringed = true;
        v.ring.classList.add('go');
      }
      if (f.running?.id !== lastRunning) {
        lastRunning = f.running?.id ?? null;
        setSaid(announce(f.running, f.percent));
      }
      if (f.failed !== lastFailed) {
        lastFailed = f.failed;
        setFailed(f.failed);
      }
    };

    const drive = (f: BootFrame) => {
      const e = engine();
      if (!e) return;
      if (!engineOn) {
        // From the first frame the engine has: the globe sits right of the log, hidden (the void), a little
        // smaller, and the symbol assembles in its canvas.
        e.setInset(start, 1);
        e.setViewScale(reduced ? 1 : driftShare(0), 0);
        engineOn = true;
        root.dataset.engine = 'on';
      }
      if (origin === null && collector.done.nodes !== undefined) {
        origin = originOf();
        // The wave starts at the newest producer: turn the dark planet to face it before it lights.
        const at = origin === null ? null : e.nodeInfo(origin);
        if (at && Number.isFinite(at.lat) && !reduced) {
          turned = true;
          void e.flyTo(at.lat, at.lon, e.homeRange, { duration: 0.6 });
        }
      }
      const now = performance.now();
      const step = (now - waveAt) / 1000;
      waveAt = now;
      wave = origin === null ? 0 : Math.min(f.theta, wave + WAVE_MAX_RATE * step);
      const be = easeInOut(f.lift);
      e.setMoonBoot({
        pieces: f.pieces,
        lift: f.lift,
        cx,
        cy,
        size: size * f.breathe,
        white: f.white,
        flat: reduced ? (f.lift >= 1 ? 0 : 1) : undefined,
        glow: 0.3 + 0.7 * be,
        alpha: 1,
      });
      // Reduced motion: no aperture and no drift; the land and the nodes still come in with the wave.
      if (reduced) e.setReveal(origin, f.theta);
      else {
        e.setReveal(origin ?? { lat: 0, lon: 0 }, wave, { aperture: true });
        // The camera drifts in while the planet lights (design 6.4 J, 60 to 100%): a share of the size the planet
        // ends at in the shell's free area, whatever area the engine frames it in now.
        e.setViewScale(bootScale(driftShare(f.progress), shellRadius(), e.framing().homeRadius));
      }
      if (f.lift > 0 && !lifted) {
        lifted = true;
        // The globe leaves the centre for the shell's free area over the same time as the lift.
        e.setInset(globeInset(wm.getState()), LIFT_MS[reduced ? 'reduced' : 'first']);
      }
    };

    const observed = () => ({
      loaded: runtime.store.loaded,
      status: runtime.store.connection.status as string,
      globe: handles.status.get(),
    });

    const tick = () => {
      if (ended) return;
      const now = performance.now();
      // The bootstrap request's first byte, from the browser's own timing; read until it shows up.
      if (marks.bootstrapStart === undefined && marksTries++ < 600)
        marks = readMarks(performance.getEntriesByType('resource'));
      const obs = observed();
      const sig = collector.observe(now, obs, marks);
      const f = timeline.step(now, sig);
      const fx = facts();
      paint(f, fx);
      drive(f);
      if (v.fallback && obs.globe !== 'ready' && obs.globe !== 'loading') {
        v.fallback.style.opacity = String(f.pieces.every((p) => p >= 1) ? 1 : Math.min(...f.pieces));
      }
      if (f.phase === 'done') {
        end('done');
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onKey = (e: KeyboardEvent) => {
      if (['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'CapsLock'].includes(e.key)) return;
      if ((e.target as HTMLElement | null)?.closest?.('.boot-fail')) return;
      skip();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      cancelAnimationFrame(raf);
      if (!ended) {
        const e = engine();
        e?.setMoonBoot(null);
        e?.setReveal(null);
        e?.setViewScale(1, 0);
      }
    };
  }, []);

  if (gone) return null;
  return (
    <div
      ref={rootRef}
      className="boot"
      data-testid="boot"
      data-mode={choice}
      data-engine="off"
      data-phase="assembling"
      onPointerDown={(e) => {
        if (!(e.target as HTMLElement).closest('.boot-fail')) actions.current.skip();
      }}
    >
      <div className="boot-pat" aria-hidden="true" />
      <div className="boot-scrim" aria-hidden="true" />
      <header className="boot-brand">
        <FluxRound size={34} />
        <b className="boot-word">Atlas</b>
        <small>Live map of the Flux network</small>
      </header>
      <div className="boot-tip">
        <small>Chain tip</small>
        <b>0</b>
        <small>
          next block in <i /> s
        </small>
      </div>
      <FluxMarkWhite size={SIZE_FALLBACK} className="boot-fallback" />
      <div className="boot-ring" aria-hidden="true" />
      <div className="boot-tiers" aria-hidden="true">
        {TIERS.map((t) => (
          <span key={t} className="tc" data-tier={t}>
            <TierGlyph tier={t} size={14} />
            <b className="tc-n">0</b>
          </span>
        ))}
      </div>
      <ol className="boot-log" aria-label="Boot log">
        {STAGES.map((s) => (
          <li key={s.id} data-stage={s.id} data-state="wait">
            <span className="s" aria-hidden="true" />
            <span className="n">{s.label}</span>
            <span className="v" />
          </li>
        ))}
      </ol>
      <div className="boot-pct" aria-hidden="true">
        <b>0</b>
        <span>%</span>
      </div>
      <div className="boot-cap" aria-hidden="true">
        Starting
      </div>
      <div className="boot-line" aria-hidden="true">
        <i />
      </div>
      <p className="boot-hint" aria-hidden="true">
        <kbd className="kbd">esc</kbd>
        skip the boot
      </p>
      {failed ? (
        <div className="boot-fail" role="alert">
          <b>{failed === 'stream' ? 'The live stream did not open' : 'Atlas did not answer'}</b>
          <p>
            {failed === 'stream'
              ? 'The map is the last snapshot and may be out of date. Atlas keeps trying in the background.'
              : 'Check the connection. Atlas keeps trying in the background.'}
          </p>
          <div className="boot-fail-actions">
            <button type="button" className="boot-btn" onClick={() => actions.current.retry()}>
              Retry
            </button>
            <button type="button" className="boot-btn" data-quiet="" onClick={() => actions.current.skip()}>
              {hasSnapshot ? 'Continue with the last snapshot' : 'Continue without data'}
            </button>
          </div>
        </div>
      ) : null}
      <p className="sr-only" role="status">
        {said}
      </p>
    </div>
  );
}

const SIZE_FALLBACK = 250;
