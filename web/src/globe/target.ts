// The globe as the app sees it: `GlobeTarget`, the typed surface of the engine that the bindings, the
// frame (the boot, the chrome, the overlays) and the anchor system call. It is a structural subset of
// `GlobeEngine`, so the real engine satisfies it and the tests pass a fake; nothing outside `web/src/globe`
// needs to reach into the engine or cast it. Types only: importing this file loads no three.js.
//
// Groups:
//   data         setNodes, updateNodes, setMesh, updateMesh, setMeshMode, setFilter, setWatched
//   selection    select, setHover, nodeInfo
//   camera       flyTo, flyToNode, flyToSelection, home, orbitStep, turnStep, zoomStep, setInset,
//                setViewScale, framing
//   projection   project, projectNode, labelAnchors, setLabelAnchors, getHubs, nodeDensity
//   the moon     setMoon, moonState, moonClick, setBeat, setMoonStatus, seedMoonChain, setMoonPark
//   the boot     setMoonBoot, setReveal (a node or a lat/lon origin; `aperture` hides the planet outside
//                the wave), setViewScale (the drift in and the settle)
//   look         setArtDirection, setQuality, setReduced, setEffects, setMode
//   events       on('select' | 'hover' | 'moonhover' | 'moonclick' | 'frame' | 'zoomBand' | ...)

import type { EffectSink } from '../choreo/effects';
import type { Rect } from './engine/framing';
import type { HubInfo, LabelAnchor, LabelAnchorInput, ScreenPoint } from './engine/GlobeEngine';
import type { MoonBoot, MoonState } from './engine/moon/moon';
import type {
  ArtDirection,
  EffectToggles,
  EngineEvents,
  EngineMode,
  EngineStats,
  NodeColumns,
  NodeDelta,
  NodeFilter,
  PickInfo,
  QualityLevel,
} from './engine/types';

export type { HubInfo, LabelAnchor, LabelAnchorInput, MoonBoot, MoonState, Rect, ScreenPoint };

/** A reveal origin: a node (engine id) or a point on the surface. */
export type RevealOrigin = number | { lat: number; lon: number };

/** Where the moon parks as a small flat symbol (CSS px; `size` is the symbol's height, 24 by default). */
export interface MoonPark {
  x: number;
  y: number;
  size?: number;
}

/** The planet's place on screen: the free area, the disc right now and at the home zoom (CSS px). */
export interface GlobeFraming {
  free: Rect;
  center: { x: number; y: number };
  radius: number;
  homeRadius: number;
  fit: number;
}

/** Screen-space node density, for overlays that keep off the clusters (`count` is nodes in a box, CSS px). */
export interface NodeDensity {
  count(x0: number, y0: number, x1: number, y1: number): number;
}

/** The part of `GlobeEngine` the app talks to (bindings, canvas, anchors, the frame). */
export interface GlobeTarget {
  readonly sink: EffectSink;
  readonly stats: EngineStats;
  readonly reduced: boolean;
  /** The home zoom: the camera range (globe radii) of the home view for this viewport. */
  readonly homeRange: number;

  // ---- data ----
  setNodes(cols: NodeColumns, opts?: { animate?: boolean; intro?: boolean }): void;
  updateNodes(delta: NodeDelta): void;
  setMesh(a: ArrayLike<number>, b: ArrayLike<number>): void;
  updateMesh(delta: {
    addA?: ArrayLike<number>;
    addB?: ArrayLike<number>;
    removeA?: ArrayLike<number>;
    removeB?: ArrayLike<number>;
  }): void;
  setMeshMode(mode: 'off' | 'selection' | 'flow'): void;
  setFilter(filter: NodeFilter | null, allowIds?: ArrayLike<number> | null): void;
  setWatched(ids: ArrayLike<number>): void;
  showAppConstellation(ids: ArrayLike<number> | null, opts?: { name?: string; fly?: boolean }): void;
  clearAppConstellation(): void;

  // ---- selection ----
  select(id: number | null, opts?: { fly?: boolean; alt?: number; silent?: boolean }): void;
  setHover(id: number | null): void;
  nodeInfo(id: number): PickInfo | null;

  // ---- camera ----
  /**
   * Flies so the point lands exactly at the free area's centre. `alt` is the range in globe radii. `arc` (0 to 1,
   * default 1) scales the zoom-out a long flight makes on its way: 0 keeps the start and end zoom throughout, so
   * the planet only turns.
   */
  flyTo(
    lat: number,
    lon: number,
    alt?: number,
    opts?: { tilt?: number; heading?: number; duration?: number; radius?: number; arc?: number },
  ): Promise<boolean>;
  /** Flies to a node (engine id) so it lands at the free area's centre; the selection then stays locked there. */
  flyToNode(id: number, alt?: number): Promise<boolean>;
  /** The F key: flies back to the selection. False when nothing is selected. */
  flyToSelection(): boolean;
  /** Eases back to the home view (no pitch, north up, the home zoom, framed in the free area). */
  home(): Promise<boolean>;
  /** Arrow keys: turns the globe by `x`, `y` steps (screen directions: +x brings the east into view). */
  orbitStep(x: number, y: number): void;
  /** Shift and arrows: turns the heading by `heading` steps and the pitch by `tilt` steps. */
  turnStep(heading: number, tilt: number): void;
  /** `+` and `-`: zooms by `steps` (positive is in), holding the selection still while it is on screen. */
  zoomStep(steps: number): void;
  setInset(inset: { left: number; right: number; top: number; bottom: number }, ms?: number): void;
  /** Scales the framed planet (1 the framing's size), eased over `ms`: the boot's drift in and settle. */
  setViewScale(scale: number, ms?: number): void;
  framing(): GlobeFraming;
  setMode(mode: EngineMode): void;

  // ---- projection ----
  projectNode(id: number, out: ScreenPoint): boolean;
  project(lat: number, lon: number, radius: number, out: ScreenPoint): boolean;
  setLabelAnchors(list: readonly LabelAnchorInput[]): void;
  labelAnchors(): readonly LabelAnchor[];
  /** The biggest hubs (co-location sites), largest first. */
  getHubs(max?: number): readonly HubInfo[];
  /** Nodes on screen this frame, for overlays that keep off dense clusters. */
  nodeDensity(): NodeDensity;

  // ---- the moon ----
  setMoon(opts: {
    on?: boolean;
    mode?: 'auto' | 'companion' | 'orbit';
    scale?: number;
    padTop?: number;
  }): void;
  moonState(): MoonState;
  moonClick(): void;
  setBeat(v: number): void;
  setMoonStatus(status: 'live' | 'late' | 'offline' | 'archive'): void;
  seedMoonChain(blocks: readonly { height: number; time: number }[]): void;
  /** Parks the moon as a small flat symbol at a screen point (the phone header's Beat mini); null sends it back to its orbit. */
  setMoonPark(at: MoonPark | null): void;

  // ---- the boot ----
  /** The boot's symbol (design 7.10.9), drawn by the moon's own code; null hands over to the orbit. */
  setMoonBoot(boot: MoonBoot | null): void;
  /** The reveal wave from a node or a point; `aperture` keeps the planet hidden outside it. Null ends it. */
  setReveal(origin: RevealOrigin | null, thetaRad?: number, opts?: { aperture?: boolean }): void;

  // ---- look ----
  setArtDirection(art: ArtDirection): void;
  setQuality(level: QualityLevel): void;
  setReduced(reduced: boolean): void;
  setEffects(partial: Partial<EffectToggles>): void;

  // ---- input and events ----
  notifyKey(): void;
  on<K extends keyof EngineEvents>(type: K, cb: (payload: EngineEvents[K]) => void): () => void;
}
