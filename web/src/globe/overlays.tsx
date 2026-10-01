// DOM overlays that ride the globe: place labels (countries and cities), the hover tooltip and the
// moon's DOM proxy button. Neutral, token-driven structure for the shell team to style; all
// per-frame positioning goes through the anchor system (no React render per frame).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNetwork, useRuntime } from '../app/context';
import { formatHeight, formatInt } from '../lib/format';
import { useBeat } from '../lib/useClock';
import type { NetworkStore } from '../store/network';
import type { Anchor } from './anchors';
import { GlobeLabel, useGlobeAnchor, useGlobeEngine, useGlobeHover } from './context';
import type { ZoomBand } from './engine/types';

const TIER_NAME = ['Unknown', 'Cumulus', 'Nimbus', 'Stratus'] as const;

/** The full-viewport, pointer-transparent layer every globe overlay lives in. */
export function GlobeOverlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="globe-overlay" aria-hidden="false">
      {children}
    </div>
  );
}

// ---- place labels -----------------------------------------------------------------------------

interface Place {
  id: string;
  kind: 'country' | 'city';
  text: string;
  lat: number;
  lon: number;
  count: number;
}

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();

/** Countries with 50 or more nodes (at their nodes' mean position) and the 40 biggest sites. */
export function computePlaces(store: NetworkStore): { countries: Place[]; cities: Place[] } {
  const t = store.nodes;
  const byCountry = new Map<string, { n: number; x: number; y: number; z: number }>();
  for (let i = 0; i < t.count; i++) {
    const lat = t.lat[i]!;
    const lon = t.lon[i]!;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const cc = t.countryCode(i);
    if (!cc) continue;
    let c = byCountry.get(cc);
    if (!c) {
      c = { n: 0, x: 0, y: 0, z: 0 };
      byCountry.set(cc, c);
    }
    const la = (lat * Math.PI) / 180;
    const lo = (lon * Math.PI) / 180;
    c.n++;
    c.x += Math.cos(la) * Math.cos(lo);
    c.y += Math.cos(la) * Math.sin(lo);
    c.z += Math.sin(la);
  }
  const countries: Place[] = [];
  for (const [cc, c] of byCountry) {
    if (c.n < 50) continue;
    const lat = (Math.atan2(c.z, Math.hypot(c.x, c.y)) * 180) / Math.PI;
    const lon = (Math.atan2(c.y, c.x) * 180) / Math.PI;
    countries.push({
      id: `cc:${cc}`,
      kind: 'country',
      text: regionNames?.of(cc) ?? cc,
      lat,
      lon,
      count: c.n,
    });
  }
  countries.sort((a, b) => b.count - a.count);
  const locs = t.locations;
  const cities: Place[] = [];
  if (locs) {
    for (let l = 1; l < locs.length; l++) {
      const info = locs.info(l);
      if (!info?.city || info.nodeCount <= 0 || !Number.isFinite(info.lat)) continue;
      cities.push({
        id: `loc:${l}`,
        kind: 'city',
        text: info.city,
        lat: info.lat,
        lon: info.lon,
        count: info.nodeCount,
      });
    }
  }
  cities.sort((a, b) => b.count - a.count);
  return { countries, cities: cities.slice(0, 40) };
}

/**
 * Country labels at the global and continental zoom bands, city labels from the regional band
 * (design 7.7), collision-culled in node-count order, kept out of the moon's clearance, at most 60.
 */
export function PlaceLabels() {
  const runtime = useRuntime();
  const engine = useGlobeEngine();
  const loaded = useNetwork((s) => s.loaded);
  const nodesVersion = useNetwork((s) => Math.floor(s.versions.Nodes / 50));
  const [band, setBand] = useState<ZoomBand>(0);
  useEffect(() => {
    if (!engine) return;
    return engine.on('zoomBand', (z) => setBand(z.band));
  }, [engine]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: recomputed on load and every 50 node changes
  const places = useMemo(
    () => (loaded ? computePlaces(runtime.store) : { countries: [], cities: [] }),
    [runtime, loaded, nodesVersion],
  );
  const list = band >= 2 ? places.cities : places.countries;
  const kind = band >= 2 ? 'city' : 'country';
  return (
    <div className="globe-places" data-band={band}>
      {list.slice(0, 60).map((p, k) => (
        <PlaceLabel key={p.id} place={p} priority={k} kind={kind} />
      ))}
    </div>
  );
}

function PlaceLabel({ place, priority, kind }: { place: Place; priority: number; kind: string }) {
  const anchor = useMemo<Anchor>(
    () => ({ kind: 'world', lat: place.lat, lon: place.lon, alt: 0.012 }),
    [place.lat, place.lon],
  );
  return (
    <GlobeLabel
      anchor={anchor}
      className={`globe-place globe-place-${kind}`}
      options={{ group: 'places', priority, dx: 6, dy: -8 }}
    >
      {place.text}
    </GlobeLabel>
  );
}

// ---- hover tooltip ----------------------------------------------------------------------------

/** The node under the pointer (after 180 ms) or the moon's card (design 7.7, 6.4 P). */
export function GlobeTooltip() {
  const hover = useGlobeHover();
  const [shown, setShown] = useState(hover);
  useEffect(() => {
    if (!hover) {
      setShown(null);
      return;
    }
    if (hover.kind === 'moon') {
      setShown(hover);
      return;
    }
    const h = setTimeout(() => setShown(hover), 180);
    return () => clearTimeout(h);
  }, [hover]);
  if (!shown) return null;
  return shown.kind === 'moon' ? <MoonCard /> : <NodeTip id={shown.id} nodeKey={shown.key} />;
}

function NodeTip({ id, nodeKey }: { id: number; nodeKey: string }) {
  const runtime = useRuntime();
  const t = runtime.store.nodes;
  const i = t.indexOf(id);
  const tier = i >= 0 ? (t.tier[i] ?? 0) : 0;
  const city = i >= 0 ? (t.locations?.info(t.loc[i] ?? 0)?.city ?? '') : '';
  const anchor = useMemo<Anchor>(() => ({ kind: 'node', id }), [id]);
  return (
    <GlobeLabel anchor={anchor} className="globe-tip" options={{ dx: 14, dy: -14, fade: false }}>
      <span className="globe-tip-title mono">{nodeKey}</span>
      <span className="globe-tip-sub" data-tier={TIER_NAME[tier]?.toLowerCase()}>
        {TIER_NAME[tier]}
        {city ? `, ${city}` : ''}
      </span>
    </GlobeLabel>
  );
}

function MoonCard() {
  const runtime = useRuntime();
  const beat = useBeat(runtime.clock);
  const nodes = useNetwork((s) => s.nodes.count);
  const tip = useNetwork((s) => s.tip);
  const anchor = useMemo<Anchor>(() => ({ kind: 'moon' }), []);
  return (
    <GlobeLabel
      anchor={anchor}
      className="globe-tip globe-tip-moon"
      options={{ dx: -230, dy: -40, fade: false }}
    >
      <span className="globe-tip-title">Flux chain</span>
      <span className="globe-tip-sub tabular">
        {tip ? `Block ${formatHeight(tip.height)}` : 'Waiting for a block'}
      </span>
      <span className="globe-tip-sub tabular">
        {beat.height === null ? '' : `Next block in ${Math.ceil(beat.remainingMs / 1000)} s`}
      </span>
      <span className="globe-tip-sub tabular">Network {formatInt(nodes)} nodes</span>
      <span className="globe-tip-hint">
        Click for About Flux <kbd>M</kbd>
      </span>
    </GlobeLabel>
  );
}

// ---- the moon's DOM proxy (design 7.10.6) -----------------------------------------------------

/**
 * A transparent button over the moon, positioned every frame, so the moon is reachable by keyboard
 * and assistive technology. The canvas does the pointer hit test (`pointer-events: none` here).
 */
export function MoonProxy({ hidden }: { hidden?: boolean }) {
  const engine = useGlobeEngine();
  const ref = useRef<HTMLButtonElement>(null);
  const anchor = useMemo<Anchor>(() => ({ kind: 'moon' }), []);
  useGlobeAnchor(ref, engine && !hidden ? anchor : null, { fade: false });
  if (!engine || hidden) return null;
  return (
    <button
      ref={ref}
      type="button"
      className="globe-moon-proxy"
      aria-label="About Flux, live network totals"
      aria-haspopup="dialog"
      onClick={() => engine.moonClick()}
    />
  );
}
