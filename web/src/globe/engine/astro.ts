// Where is the sun? Low-precision solar position (good to about a hundredth of a degree), from the
// standard mean-element series in the Astronomical Almanac. Enough to place the terminator to the
// pixel at any zoom this renderer allows.

import { DEG, RAD } from './math';

const J2000_UNIX_MS = 946728000000; // 2000-01-01T12:00:00Z

export interface SubsolarPoint {
  /** Declination, degrees (north positive). */
  lat: number;
  /** Degrees east of Greenwich. */
  lon: number;
}

/** Subsolar point for a UTC timestamp in milliseconds. Writes into `out` (no allocation). */
export function subsolarPoint(utcMs: number, out: SubsolarPoint): SubsolarPoint {
  const n = (utcMs - J2000_UNIX_MS) / 86400000; // days since J2000.0
  const L = (280.46 + 0.9856474 * n) % 360; // mean longitude
  const g = (357.528 + 0.9856003 * n) * DEG; // mean anomaly
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG; // ecliptic longitude
  const eps = (23.439 - 0.0000004 * n) * DEG; // obliquity
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)); // right ascension
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmstDeg = ((18.697374558 + 24.06570982441908 * n) % 24) * 15; // Greenwich mean sidereal time
  let lon = (ra * RAD - gmstDeg) % 360;
  if (lon > 180) lon -= 360;
  if (lon < -180) lon += 360;
  out.lat = dec * RAD;
  out.lon = lon;
  return out;
}

/** Unit vector toward the sun in engine world space (+Y north, lon 0 toward +Z). */
export function sunVector(utcMs: number, out: { x: number; y: number; z: number }): void {
  const sp = subsolarPoint(utcMs, scratch);
  const la = sp.lat * DEG;
  const lo = sp.lon * DEG;
  const c = Math.cos(la);
  out.x = c * Math.sin(lo);
  out.y = Math.sin(la);
  out.z = c * Math.cos(lo);
}

const scratch: SubsolarPoint = { lat: 0, lon: 0 };
