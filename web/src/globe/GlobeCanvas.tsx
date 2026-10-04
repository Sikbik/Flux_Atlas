// GlobeCanvas: the persistent living wallpaper. Mounted ONCE at the app root (RootLayout), outside
// every route, so it never unmounts while the user navigates; windows are routes drawn over it.
//
// - The engine (three.js and everything under ./engine) is a separate chunk: `import()` starts after
//   the first paint, so the shell and the boot screen render before three.js arrives.
// - Resize and DPR: the engine observes its canvas (ResizeObserver) and caps the device pixel ratio
//   (2, then its tier's cap: 2, 1.5, 1).
// - Hidden tab: the engine stops its loop and returns without a backlog; the choreographer recaps.
// - WebGL context loss: the canvas is dropped and, once the browser restores the context, a fresh
//   engine is created on a new canvas and re-bound (all state comes from the store and the URL).
// - Motion: the app's motion setting (system, full, reduced, off) drives `engine.setReduced`.
// - Quality: the user's performance tier picks the engine's quality; under `auto` the engine's
//   governor lowers the render scale, then the tier (high, medium, low). The lite tier draws the
//   dot-matrix planet ("holo"), whatever the art style setting says.
// - Art style: `useUi().globeArt` (marble default, holo = dot matrix, neon), persisted.
// - Borders: `useUi().globeBorders` (off, countries, or countries with state lines: the default), persisted;
//   state lines are fetched when the camera first comes down and are never drawn on the low tier.

import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { queries } from '../api/queries';
import { useRuntime } from '../app/context';
import { effectiveMotion, type GlobeArtPref, type PerfPref, useUi } from '../store/ui';
import { bindGlobe, type GlobeIntent, globeViewFromLocation } from './bindings';
import { useGlobeHandles } from './context';
import type { GlobeEngine } from './engine/GlobeEngine';
import type { ArtDirection, QualityLevel } from './engine/types';
import { cameraKeyFor, globeTakesKeys } from './keys';
import { exposeGlobeStats } from './stats';

/** Loads the engine chunk (three.js and the renderer). */
export const loadEngine = () => import('./engine');

/** Waits before each fresh engine when a lost WebGL context is not restored by the browser, ms. */
const RECOVERY_MS = [1500, 4000, 10_000, 20_000, 30_000] as const;
/** An engine that has drawn this long resets the recovery backoff, seconds. */
const HEALTHY_S = 20;

const QUALITY: Record<PerfPref, QualityLevel> = {
  auto: 'auto',
  high: 'high',
  balanced: 'medium',
  lite: 'low',
};

/** The art direction actually drawn: the lite tier (chosen or reached by the governor) is the dot matrix. */
export function effectiveArt(art: GlobeArtPref, perf: PerfPref, governorLite: boolean): ArtDirection {
  if (perf === 'lite' || governorLite) return 'dotmatrix';
  return art === 'holo' ? 'dotmatrix' : art;
}

/** True for CPU rasterizers (no GPU acceleration). */
export function isSoftwareGl(e: GlobeEngine): boolean {
  try {
    const gl = e.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    return /swiftshader|llvmpipe|softpipe|software/i.test(name);
  } catch {
    return false;
  }
}

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
};

export function GlobeCanvas() {
  const runtime = useRuntime();
  const handles = useGlobeHandles();
  const navigate = useNavigate();
  const location = useRouterState({ select: (s) => s.location });
  const hostRef = useRef<HTMLDivElement>(null);
  const [generation, setGeneration] = useState(0);
  const [engine, setEngine] = useState<GlobeEngine | null>(null);
  const [governorLite, setGovernorLite] = useState(false);
  const art = useUi((s) => s.globeArt);
  const borders = useUi((s) => s.globeBorders);
  const perf = useUi((s) => s.perf);
  const motion = useUi((s) => s.motion);
  const watched = useUi((s) => s.watched);

  // The latest location and navigate for the binding's intents (stable across renders).
  const nav = useRef({ navigate, location });
  nav.current = { navigate, location };

  // Context-loss recovery: a fresh engine on the browser's restore event, or, when the browser never
  // restores (a blocked GPU, a reset it will not undo), after a backoff (RECOVERY_MS). `attempts`
  // resets once an engine has drawn for HEALTHY_S seconds.
  const recovery = useRef<{ attempts: number; timer: ReturnType<typeof setTimeout> | null }>({
    attempts: 0,
    timer: null,
  });

  // ---- create the engine (once per generation) ----------------------------------------------
  // biome-ignore lint/correctness/useExhaustiveDependencies: preferences are applied by the effects below; the engine is created once per generation
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let dispose: (() => void) | null = null;
    const rec = recovery.current;
    const scheduleRecovery = () => {
      if (cancelled || rec.timer !== null) return;
      if (rec.attempts >= RECOVERY_MS.length) {
        console.error('[globe] the WebGL context did not come back');
        handles.status.set('error');
        return;
      }
      const delay = RECOVERY_MS[rec.attempts]!;
      rec.attempts++;
      rec.timer = setTimeout(() => {
        rec.timer = null;
        setGeneration((g) => g + 1);
      }, delay);
    };
    handles.status.set('loading');
    loadEngine().then(
      ({ GlobeEngine, tokensFromCss }) => {
        if (cancelled) return;
        const canvas = document.createElement('canvas');
        canvas.className = 'globe-canvas';
        canvas.setAttribute('aria-hidden', 'true');
        host.appendChild(canvas);
        const ui = useUi.getState();
        let e: GlobeEngine;
        try {
          e = new GlobeEngine(canvas, {
            assetBase: import.meta.env.BASE_URL,
            artDirection: effectiveArt(ui.globeArt, ui.perf, false),
            borders: ui.globeBorders,
            quality: QUALITY[ui.perf],
            maxDpr: 2,
            respectReducedMotion: false,
          });
        } catch (err) {
          canvas.remove();
          // After a context loss WebGL can be briefly unavailable: keep trying before giving up.
          if (generation > 0 && rec.attempts < RECOVERY_MS.length) {
            scheduleRecovery();
            return;
          }
          handles.status.set((err as Error)?.name === 'GlobeUnsupportedError' ? 'unsupported' : 'error');
          if ((err as Error)?.name !== 'GlobeUnsupportedError') console.error('[globe]', err);
          return;
        }
        e.setDesignTokens(tokensFromCss(document.documentElement, e.tokens));
        e.setReduced(effectiveMotion(ui.motion) !== 'full');
        // Software GL (SwiftShader, llvmpipe: no GPU, or a blocklisted one) renders every pixel on the
        // CPU and would freeze the page at the high tier: start at the lite tier and stay there.
        if (isSoftwareGl(e)) {
          e.setQuality('low');
          e.setEffects({ bloom: false, clouds: false, grain: false, chromatic: false });
          setGovernorLite(true);
          host.dataset.gl = 'software';
        }
        const binding = bindGlobe(e, {
          store: runtime.store,
          setEffectSink: (s) => runtime.setEffectSink(s),
          appInstances: async (name) => {
            const d = await runtime.queryClient.fetchQuery(queries.appDetail(name));
            return d.instances.flatMap((i) => (i.node === null ? [] : [i.node]));
          },
          onIntent: (intent) => onIntent(intent),
          onHover: (h) => handles.hover.set(h),
        });
        binding.setWatched(ui.watched);
        const loc = nav.current.location;
        binding.setView(globeViewFromLocation(loc.pathname, loc.search as Record<string, unknown>));

        // The moon's ring is the Beat clock; its glow tells a late chain or a lost feed.
        let moonStatus: 'live' | 'late' | 'offline' = 'live';
        const born = performance.now();
        const offFrame = e.on('frame', () => {
          if (rec.attempts > 0 && performance.now() - born > HEALTHY_S * 1000) rec.attempts = 0;
          const beat = runtime.clock.beat();
          e.setBeat(beat.height === null ? 0 : beat.progress);
          const conn = runtime.store.connection.status;
          const status =
            conn === 'offline' || conn === 'reconnecting' || conn === 'closed'
              ? 'offline'
              : beat.phase === 'late' || beat.phase === 'quiet'
                ? 'late'
                : 'live';
          if (status !== moonStatus) {
            moonStatus = status;
            e.setMoonStatus(status);
          }
        });
        const offQuality = e.on('quality', (q) => setGovernorLite(q.level === 'low'));
        const fitMoon = () => e.setMoon({ scale: window.innerWidth < 720 ? 0.86 : 1 });
        fitMoon();
        window.addEventListener('resize', fitMoon);

        const onLost = (ev: Event) => {
          ev.preventDefault();
          handles.status.set('loading');
          host.dataset.globe = 'loading';
          scheduleRecovery();
        };
        // A restored context gets a fresh engine on a fresh canvas (simpler and safer than
        // re-uploading every GPU resource of the old one).
        const onRestored = () => {
          if (rec.timer !== null) clearTimeout(rec.timer);
          rec.timer = null;
          setGeneration((g) => g + 1);
        };
        canvas.addEventListener('webglcontextlost', onLost);
        canvas.addEventListener('webglcontextrestored', onRestored);

        handles.anchors.attach(e, canvas);
        handles.engine.set(e);
        handles.binding.set(binding);
        handles.status.set('ready');
        host.dataset.globe = 'ready';
        setEngine(e);
        const unexpose = exposeGlobeStats(e, () => ({ generation, art: e.artDirection }));

        dispose = () => {
          unexpose();
          offFrame();
          offQuality();
          window.removeEventListener('resize', fitMoon);
          canvas.removeEventListener('webglcontextlost', onLost);
          canvas.removeEventListener('webglcontextrestored', onRestored);
          handles.anchors.attach(null);
          if (handles.binding.get() === binding) handles.binding.set(null);
          if (handles.engine.get() === e) handles.engine.set(null);
          handles.hover.set(null);
          binding.dispose();
          try {
            e.dispose();
          } catch {
            // A lost context can make GPU cleanup throw; the canvas goes away regardless.
          }
          canvas.remove();
          setEngine((cur) => (cur === e ? null : cur));
        };
      },
      (err) => {
        if (cancelled) return;
        console.error('[globe] the engine chunk failed to load', err);
        handles.status.set('error');
      },
    );
    return () => {
      cancelled = true;
      if (rec.timer !== null) clearTimeout(rec.timer);
      rec.timer = null;
      dispose?.();
      if (host.dataset.globe === 'ready') host.dataset.globe = 'loading';
    };
  }, [generation]);

  // ---- intents from the globe -> navigation -----------------------------------------------
  function onIntent(intent: GlobeIntent) {
    const { navigate: go, location: loc } = nav.current;
    const path = loc.pathname;
    switch (intent.kind) {
      case 'selectNode':
        void go({
          to: '/node/$key',
          params: { key: intent.key },
          search: (prev) => ({ ...prev, sel: undefined }),
        });
        break;
      case 'clearSelection':
        if (path.startsWith('/node/') || path.startsWith('/host/'))
          void go({ to: '/', search: (prev) => ({ ...prev, sel: undefined }) });
        else void go({ to: '.', search: (prev) => ({ ...prev, sel: undefined }) });
        break;
      case 'openAbout':
        if (path !== '/about') void go({ to: '/about', search: (prev) => prev });
        break;
      case 'wake':
        if (path === '/ambient') void go({ to: '/' });
        break;
    }
  }

  // ---- URL -> view ------------------------------------------------------------------------
  // biome-ignore lint/correctness/useExhaustiveDependencies: `engine` re-applies the view to a new engine and binding
  useEffect(() => {
    handles.binding
      .get()
      ?.setView(globeViewFromLocation(location.pathname, location.search as Record<string, unknown>));
  }, [handles, location, engine]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `engine` re-applies the watchlist to a new binding
  useEffect(() => {
    handles.binding.get()?.setWatched(watched);
  }, [handles, watched, engine]);

  // ---- preferences ------------------------------------------------------------------------
  useEffect(() => {
    if (!engine) return;
    engine.setQuality(isSoftwareGl(engine) ? 'low' : QUALITY[perf]);
  }, [engine, perf]);

  useEffect(() => {
    if (!engine) return;
    const want = effectiveArt(art, perf, governorLite);
    if (engine.artDirection !== want) engine.setArtDirection(want);
  }, [engine, art, perf, governorLite]);

  useEffect(() => {
    if (!engine) return;
    engine.setBorders(borders);
  }, [engine, borders]);

  useEffect(() => {
    if (!engine) return;
    const apply = () => engine.setReduced(effectiveMotion(motion) !== 'full');
    apply();
    if (motion !== 'system' || typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [engine, motion]);

  // ---- the home control: any in-app link to the bare globe (the lockup) and the dock's Globe -------
  // Activating one is an explicit "home": the camera eases back to the home view, whether the link
  // navigates (closing a window) or not (already at `/`, which the router treats as a no-op).
  useEffect(() => {
    if (!engine) return;
    const onClick = (ev: MouseEvent) => {
      if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey)
        return;
      const el = (ev.target as Element | null)?.closest?.('a[href], [data-launcher="globe"]') ?? null;
      if (!el) return;
      // The dock's Globe is a button (it navigates through the shell's actions), not a link.
      if (el instanceof HTMLAnchorElement) {
        if (el.target && el.target !== '_self') return;
        const url = new URL(el.href, window.location.href);
        if (url.origin !== window.location.origin || url.pathname !== '/') return;
      }
      // After the router has applied the navigation (the binding sees the bare view first).
      setTimeout(() => handles.binding.get()?.home(), 0);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [engine, handles]);

  // ---- keyboard: M is the moon's click (About Flux), the camera keys (keys.ts); every key wakes the screensaver
  useEffect(() => {
    if (!engine) return;
    const onKey = (ev: KeyboardEvent) => {
      if (isTyping(ev.target)) return;
      engine.notifyKey();
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const loc = nav.current.location;
      if ((ev.key === 'm' || ev.key === 'M') && loc.pathname !== '/ambient') engine.moonClick();
      // The camera keys (design 10.4): only when no field, menu, palette or window has the focus, and
      // not in ambient or while the boot plays (any key skips it).
      const act = cameraKeyFor(ev.key, ev.shiftKey);
      if (!act || loc.pathname === '/ambient') return;
      if (document.querySelector('.shell[data-boot="running"]')) return;
      const palette = Object.hasOwn((loc.search as object) ?? {}, 'q');
      if (!globeTakesKeys(ev, document.activeElement, palette)) return;
      ev.preventDefault();
      switch (act.kind) {
        case 'orbit':
          engine.orbitStep(act.x, act.y);
          break;
        case 'turn':
          engine.turnStep(act.heading, act.tilt);
          break;
        case 'zoom':
          engine.zoomStep(act.steps);
          break;
        case 'home':
          void engine.home();
          break;
        case 'focus':
          engine.flyToSelection();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine]);

  return <div ref={hostRef} className="globe-layer" data-globe="loading" />;
}
