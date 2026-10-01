// DOM overlays that ride the globe: place labels (countries and cities), hover cards, the first-visit hint beside
// the moon and the moon's DOM proxy button. All per-frame positioning goes through the anchor system (no React
// render per frame). This file is the gates and the logic that has to run from the first frame (what the pointer
// rests on, when the hint is due, the moon's keyboard target); the layers themselves are chunks of their own in
// features/chrome/overlays/, fetched when the data is in (the labels) or the pointer is over something (the
// cards), so the shell chunk carries none of their markup, arithmetic or styles.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useNetwork } from '../app/context';
import { useBootPhase } from '../features/chrome/boot/state';
import { hoverKey, TIP_DELAY_MS } from '../features/chrome/cardplace';
import {
  MOON_HINT_DELAY_MS,
  MOON_HINT_LEAVE_MS,
  MOON_HINT_SHOW_MS,
  markMoonHintSeen,
  moonHintSeen,
  startsMoonHint,
} from '../features/chrome/home';
import { lazyCard } from '../features/chrome/lazyCard';
import type { Anchor } from './anchors';
import { useGlobeAnchor, useGlobeEngine, useGlobeHandles } from './context';
import './overlays.css';

/** The full-viewport, pointer-transparent layer every globe overlay lives in. */
export function GlobeOverlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="globe-overlay" aria-hidden="false">
      {children}
    </div>
  );
}

const loadTips = () => import('../features/chrome/overlays/Tips');
const tip = lazyCard(() => loadTips().then((m) => m.Tip));
const moonCard = lazyCard(() => loadTips().then((m) => m.MoonCard));
const moonHintCard = lazyCard(() => loadTips().then((m) => m.MoonHintCard));
const labelsLayer = lazyCard(() =>
  import('../features/chrome/overlays/PlaceLabels').then((m) => m.PlaceLabelsLayer),
);

// ---- place labels -----------------------------------------------------------------------------

/**
 * Country labels at the global and continental zoom bands, city labels from the regional band (design 7.7).
 * The layer is its own chunk and mounts once the data is in: there is nothing to name before it.
 */
export function PlaceLabels() {
  const loaded = useNetwork((s) => s.loaded);
  return loaded ? <labelsLayer.Card /> : null;
}

// ---- hover cards ----------------------------------------------------------------------------------

/** The node or site under the pointer (after a short rest) or the moon's card (design 7.7, 6.4 P, 8.17). */
export function GlobeTooltip() {
  const { hover } = useGlobeHandles();
  // The engine re-emits `hover` on every frame while the pointer rests on something, so the card follows
  // what is under the pointer (its key), not the event: otherwise the delay would restart every frame and
  // the card would never show.
  const key = useSyncExternalStore(
    hover.subscribe,
    () => hoverKey(hover.get()),
    () => '',
  );
  const [settled, setSettled] = useState('');
  useEffect(() => {
    // The pointer is over something: its card's code starts to load well before the rest delay is over.
    if (key !== '') tip.preload();
    if (key === '' || key === 'moon') {
      setSettled(key);
      return;
    }
    const h = setTimeout(() => setSettled(key), TIP_DELAY_MS);
    return () => clearTimeout(h);
  }, [key]);
  const now = hover.get();
  if (!now || key === '' || key !== settled) return null;
  return <tip.Card hover={now} />;
}

// ---- the first-visit hint (design 9.1, step 8) ---------------------------------------------------

/**
 * Once, after the first block that lands when the boot is over: a quiet note beside the moon, "That is the
 * chain. Click it.", gone after six seconds and never again (a local flag). It waits for the relay of beams to
 * finish, and it gives way to the moon's own card, to any window and to leaving the bare globe.
 */
export function MoonHint({ home }: { home: boolean }) {
  const { hover } = useGlobeHandles();
  const boot = useBootPhase();
  const height = useNetwork((s) => s.tip?.height ?? null);
  const hovering = useSyncExternalStore(
    hover.subscribe,
    () => hover.get()?.kind === 'moon',
    () => false,
  );
  const [phase, setPhase] = useState<'idle' | 'wait' | 'show' | 'leave'>('idle');
  const seen = useRef(moonHintSeen());
  const baseline = useRef<number | null>(null);
  const live = useRef({ home, height });
  live.current = { home, height };

  useEffect(() => {
    if (phase === 'show' && (hovering || !home)) {
      setPhase('leave');
      return;
    }
    if (phase !== 'idle' || seen.current) return;
    if (boot === 'done' && baseline.current === null && height !== null) {
      // The tip the boot ended on: the hint belongs to the first block after it.
      baseline.current = height;
      return;
    }
    if (startsMoonHint({ seen: false, booted: boot === 'done', baseline: baseline.current, height, home }))
      setPhase('wait');
  }, [boot, height, home, hovering, phase]);

  // One timer per phase: the wait for the relay, the six seconds shown, the fade out.
  useEffect(() => {
    if (phase === 'idle') return undefined;
    // The card's code loads during the wait for the relay of beams.
    if (phase === 'wait') moonHintCard.preload();
    const ms =
      phase === 'wait' ? MOON_HINT_DELAY_MS : phase === 'show' ? MOON_HINT_SHOW_MS : MOON_HINT_LEAVE_MS;
    const t = window.setTimeout(() => {
      if (phase !== 'wait') {
        setPhase(phase === 'show' ? 'leave' : 'idle');
        return;
      }
      if (!live.current.home) {
        // Not on the bare globe any more: wait for the next block instead.
        baseline.current = live.current.height;
        setPhase('idle');
        return;
      }
      markMoonHintSeen();
      seen.current = true;
      setPhase('show');
    }, ms);
    return () => window.clearTimeout(t);
  }, [phase]);

  if (phase === 'idle' || phase === 'wait') return null;
  return <moonHintCard.Card leaving={phase === 'leave'} />;
}

// ---- the moon's DOM proxy (design 7.10.6) -----------------------------------------------------

/**
 * A transparent button over the moon, positioned every frame, so the moon is reachable by keyboard
 * and assistive technology. The canvas does the pointer hit test (`pointer-events: none` here). Focus
 * shows the moon's card, like hover does. The moon is a real object on a world orbit: the button follows
 * its projected place, grows with its perspective size (never under the 44 px touch target) and dims
 * while the planet is hiding the moon, so a focus ring on it never sits on a moon that is not there. It
 * stays reachable while hidden (the `M` key also opens About Flux from anywhere).
 */
export function MoonProxy({ hidden }: { hidden?: boolean }) {
  const engine = useGlobeEngine();
  const ref = useRef<HTMLButtonElement>(null);
  const [focused, setFocused] = useState(false);
  const anchor = useMemo<Anchor>(() => ({ kind: 'moon' }), []);
  const last = useRef({ size: 0, dim: false });
  const options = useMemo(
    () => ({
      fade: false,
      onUpdate: () => {
        const el = ref.current;
        if (!el || !engine) return;
        const m = engine.moonState();
        // Design 7.10.6: a circle of max(44 px, 1.5 x the moon's height), so its focus ring sits just outside
        // the moon's hexagonal ring (circumradius 0.70 of the height) instead of cutting through it.
        const size = Math.max(44, Math.round(m.s * 1.5));
        const dim = m.vis < 0.5;
        const l = last.current;
        if (size !== l.size) {
          el.style.width = `${size}px`;
          el.style.height = `${size}px`;
          el.style.margin = `${-size / 2}px 0 0 ${-size / 2}px`;
          l.size = size;
        }
        if (dim !== l.dim) {
          el.style.opacity = dim ? '0.4' : '';
          l.dim = dim;
        }
      },
    }),
    [engine],
  );
  useGlobeAnchor(ref, engine && !hidden ? anchor : null, options);
  if (!engine || hidden) return null;
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="globe-moon-proxy"
        aria-label="About Flux, live network totals"
        aria-haspopup="dialog"
        onClick={() => engine.moonClick()}
        onFocus={(e) => {
          moonCard.preload();
          setFocused(e.currentTarget.matches(':focus-visible'));
        }}
        onBlur={() => setFocused(false)}
      />
      {focused ? <moonCard.Card /> : null}
    </>
  );
}
