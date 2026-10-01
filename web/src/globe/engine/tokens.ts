// Design tokens for the globe. Colors are CSS strings; scalars are plain numbers.
//
// The defaults are the `globe` block of the design system (docs/design/tokens.json, synced into
// `design-tokens.json` by `npm run tokens`), so the renderer never invents a palette of its own. The
// host app can feed its live tokens through `setTokens`, or read them from CSS custom properties with
// `tokensFromCss`. Each art direction only overrides what the design system leaves open (nebula tint,
// dusk color, neon accents); anything passed in explicitly always wins.

import design from './design-tokens.json';
import type { ArtDirection } from './types';

export interface GlobeTokens {
  /** Deep space behind the planet. */
  space: string;
  /** Sky glow color behind the planet (very subtle nebula tint). */
  nebula: string;
  /** Ocean or planet body color where no texture is used (night side / away from the sun). */
  ocean: string;
  /** Ocean color toward the sun. */
  oceanLit: string;
  /** Land dots / lines on the lit side. */
  land: string;
  /** Land dots / lines on the night side. */
  landNight: string;
  landAlphaDay: number;
  landAlphaNight: number;
  /** City lights tint. */
  lights: string;
  lightsAlpha: number;
  coast: string;
  graticule: string;
  graticuleAlpha: number;
  border: string;
  borderAlpha: number;
  /** Terminator seam color (neon art direction). */
  terminator: string;
  /** Penumbra half-width in radians. */
  terminatorWidth: number;
  /** Sky-side scattering color and strength. */
  atmoDay: string;
  atmoAlpha: number;
  /** Rim thickness as a fraction of the radius. */
  atmoWidth: number;
  atmoDusk: string;
  atmoNight: string;
  /** Hot rim on the limb that faces the sun (the "eclipse ring"). */
  rimHot: string;
  star: string;

  cumulus: string;
  nimbus: string;
  stratus: string;
  sizeCumulus: number;
  sizeNimbus: number;
  sizeStratus: number;
  haloAlpha: number;
  /** Selection reticle, focus (the design's `select`). */
  accent: string;
  hover: string;
  mine: string;
  /** Node alpha when something else is in focus. */
  dimAlpha: number;
  /** Beam heads, producer flare, the brightest event light (the design's `beam-head`). */
  block: string;
  /** Block shockwave: hot leading edge and cool tail. */
  shock: string;
  shockHot: string;
  /** App constellation arcs (the design's `app`). */
  constellation: string;
  /** Gossip packets and mesh links. */
  mesh: string;
  /** Selection-mode arc alpha. */
  meshAlpha: number;
  /** Network-wide flow alpha. */
  meshFlowAlpha: number;
  /** Watched nodes. */
  watch: string;
  /** Crit: DoS, punished, expired (the design's `status-crit`). */
  alert: string;
  /** Unreachable / left (`status-off`). */
  off: string;
  pending: string;
  /** Pre-aimed next payees. */
  aim: string;
  aimAlpha: number;
  /** At-risk nodes (past 560 blocks without a check-in). */
  risk: string;
  /** Installing app instance spinner. */
  install: string;
  /** The emission event flare. */
  emission: string;
  /** Overlay typography colors. */
  ink: string;
  inkDim: string;

  /** The Flux moon (design 7.10): the book's tonal symbol faces, Blue Wave walls, glow and ring. */
  moonStratus: string;
  moonNimbus: string;
  moonCumulus: string;
  moonSpark: string;
  moonEdge: string;
  moonEdgeHi: string;
  moonGlow: string;
  moonGlowAlpha: number;
  moonRing: string;
  moonBeam: string;
  /** Symbol height as a fraction of the short viewport side, with pixel limits. */
  moonSize: number;
  moonSizeMin: number;
  moonSizeMax: number;
  /** Seconds per lap, orbit tilt in degrees, extrusion depth as a fraction of the symbol height. */
  moonOrbitS: number;
  moonTilt: number;
  moonDepth: number;
  /** Reach of the block shockwave, degrees; the reward-cut block's second ring reaches further. */
  shockReach: number;
  shockReachEmission: number;

  /** Final exposure. */
  exposure: number;
  /** Bloom strength. */
  bloom: number;
  /** Global node size multiplier. */
  nodeScale: number;
  /** Spire height multiplier. */
  spireScale: number;
  /** Film grain amount (0 off). */
  grain: number;
  /** Chromatic aberration amount (0 off). */
  chroma: number;
}

/** [token key, design-system name]: one table serves the JSON snapshot and live CSS custom properties. */
const DESIGN_KEYS: ReadonlyArray<readonly [keyof GlobeTokens, string]> = [
  ['space', 'space'],
  ['ocean', 'ocean'],
  ['oceanLit', 'ocean-lit'],
  ['land', 'land'],
  ['landNight', 'land-night'],
  ['landAlphaDay', 'land-alpha-day'],
  ['landAlphaNight', 'land-alpha-night'],
  ['graticule', 'graticule'],
  ['graticuleAlpha', 'graticule-alpha'],
  ['border', 'border'],
  ['borderAlpha', 'border-alpha'],
  ['atmoDay', 'atmosphere'],
  ['atmoAlpha', 'atmosphere-alpha'],
  ['atmoWidth', 'atmosphere-width'],
  ['rimHot', 'rim-hot'],
  ['terminatorWidth', 'terminator-width'],
  ['lights', 'night-lights'],
  ['lightsAlpha', 'night-lights-alpha'],
  ['star', 'star'],
  ['cumulus', 'cumulus'],
  ['nimbus', 'nimbus'],
  ['stratus', 'stratus'],
  ['sizeCumulus', 'size-cumulus'],
  ['sizeNimbus', 'size-nimbus'],
  ['sizeStratus', 'size-stratus'],
  ['haloAlpha', 'halo-alpha'],
  ['pending', 'status-pending'],
  ['alert', 'status-crit'],
  ['off', 'status-off'],
  ['accent', 'select'],
  ['hover', 'hover'],
  ['mine', 'mine'],
  ['dimAlpha', 'dim-alpha'],
  ['constellation', 'app'],
  ['mesh', 'mesh'],
  ['meshAlpha', 'mesh-alpha'],
  ['meshFlowAlpha', 'mesh-flow-alpha'],
  ['shock', 'shock'],
  ['shockHot', 'shock-hot'],
  ['block', 'beam-head'],
  ['ink', 'label'],
  ['inkDim', 'label-dim'],
  ['aim', 'aim'],
  ['aimAlpha', 'aim-alpha'],
  ['risk', 'risk'],
  ['install', 'install'],
  ['emission', 'emission'],
  ['moonStratus', 'moon-stratus'],
  ['moonNimbus', 'moon-nimbus'],
  ['moonCumulus', 'moon-cumulus'],
  ['moonSpark', 'moon-spark'],
  ['moonEdge', 'moon-edge'],
  ['moonEdgeHi', 'moon-edge-hi'],
  ['moonGlow', 'moon-glow'],
  ['moonGlowAlpha', 'moon-glow-alpha'],
  ['moonRing', 'moon-ring'],
  ['moonBeam', 'moon-beam'],
  ['moonSize', 'moon-size'],
  ['moonSizeMin', 'moon-size-min'],
  ['moonSizeMax', 'moon-size-max'],
  ['moonOrbitS', 'moon-orbit-s'],
  ['moonTilt', 'moon-tilt'],
  ['moonDepth', 'moon-depth'],
  ['shockReach', 'shock-reach'],
  ['shockReachEmission', 'shock-reach-emission'],
];

const D = (design as { globe: Record<string, string | number> }).globe;

function fromDesign(g: Record<string, string | number>): Partial<GlobeTokens> {
  const out: Record<string, string | number> = {};
  for (const [key, name] of DESIGN_KEYS) if (g[name] !== undefined) out[key] = g[name];
  return out as Partial<GlobeTokens>;
}

/** Used only when a token sheet predates the moon tokens. */
const MOON_FALLBACK = {
  moonStratus: '#ffffff',
  moonNimbus: '#cccccc',
  moonCumulus: '#7e7c7c',
  moonSpark: '#ffffff',
  moonEdge: '#2b61d1',
  moonEdgeHi: '#86a1da',
  moonGlow: '#2b61d1',
  moonGlowAlpha: 0.55,
  moonRing: '#86a1da',
  moonBeam: '#ffffff',
  moonSize: 0.072,
  moonSizeMin: 48,
  moonSizeMax: 104,
  moonOrbitS: 240,
  moonTilt: 22,
  moonDepth: 0.14,
  shockReach: 62,
  shockReachEmission: 88,
};

const BASE: GlobeTokens = {
  ...MOON_FALLBACK,
  // Everything the design system defines comes from its tokens ...
  ...(fromDesign(D) as GlobeTokens),
  // ... and what it leaves open is owned by the renderer.
  // Blue Wave: the planet's light stays in the brand family (Flux blue, cool white). Warm tones are
  // reserved for the Stratus tier, so even the sunset band is a pale blue.
  nebula: '#0a1a45',
  coast: '#86a1da',
  terminator: '#86a1da',
  atmoDusk: '#9db8ee',
  atmoNight: '#1b44a3',
  watch: '#ffffff',
  exposure: 1.0,
  bloom: 0.5,
  nodeScale: 1.0,
  spireScale: 1.0,
  grain: 0.02,
  chroma: 0.00014,
};

const OVERRIDES: Record<ArtDirection, Partial<GlobeTokens>> = {
  // The design system's native look.
  dotmatrix: {
    bloom: 0.5,
  },
  // Photographic earth: the textures carry land and ocean, so only light and atmosphere are tuned.
  marble: {
    atmoDay: '#3f73e0',
    atmoDusk: '#a9c2f4',
    atmoNight: '#1f3fb0',
    bloom: 0.46,
  },
  // Vector display: hard coastlines, a twilight band, stronger bloom and fringing. Its light stays in the
  // brand's blues (the terminator and the dusk were magenta, which is not a Flux colour).
  neon: {
    space: '#02030a',
    ocean: '#03050f',
    land: '#23d3ff',
    landNight: '#0f5a8c',
    coast: '#3be6ff',
    graticule: '#2a4fd0',
    terminator: '#86a1da',
    atmoDay: '#2a6bff',
    atmoDusk: '#4f7ad4',
    atmoNight: '#2a1aa8',
    bloom: 0.62,
    chroma: 0.00028,
  },
};

/**
 * The token set for an art direction: the design system's values, then the host's live tokens (if
 * any), then what the art direction itself needs to look like itself.
 */
export function defaultTokens(art: ArtDirection, design: Partial<GlobeTokens> = {}): GlobeTokens {
  return { ...BASE, ...design, ...OVERRIDES[art] };
}

/** Maps a `globe` block (docs/design/tokens.json shape, names without the `--globe-` prefix) onto tokens. */
export function tokensFromDesign(globe: Record<string, string | number>, into: GlobeTokens): GlobeTokens {
  return { ...into, ...fromDesign(globe) };
}

/**
 * Reads tokens from CSS custom properties, e.g. `--globe-cumulus`, `--globe-select`. Missing
 * properties keep their current values, so a partial token sheet is fine.
 */
export function tokensFromCss(el: Element, into: GlobeTokens, prefix = '--globe-'): GlobeTokens {
  const cs = getComputedStyle(el);
  const out: Record<string, string | number> = { ...into };
  for (const [key, name] of DESIGN_KEYS) {
    const v = cs.getPropertyValue(prefix + name).trim();
    if (!v) continue;
    out[key] =
      typeof (into as unknown as Record<string, unknown>)[key] === 'number' ? Number.parseFloat(v) : v;
  }
  return out as unknown as GlobeTokens;
}
