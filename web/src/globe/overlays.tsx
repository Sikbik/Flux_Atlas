// DOM overlays that ride the globe: place labels (countries and cities), hover cards and the moon's DOM
// proxy button. All per-frame positioning goes through the anchor system (no React render per frame);
// the look is in overlays.css and the arithmetic is in features/chrome/placelabels.ts and cardplace.ts.
//
// Place labels are laid out to stay out of the way: a label floats above the tallest tower of its place
// (so it never sits on the light it names), is centred above that point, comes from a short list (the
// biggest places only), is culled against the other labels in node-count order and against the moon's
// clearance, fades out under the top chrome, and the whole layer follows the View menu's Labels switch.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useNetwork, useRuntime } from '../app/context';
import { useBootPhase } from '../features/chrome/boot/state';
import { cardFlips, hoverKey, moonCardPlace, TIP_DELAY_MS } from '../features/chrome/cardplace';
import { TIER_LABEL, TierGlyph, tierOf } from '../features/chrome/glyphs';
import {
  MOON_HINT_DELAY_MS,
  MOON_HINT_LEAVE_MS,
  MOON_HINT_SHOW_MS,
  markMoonHintSeen,
  moonHintSeen,
  startsMoonHint,
} from '../features/chrome/home';
import { useLabelsOn } from '../features/chrome/layers';
import {
  computePlaces,
  LABEL_LIMIT,
  labelAltitude,
  labelOpacity,
  labelWidth,
  type Place,
  towerHeight,
} from '../features/chrome/placelabels';
import { countryName } from '../features/chrome/places';
import { formatHeight, formatInt } from '../lib/format';
import { useBeat } from '../lib/useClock';
import type { Anchor, PlaceOptions } from './anchors';
import { GlobeLabel, useGlobeAnchor, useGlobeEngine, useGlobeHandles } from './context';
import type { ZoomBand } from './engine/types';
import './overlays.css';

/** The full-viewport, pointer-transparent layer every globe overlay lives in. */
export function GlobeOverlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="globe-overlay" aria-hidden="false">
      {children}
    </div>
  );
}

// ---- keeping clear of the chrome ----------------------------------------------------------------

/**
 * The first y an overlay may use: under the top bar and, on the desktop frame, under the aim strip's row
 * (14 px gap, 38 px strip, 10 px air).
 */
function overlayTop(): number {
  if (typeof document === 'undefined') return 114;
  const bar = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h'));
  const phone = document.querySelector('.shell')?.getAttribute('data-layout') === 'phone';
  return (Number.isFinite(bar) ? bar : 52) + (phone ? 10 : 14 + 38 + 10);
}

/** Read by the anchor loop every frame; refreshed on mount and on resize (never measured per frame). */
const clearance = { top: 114 };

function useClearance(): void {
  useEffect(() => {
    const sync = () => {
      clearance.top = overlayTop();
    };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);
}

// ---- place labels -----------------------------------------------------------------------------

/**
 * Country labels at the global and continental zoom bands, city labels from the regional band
 * (design 7.7), culled against each other in node-count order and against the moon's clearance.
 */
export function PlaceLabels() {
  const runtime = useRuntime();
  const engine = useGlobeEngine();
  const on = useLabelsOn();
  const loaded = useNetwork((s) => s.loaded);
  const nodesVersion = useNetwork((s) => Math.floor(s.versions.Nodes / 50));
  const [band, setBand] = useState<ZoomBand>(0);
  useClearance();
  useEffect(() => {
    if (!engine) return;
    return engine.on('zoomBand', (z) => setBand(z.band));
  }, [engine]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: recomputed on load and every 50 node changes
  const places = useMemo(
    () => (loaded && on ? computePlaces(runtime.store) : { countries: [], cities: [] }),
    [runtime, loaded, on, nodesVersion],
  );
  const list = band >= 2 ? places.cities : places.countries;
  const kind = band >= 2 ? 'city' : 'country';
  if (!on) return null;
  return (
    <div className="globe-places" data-band={band}>
      {list.slice(0, LABEL_LIMIT[band]).map((p, k) => (
        <PlaceLabel key={p.id} place={p} priority={k} kind={kind} />
      ))}
    </div>
  );
}

/** A label's box sits this far above its anchor point (its height plus a breath of air). */
const LABEL_DY = -22;

function PlaceLabel({ place, priority, kind }: { place: Place; priority: number; kind: 'country' | 'city' }) {
  const ref = useRef<HTMLDivElement>(null);
  const lastOpacity = useRef(-1);
  const anchor = useMemo<Anchor>(
    () => ({ kind: 'world', lat: place.lat, lon: place.lon, alt: labelAltitude(place.hub) }),
    [place.lat, place.lon, place.hub],
  );
  const w = useMemo(() => labelWidth(place.text, kind), [place.text, kind]);
  const options = useMemo<PlaceOptions>(
    () => ({
      group: 'places',
      priority,
      // Centred above the point: the box the anchor system culls is the box the eye sees.
      dx: -Math.round(w / 2),
      dy: LABEL_DY,
      // The label's own fade: toward the limb like the anchor system's, and out under the top chrome.
      fade: false,
      onUpdate: (p) => {
        const el = ref.current;
        if (!el) return;
        const o = labelOpacity(p.facing, p.y + LABEL_DY, clearance.top);
        if (o !== lastOpacity.current) {
          lastOpacity.current = o;
          el.style.opacity = String(o);
        }
      },
    }),
    [priority, w],
  );
  useGlobeAnchor(ref, anchor, options);
  return (
    <div ref={ref} className={`globe-label globe-place globe-place-${kind}`}>
      {place.text}
    </div>
  );
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
    if (key === '' || key === 'moon') {
      setSettled(key);
      return;
    }
    const h = setTimeout(() => setSettled(key), TIP_DELAY_MS);
    return () => clearTimeout(h);
  }, [key]);
  const now = hover.get();
  if (!now || key === '' || key !== settled) return null;
  if (now.kind === 'moon') return <MoonCard />;
  return now.info.isCluster ? <SiteTip loc={now.info.loc} /> : <NodeTip id={now.id} nodeKey={now.key} />;
}

/**
 * Placement for a hover card. A node's or site's card opens up and to the right of its point and flips (an
 * attribute the CSS reads) to the left or below when that would leave the screen or run under the top
 * chrome; the moon's card sits beside the moon and is nudged down clear of the chrome. All of it is written
 * from the anchor loop with the card's measured size, so nothing renders per frame and a card moves to the
 * other side as the globe turns its point toward an edge.
 */
function useCardPlacement(mode: 'point' | 'moon') {
  const ref = useRef<HTMLDivElement>(null);
  const card = useRef({ w: 240, h: 120 });
  const state = useRef({ x: false, y: false, nudge: 0 });
  useClearance();
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) card.current = { w: el.offsetWidth, h: el.offsetHeight };
  }, []);
  const options = useMemo<PlaceOptions>(
    () => ({
      dx: 0,
      dy: 0,
      fade: false,
      onUpdate: (p) => {
        const el = ref.current;
        if (!el) return;
        const s = state.current;
        let fx: boolean;
        let fy = false;
        let nudge = 0;
        if (mode === 'moon') {
          const m = moonCardPlace(p, card.current, clearance.top);
          fx = m.flipX;
          nudge = m.nudge;
        } else {
          const f = cardFlips(p, card.current, window.innerWidth, clearance.top);
          fx = f.x;
          fy = f.y;
        }
        if (fx !== s.x) {
          s.x = fx;
          el.toggleAttribute('data-flip-x', fx);
        }
        if (fy !== s.y) {
          s.y = fy;
          el.toggleAttribute('data-flip-y', fy);
        }
        if (nudge !== s.nudge) {
          s.nudge = nudge;
          el.style.setProperty('--card-nudge', `${nudge}px`);
        }
      },
    }),
    [mode],
  );
  return { ref, options };
}

/** A single node: its endpoint, tier, where it is, who runs it and its place in the queue. */
function NodeTip({ id, nodeKey }: { id: number; nodeKey: string }) {
  const runtime = useRuntime();
  const t = runtime.store.nodes;
  const i = t.indexOf(id);
  const anchor = useMemo<Anchor>(() => ({ kind: 'node', id }), [id]);
  const { ref, options } = useCardPlacement('point');
  const tier = i >= 0 ? tierOf(t.tier[i]) : 'unknown';
  const info = i >= 0 ? t.locations?.info(t.loc[i] ?? 0) : undefined;
  const country = i >= 0 ? countryName(t.countryCode(i), 'long') : null;
  const place = [info?.city, country].filter(Boolean).join(', ');
  const org = i >= 0 ? t.orgName(i) : '';
  const rank = i >= 0 ? (t.rank[i] ?? 0) : 0;
  const endpoint = i >= 0 ? t.endpoint(i) : '';
  return (
    <GlobeLabel anchor={anchor} className="globe-tipwrap" options={options}>
      <div className="globe-tip" data-kind="node" data-tier={tier} ref={ref}>
        <span className="gt-title mono">{endpoint || nodeKey}</span>
        <span className="gt-row">
          <TierGlyph tier={tier} size={13} />
          <b className="gt-tier">{TIER_LABEL[tier]}</b>
          {place ? <span className="gt-dim">{place}</span> : null}
        </span>
        {org ? <span className="gt-row gt-dim">{org}</span> : null}
        {rank > 0 ? (
          <span className="gt-row gt-dim">
            Queue position <b className="mono">{formatInt(rank)}</b>
          </span>
        ) : null}
      </div>
    </GlobeLabel>
  );
}

/**
 * A site (a co-location hub): where it is, how many nodes, and the tier split. The card is pinned to the top
 * of the site's tower, so it rides the tower as the globe turns.
 */
function SiteTip({ loc }: { loc: number }) {
  const runtime = useRuntime();
  const t = runtime.store.nodes;
  const info = t.locations?.info(loc);
  const { ref, options } = useCardPlacement('point');
  const counts = [0, 0, 0];
  let n = 0;
  let cc = '';
  for (let r = 0; r < t.count; r++) {
    if (t.loc[r] !== loc) continue;
    n++;
    if (!cc) cc = t.countryCode(r);
    const k = (t.tier[r] ?? 0) - 1;
    if (k >= 0 && k < 3) counts[k] = (counts[k] ?? 0) + 1;
  }
  const lat = info?.lat;
  const lon = info?.lon;
  const anchor = useMemo<Anchor | null>(
    () =>
      lat === undefined || lon === undefined || !Number.isFinite(lat)
        ? null
        : { kind: 'world', lat, lon, alt: towerHeight(n) + 0.004 },
    [lat, lon, n],
  );
  const where = [info?.city, countryName(cc, 'long')].filter(Boolean).join(', ');
  return (
    <GlobeLabel anchor={anchor} className="globe-tipwrap" options={options}>
      <div className="globe-tip" data-kind="site" ref={ref}>
        <span className="gt-title">{where || 'A site'}</span>
        <span className="gt-row gt-dim">
          <b className="mono">{formatInt(n)}</b> {n === 1 ? 'node' : 'nodes'} at this site
        </span>
        <span className="gt-row gt-tiers">
          {(['cumulus', 'nimbus', 'stratus'] as const).map((tier, k) => (
            <span key={tier} className="gt-tier-chip" data-tier={tier}>
              <TierGlyph tier={tier} size={12} />
              <b className="mono">{formatInt(counts[k] ?? 0)}</b>
            </span>
          ))}
        </span>
        <span className="gt-hint">Click to zoom in</span>
      </div>
    </GlobeLabel>
  );
}

function MoonCard() {
  const runtime = useRuntime();
  const beat = useBeat(runtime.clock);
  const nodes = useNetwork((s) => s.nodes.count);
  const tip = useNetwork((s) => s.tip);
  const anchor = useMemo<Anchor>(() => ({ kind: 'moon' }), []);
  const { ref, options } = useCardPlacement('moon');
  return (
    <GlobeLabel anchor={anchor} className="globe-tipwrap" options={options}>
      <div className="globe-tip" data-kind="moon" ref={ref}>
        <span className="gt-title">Flux chain</span>
        <span className="gt-row gt-dim tabular">
          {tip ? `Block ${formatHeight(tip.height)}` : 'Waiting for a block'}
        </span>
        <span className="gt-row gt-dim tabular">
          {beat.height === null ? '' : `Next block in ${Math.ceil(beat.remainingMs / 1000)} s`}
        </span>
        <span className="gt-row gt-dim tabular">Network {formatInt(nodes)} nodes</span>
        <span className="gt-hint">
          Click for About Flux <kbd className="kbd">M</kbd>
        </span>
      </div>
    </GlobeLabel>
  );
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
  return <MoonHintCard leaving={phase === 'leave'} />;
}

function MoonHintCard({ leaving }: { leaving: boolean }) {
  const anchor = useMemo<Anchor>(() => ({ kind: 'moon' }), []);
  const { ref, options } = useCardPlacement('moon');
  return (
    <GlobeLabel anchor={anchor} className="globe-tipwrap" options={options}>
      <div
        className="globe-tip globe-hint"
        data-kind="moon"
        data-leaving={leaving || undefined}
        role="status"
        ref={ref}
      >
        <span className="gt-title">That is the chain.</span>
        <span className="gt-dim">Click it.</span>
      </div>
    </GlobeLabel>
  );
}

// ---- the moon's DOM proxy (design 7.10.6) -----------------------------------------------------

/**
 * A transparent button over the moon, positioned every frame, so the moon is reachable by keyboard
 * and assistive technology. The canvas does the pointer hit test (`pointer-events: none` here). Focus
 * shows the moon's card, like hover does.
 */
export function MoonProxy({ hidden }: { hidden?: boolean }) {
  const engine = useGlobeEngine();
  const ref = useRef<HTMLButtonElement>(null);
  const [focused, setFocused] = useState(false);
  const anchor = useMemo<Anchor>(() => ({ kind: 'moon' }), []);
  useGlobeAnchor(ref, engine && !hidden ? anchor : null, { fade: false });
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
        onFocus={(e) => setFocused(e.currentTarget.matches(':focus-visible'))}
        onBlur={() => setFocused(false)}
      />
      {focused ? <MoonCard /> : null}
    </>
  );
}
