// Places the camera can fly to: a city (a site where nodes live, or one from the built-in gazetteer), a
// country (which also filters the globe), a continent or plain coordinates. Shared by the palette's
// "Go to" group, the `goto` prefix and the terminal.

import { formatInt } from '../../lib/format';
import type { NetworkStore } from '../../store/network';
import { type CountryEntry, type LocalIndex, matchCities, matchCountries } from './palette/local';
import { matchScore } from './palette/rank';
import type { FlyView } from './palette/types';
import { GAZETTEER } from './places.data';

export type PlaceKind = 'city' | 'country' | 'continent' | 'coords';

export interface Place {
  id: string;
  kind: PlaceKind;
  name: string;
  sub: string;
  view: FlyView;
  /** Countries also filter the globe to their nodes. */
  cc?: string;
  score: number;
}

const CONTINENTS: readonly { name: string; lat: number; lon: number; alt: number; keys: string }[] = [
  { name: 'Europe', lat: 52, lon: 14, alt: 1.9, keys: 'europe eu' },
  { name: 'Asia', lat: 36, lon: 95, alt: 2.9, keys: 'asia' },
  { name: 'Africa', lat: 4, lon: 20, alt: 2.7, keys: 'africa' },
  { name: 'North America', lat: 44, lon: -100, alt: 2.9, keys: 'north america na' },
  { name: 'South America', lat: -15, lon: -60, alt: 2.7, keys: 'south america sa' },
  { name: 'Oceania', lat: -25, lon: 140, alt: 2.5, keys: 'oceania australia' },
];

const COORDS = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

/** `60.17,24.94` or `60.17 24.94`; null when it is not a valid latitude and longitude. */
export function parseCoords(q: string): { lat: number; lon: number } | null {
  const m = COORDS.exec(q);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    return null;
  return { lat, lon };
}

const fmtCoord = (n: number) => (Math.round(n * 100) / 100).toString();

/** A country as a place: the camera frames it and the globe can filter to it. */
export function countryPlace(c: CountryEntry, score: number): Place {
  return {
    id: `country:${c.code}`,
    kind: 'country',
    name: c.name,
    sub: `${formatInt(c.count)} ${c.count === 1 ? 'node' : 'nodes'}, filters the globe to this country`,
    view: { lat: c.lat, lon: c.lon, alt: c.alt },
    cc: c.code,
    score,
  };
}

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();

function regionName(code: string): string {
  if (!code) return '';
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

const KM_PER_DEG = 111.2;

/** Nodes within `km` of a point (a coarse flat-earth distance, fine at this scale). */
export function nodesNear(store: NetworkStore, lat: number, lon: number, km: number): number {
  const t = store.nodes;
  const cos = Math.cos((lat * Math.PI) / 180);
  let n = 0;
  for (let i = 0; i < t.count; i++) {
    const la = t.lat[i]!;
    const lo = t.lon[i]!;
    if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
    const dy = la - lat;
    if (Math.abs(dy) * KM_PER_DEG > km) continue;
    let dx = lo - lon;
    if (dx > 180) dx -= 360;
    else if (dx < -180) dx += 360;
    if (Math.hypot(dx * cos, dy) * KM_PER_DEG <= km) n++;
  }
  return n;
}

function gazetteerPlaces(
  index: LocalIndex,
  store: NetworkStore | null,
  text: string,
  limit: number,
): Place[] {
  const known = new Set(index.cities.map((c) => c.lower));
  const found: { score: number; i: number }[] = [];
  GAZETTEER.forEach((g, i) => {
    if (known.has(g[0].toLowerCase())) return;
    let s = matchScore(text, g[0], { fuzzy: true });
    if (g[4]) for (const w of g[4].split(' ')) s = Math.max(s, matchScore(text, w) - 20);
    if (s > 0) found.push({ score: s, i });
  });
  found.sort((a, b) => b.score - a.score);
  return found.slice(0, limit).map(({ score, i }) => {
    const [name, cc, lat, lon] = GAZETTEER[i]!;
    const near = store ? nodesNear(store, lat, lon, 150) : null;
    const nodes =
      near === null
        ? ''
        : near > 0
          ? `${formatInt(near)} ${near === 1 ? 'node' : 'nodes'} within 150 km`
          : 'no nodes nearby';
    return {
      id: `gaz:${name.toLowerCase()}`,
      kind: 'city' as const,
      name,
      sub: [regionName(cc), nodes].filter(Boolean).join(', '),
      view: { lat, lon, alt: 0.55 },
      score: score - 2,
    };
  });
}

/** Cities, countries, continents and coordinates that match the query, best first. */
export function matchPlaces(
  index: LocalIndex,
  q: string,
  limit = 6,
  store: NetworkStore | null = null,
): Place[] {
  const text = q.trim();
  if (!text) return [];
  const out: Place[] = [];
  const coords = parseCoords(text);
  if (coords) {
    out.push({
      id: `coords:${coords.lat},${coords.lon}`,
      kind: 'coords',
      name: `${fmtCoord(coords.lat)}, ${fmtCoord(coords.lon)}`,
      sub: 'Coordinates',
      view: { lat: coords.lat, lon: coords.lon, alt: 0.6 },
      score: 100,
    });
  }
  for (const { item: c, score } of matchCities(index, text, limit)) {
    out.push({
      id: `city:${c.lower}|${c.country}`,
      kind: 'city',
      name: c.name,
      sub: `${formatInt(c.count)} ${c.count === 1 ? 'node' : 'nodes'} at this site`,
      view: { lat: c.lat, lon: c.lon, alt: c.count > 200 ? 0.42 : c.count > 30 ? 0.36 : 0.45 },
      score,
    });
  }
  out.push(...gazetteerPlaces(index, store, text, limit));
  for (const { item: c, score } of matchCountries(index, text, limit)) out.push(countryPlace(c, score));
  for (const c of CONTINENTS) {
    const s = matchScore(text, c.keys.split(' ').includes(text.toLowerCase()) ? text : c.name);
    if (s > 0)
      out.push({
        id: `continent:${c.name}`,
        kind: 'continent',
        name: c.name,
        sub: 'Continent',
        view: { lat: c.lat, lon: c.lon, alt: c.alt },
        score: s - 5,
      });
  }
  out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return out.slice(0, limit);
}
