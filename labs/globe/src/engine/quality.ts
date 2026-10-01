// Quality profiles. `auto` starts from the best profile the device plausibly handles and the
// governor in the engine walks render scale (and finally the profile) down when frames run long.

import type { QualityLevel } from './types';

export interface QualityProfile {
  name: 'high' | 'medium' | 'low';
  /** Cap on device pixel ratio. */
  maxDpr: number;
  /** MSAA samples on the HDR scene target. */
  msaa: number;
  bloomLevels: number;
  chroma: boolean;
  grain: boolean;
  starCount: number;
  sphereSegments: number;
  atmoSteps: number;
  clouds: boolean;
  nebula: boolean;
  /** Dot-matrix lattice size (points on the sphere before the land filter). */
  dotLattice: number;
  maxPackets: number;
  maxArcs: number;
  maxRings: number;
  /** Capacity of the faint mesh-link veil. */
  maxLinks: number;
  /** Fraction of mesh edges kept when sampling packets and the faint veil. */
  meshDensity: number;
  /** The Flux moon is drawn flat (design 7.10.10): tonal faces, ring and relay, no extrusion, glow or sweep. */
  moonLite: boolean;
}

export const PROFILES: Record<'high' | 'medium' | 'low', QualityProfile> = {
  high: {
    name: 'high',
    maxDpr: 2,
    msaa: 4,
    bloomLevels: 6,
    chroma: true,
    grain: true,
    starCount: 9000,
    sphereSegments: 128,
    atmoSteps: 10,
    clouds: true,
    nebula: true,
    dotLattice: 160000,
    maxPackets: 4096,
    maxArcs: 1024,
    maxRings: 384,
    maxLinks: 14000,
    meshDensity: 1,
    moonLite: false,
  },
  medium: {
    name: 'medium',
    maxDpr: 1.5,
    msaa: 2,
    bloomLevels: 5,
    chroma: true,
    grain: false,
    starCount: 6000,
    sphereSegments: 96,
    atmoSteps: 7,
    clouds: true,
    nebula: true,
    dotLattice: 100000,
    maxPackets: 2048,
    maxArcs: 768,
    maxRings: 256,
    maxLinks: 6000,
    meshDensity: 0.6,
    moonLite: false,
  },
  low: {
    name: 'low',
    maxDpr: 1,
    msaa: 0,
    bloomLevels: 4,
    chroma: false,
    grain: false,
    starCount: 3000,
    sphereSegments: 64,
    atmoSteps: 4,
    clouds: false,
    nebula: false,
    dotLattice: 50000,
    maxPackets: 768,
    maxArcs: 384,
    maxRings: 128,
    maxLinks: 1500,
    meshDensity: 0.25,
    moonLite: true,
  },
};

/** Picks a starting profile from coarse device hints. */
export function autoProfile(): 'high' | 'medium' | 'low' {
  if (typeof navigator === 'undefined') return 'medium';
  const ua = navigator.userAgent || '';
  const mobile = /Android|iPhone|iPad|Mobile/i.test(ua) || (navigator.maxTouchPoints ?? 0) > 1 && /Macintosh/.test(ua);
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8;
  if (mobile || cores <= 4 || mem <= 4) return mobile ? 'low' : 'medium';
  return 'high';
}

export function resolveQuality(level: QualityLevel): QualityProfile {
  if (level === 'auto') return PROFILES[autoProfile()];
  return PROFILES[level];
}
