// The globe's place labels, as pure data and arithmetic (the React layer is globe/overlays.tsx).
//
// A label names a country (at the global and continental zoom bands) or a site (from the regional band)
// and floats above the tallest tower of its place, so it never sits on the light it names. The list is
// short on purpose: the biggest places only, fewer at a distance, more as the planet fills the screen.

import type { ZoomBand } from '../../globe/engine/types';
import type { NetworkStore } from '../../store/network';
import { countryName } from './places';

export interface Place {
  id: string;
  kind: 'country' | 'city';
  text: string;
  lat: number;
  lon: number;
  count: number;
  /** Nodes in the biggest hub of the place: its tower's height sets how high the label floats. */
  hub: number;
}

/** The height of a hub's tower in globe radii; mirrors the engine's `spireHeight` (nodes/layout.ts). */
export function towerHeight(n: number): number {
  return n < 2 ? 0 : Math.min(0.27, 0.011 + 0.0068 * Math.sqrt(n));
}

/** Where a place's label floats: just above its tallest tower, in globe radii. */
export const labelAltitude = (hub: number): number => 0.012 + towerHeight(hub) + (hub >= 2 ? 0.014 : 0);

/** How many labels each zoom band shows (design 7.7): few at a distance, more as the planet fills the screen. */
export const LABEL_LIMIT: Record<ZoomBand, number> = { 0: 8, 1: 16, 2: 40, 3: 40 };

/** A country needs this many nodes to be named. */
export const COUNTRY_MIN_NODES = 50;

/** Countries with enough nodes (at their nodes' mean position) and the 40 biggest sites, biggest first. */
export function computePlaces(store: NetworkStore): { countries: Place[]; cities: Place[] } {
  const t = store.nodes;
  const locs = t.locations;
  const byCountry = new Map<string, { n: number; x: number; y: number; z: number; hub: number }>();
  for (let i = 0; i < t.count; i++) {
    const lat = t.lat[i] ?? Number.NaN;
    const lon = t.lon[i] ?? Number.NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const cc = t.countryCode(i);
    if (!cc) continue;
    let c = byCountry.get(cc);
    if (!c) {
      c = { n: 0, x: 0, y: 0, z: 0, hub: 0 };
      byCountry.set(cc, c);
    }
    const la = (lat * Math.PI) / 180;
    const lo = (lon * Math.PI) / 180;
    c.n++;
    c.x += Math.cos(la) * Math.cos(lo);
    c.y += Math.cos(la) * Math.sin(lo);
    c.z += Math.sin(la);
    const hub = locs?.info(t.loc[i] ?? 0)?.nodeCount ?? 0;
    if (hub > c.hub) c.hub = hub;
  }
  const countries: Place[] = [];
  for (const [cc, c] of byCountry) {
    if (c.n < COUNTRY_MIN_NODES) continue;
    const lat = (Math.atan2(c.z, Math.hypot(c.x, c.y)) * 180) / Math.PI;
    const lon = (Math.atan2(c.y, c.x) * 180) / Math.PI;
    countries.push({
      id: `cc:${cc}`,
      kind: 'country',
      text: countryName(cc, 'short') ?? cc,
      lat,
      lon,
      count: c.n,
      hub: c.hub,
    });
  }
  countries.sort((a, b) => b.count - a.count);
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
        hub: info.nodeCount,
      });
    }
  }
  cities.sort((a, b) => b.count - a.count);
  return { countries, cities: cities.slice(0, 40) };
}

/** Width of a label in CSS px: measured on a canvas when there is one, estimated otherwise. */
const measureCtx: CanvasRenderingContext2D | null = (() => {
  try {
    return typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  } catch {
    return null;
  }
})();

export function labelWidth(text: string, kind: 'country' | 'city'): number {
  const upper = kind === 'country' ? text.toUpperCase() : text;
  const spacing = kind === 'country' ? 0.1 * 10.5 * upper.length : 0;
  if (measureCtx) {
    measureCtx.font =
      kind === 'country'
        ? "500 10.5px 'Montserrat Variable', Montserrat, sans-serif"
        : "400 10.5px 'IBM Plex Mono', monospace";
    const w = measureCtx.measureText(upper).width;
    if (w > 0) return Math.round(w + spacing);
  }
  return Math.round(upper.length * (kind === 'country' ? 7.4 : 6.3) + spacing);
}

/** How far below the clearance line a label is fully shown (it fades in over this many px). */
export const LABEL_FADE_PX = 24;

/**
 * A label's opacity in 0.05 steps: it fades out toward the planet's limb (the anchor system's own rule,
 * `facing` 0 at the limb to 1 a quarter of the way in) and under the top chrome (the top of its box above
 * `top` hides it, so a label is never cut in half by the top bar or the aim strip).
 */
export function labelOpacity(facing: number, boxTop: number, top: number): number {
  const limb = Math.min(1, Math.max(0, facing / 0.25));
  const clear = Math.min(1, Math.max(0, (boxTop - top) / LABEL_FADE_PX));
  return Math.round(limb * clear * 20) / 20;
}
