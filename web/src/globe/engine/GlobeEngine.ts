// The globe engine: owns the renderer, the scene, the camera rig and every layer, and exposes the
// small imperative API the app talks to. No framework, no per-frame allocation.

import * as THREE from 'three';
import { Activity } from './activity';
import { type AmbientOptions, Director, type SceneKind } from './ambient/director';
import { drawMoustache } from './ambient/egg';
import { type MoonShotKind, MoonShots } from './ambient/moonShots';
import { AssetStore } from './assetstore';
import { subsolarPoint, sunVector } from './astro';
import { CameraRig, rangeToFit } from './camera';
import { Choreographer, type ChoreoHost } from './choreographer';
import { Controls } from './controls';
import { type EffectSink, Effects } from './effects';
import { computeFraming, DEFAULT_FRAMING, type Framing, type FramingSpec, type Rect } from './framing';
import { Fx } from './fx';
import { Atmosphere } from './layers/atmosphere';
import type { GlobeBody } from './layers/body';
import { BorderLayer } from './layers/borders';
import { DotMatrixBody } from './layers/dotmatrix';
import { MarbleBody } from './layers/marble';
import { NeonBody } from './layers/neon';
import { RayLayer } from './layers/rays';
import { RibbonLayer, RibbonStyle } from './layers/ribbons';
import { RingKind, RingLayer } from './layers/rings';
import { Sky } from './layers/sky';
import { lensAtDistance } from './lens';
import { angleBetween, arcLift, clamp, DEG, damp, hash01, RAD, smoothstep } from './math';
import {
  Moon,
  type MoonBoot,
  type MoonOptions,
  type MoonState,
  type MoonStatus,
  type MoonView,
} from './moon/moon';
import type { Inset } from './moon/orbit';
import { ClusterLayer } from './nodes/clusterLayer';
import { computeLayout, slotPosition } from './nodes/layout';
import { MeshStore } from './nodes/mesh';
import { NodeLayer } from './nodes/nodeLayer';
import { Picker, type PickResult } from './nodes/picking';
import { NO_CLUSTER, NodeStore } from './nodes/store';
import { MeshVeil } from './nodes/veil';
import { Post, type PostParams } from './post';
import { PROFILES, type QualityProfile, resolveQuality } from './quality';
import { defaultTokens, type GlobeTokens } from './tokens';
import { Traffic } from './traffic';
import {
  type ArtDirection,
  type BordersMode,
  type CameraInfo,
  DEFAULT_EFFECTS,
  type EffectToggles,
  type EngineEvents,
  type EngineMode,
  type EngineStats,
  type GlobeEvent,
  type GlobeOptions,
  GlobeUnsupportedError,
  type NodeColumns,
  type NodeDelta,
  type NodeFilter,
  type NodeRecord,
  NodeState,
  type PickInfo,
  type QualityLevel,
  type ZoomBand,
} from './types';
import { applyTokens, createSharedUniforms, type SharedUniforms } from './uniforms';

type Listener<K extends keyof EngineEvents> = (payload: EngineEvents[K]) => void;

const Y_AXIS = new THREE.Vector3(0, 1, 0);

export interface HubInfo {
  cluster: number;
  loc: number;
  lat: number;
  lon: number;
  count: number;
  /** Nodes per tier: cumulus, nimbus, stratus. */
  tiers: [number, number, number];
}

export interface AimAnchor {
  id: number;
  slot: number;
  tier: number;
  x: number;
  y: number;
  visible: boolean;
}

export interface ScreenPoint {
  x: number;
  y: number;
  visible: boolean;
  depth: number;
}

/** What a registered label anchor stands for (the UI decides how each kind looks). */
export type LabelAnchorKind = 'city' | 'country' | 'hub' | 'node' | 'cluster' | 'custom';

/**
 * A world point the UI wants on screen every frame: a city or country label, a tooltip, a window
 * tether. Either a surface position (`lat`, `lon`, lifted `alt` globe radii) or a node (`nodeId`,
 * following its display position, so it rides the stack and fan layout).
 */
export interface LabelAnchorInput {
  id: string;
  kind?: LabelAnchorKind;
  lat?: number;
  lon?: number;
  /** Height above the surface in globe radii (default 0.01). */
  alt?: number;
  nodeId?: number;
  text?: string;
}

/** A registered anchor's screen projection for the current frame (CSS pixels, canvas space). */
export interface LabelAnchor {
  id: string;
  kind: LabelAnchorKind;
  text: string;
  x: number;
  y: number;
  /** False when the point is behind the planet (past the limb), off screen, or its node is gone. */
  visible: boolean;
  /** NDC depth (-1 near to 1 far). */
  depth: number;
  /** Cosine between the point's surface normal and the direction to the camera: 1 facing, 0 at the limb. Labels fade with it. */
  facing: number;
}

const FADE_OUT = 2.0;

export class GlobeEngine {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  /** Drawn after everything else with its own depth: the moon (the planet hides it analytically, see moon/occlusion.ts). */
  readonly overlayScene = new THREE.Scene();
  readonly rig = new CameraRig();
  readonly u: SharedUniforms = createSharedUniforms();
  readonly assets: AssetStore;
  /** Node data. Exposed read-only for the host (labels, inspectors); mutate through the API. */
  readonly nodes = new NodeStore(16384);
  readonly mesh = new MeshStore();

  tokens: GlobeTokens;
  /** The host's live design tokens (from CSS or a token file); art directions sit on top of these. */
  private designTokens: Partial<GlobeTokens>;
  artDirection: ArtDirection;
  effects: EffectToggles;
  profile: QualityProfile;
  qualityLevel: QualityLevel;
  mode: EngineMode = 'explore';
  reducedMotion = false;
  /** Resolves a lat/lon to a place name for captions (supplied by the host). */
  nameOf: (lat: number, lon: number) => string = () => '';

  private readonly post: Post;
  private readonly sky: Sky;
  private readonly atmosphere: Atmosphere;
  /** Country borders and state lines, in whichever look is on (layers/borders.ts). */
  readonly borders: BorderLayer;
  private readonly bodies: Partial<Record<ArtDirection, GlobeBody>> = {};
  private readonly controls: Controls;
  private readonly listeners = new Map<keyof EngineEvents, Set<Listener<keyof EngineEvents>>>();
  private readonly opts: GlobeOptions;

  private nodeLayer: NodeLayer;
  private clusterLayer: ClusterLayer;
  private arcs: RibbonLayer;
  private held: RibbonLayer;
  private packets: RibbonLayer;
  private links: RibbonLayer;
  private rings: RingLayer;
  readonly fx: Fx;
  readonly activity = new Activity();
  readonly choreo: Choreographer;
  /**
   * The engine's effect vocabulary as an `EffectSink` (effects.ts): low-level, immediate commands that
   * map one to one onto an app choreographer's calls (`beat`, `uplink`, `moonFlare`, `downlink`,
   * `payoutLanded`, `devFund`, `heartbeats`, `pulse`, `aim`, `clearAim`, `app`, `links`, `summary`,
   * `reorg`, `recap`). `choreo` is an optional layer on top of it for the standalone lab.
   */
  readonly sink: Effects & EffectSink;
  /** The Flux moon: the brand symbol in orbit. Every block passes through it. */
  readonly moon: Moon;
  private rays: RayLayer;
  private readonly moonPx = { x: 0, y: 0, r: 0, visible: false };
  private insetNow: Inset = { left: 0, right: 0, top: 0, bottom: 0 };
  private insetFrom: Inset = { left: 0, right: 0, top: 0, bottom: 0 };
  private insetTo: Inset = { left: 0, right: 0, top: 0, bottom: 0 };
  private insetT = 1;
  private insetDur = 0.3;
  private readonly moonViewBuf: MoonView = {
    camera: null as unknown as THREE.PerspectiveCamera,
    up: new THREE.Vector3(0, 1, 0),
    cssW: 1,
    cssH: 1,
    pxScale: 1,
    projScale: 1,
    planetR: 100,
    surf: 3,
    inset: { left: 0, right: 0, top: 0, bottom: 0 },
  };
  private moonHovered = false;
  /** Camera poses for the moon shots (shared by `viewMoon` and the ambient director). */
  readonly shots = new MoonShots();
  private framed = false;
  /** Framing clearances and the optical lift (framing.ts); the moon may widen `sideRoom`. */
  readonly framingSpec: FramingSpec = { ...DEFAULT_FRAMING };
  private frameNow: Framing = computeFraming({
    w: 1,
    h: 1,
    inset: { left: 0, right: 0, top: 0, bottom: 0 },
    tanHalfFov: 0.3,
    homeRange: 3.6,
  });
  private moonView: { kind: MoonShotKind; t0: number; dur: number; at: number | null; rate: number } | null =
    null;
  private traffic: Traffic;
  private veil: MeshVeil;
  private picker: Picker;
  director: Director | null = null;
  /** Multipliers the ambient director applies per scene (mesh veil and traffic density, bloom). */
  readonly ambientBoost = { mesh: 1, bloom: 1, atmo: 1 };

  private raf = 0;
  private running = false;
  private disposed = false;
  private hidden = false;
  private readonly startMs = performance.now();
  private lastMs = 0;
  time = 0;

  // sizing
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  private renderScale = 1;
  private resizeDirty = true;
  private readonly ro: ResizeObserver | null;

  // sun clock
  private sunAnchorSim = Date.now();
  private sunAnchorReal = Date.now();
  private sunRate = 1;
  private sunFrozen: number | null = null;
  readonly sub = { lat: 0, lon: 0 };

  private readonly mql: MediaQueryList | null;

  // stats
  private readonly statsObj: EngineStats = {
    fps: 0,
    frameMs: 0,
    cpuMs: 0,
    drawCalls: 0,
    triangles: 0,
    nodes: 0,
    dying: 0,
    clusters: 0,
    arcs: 0,
    packets: 0,
    rings: 0,
    queued: 0,
    suppressed: 0,
    dpr: 1,
    renderScale: 1,
    quality: 'high',
    geometries: 0,
    textures: 0,
  };
  private fpsFrames = 0;
  private fpsT = 0;
  private slowT = 0;
  private calmT = 0;
  private lastDowngrade = -99;
  private fade = 0;
  /** The director's own fade (reduced-motion ambient cross-fades between still compositions), 0 black .. 1 clear. */
  private sceneFade = 1;
  private sceneFadeTarget = 1;
  private sceneFadeSeconds = 0.4;
  private contextLost = false;
  /** Engine time of the last pointer, wheel or key input (for the idle drift). */
  private lastInputT = 0;
  private bandNow: ZoomBand = 0;
  private readonly camSent = { lat: 1e9, lon: 1e9, heading: 1e9, range: -1, tilt: -1 };
  private readonly camInfo: CameraInfo = { lat: 0, lon: 0, heading: 0, range: 0, tilt: 0, size: 0, band: 0 };
  private readonly camTmp = { lat: 0, lon: 0, heading: 0 };
  /**
   * Explore mode turns the globe slowly (1.2 degrees per second) after 20 s without input, east to west
   * of the camera, like the real rotation. Never under reduced motion, and never while a node is
   * selected or an app constellation is shown. Hosts set this to false while a window holds focus.
   */
  idleDrift = true;

  // layout
  private layoutFan = -1;
  private layoutSpacing = 0;
  private layoutAnimating = true;
  /** The lens (lens.ts) at the camera's own distance to the surface: 0 at the global view, 1 up close. */
  private lensNow = 0;
  private reapT = 0;
  private hubsCache: HubInfo[] = [];
  private hubsDirty = true;
  private hubsAt = 0;

  // interaction state
  private hoverX = -1;
  private hoverY = -1;
  private hoverInside = false;
  private hoverDirty = false;
  private hoverSlot = -1;
  private hoverCluster = -1;
  private selectedSlot = -1;
  private selectedId = 0;
  private selectedCluster = -1;
  private selHandles: number[] = [];
  private selStarts: number[] = [];
  /** Beacon pieces of the current selection: held ribbons (pillar, leaders) and held rings with their start times. */
  private beaconHandles: number[] = [];
  private beaconRings: number[] = [];
  private beaconPillar = -1;
  private beaconPillarStart = 0;
  private beaconLift = 0.22;
  private focusTarget = 0;
  /** When true, a selected node dims everything outside its neighbourhood to the full dim alpha. */
  private focusOnly = false;
  private filterActive = false;
  private filterSpec: NodeFilter | null = null;
  private filterAllow: Set<number> | null = null;
  private filterT = 1;
  private readonly pickScratch: PickResult = { slot: -1, cluster: -1, column: false, x: 0, y: 0 };
  private watched: number[] = [];

  // constellation
  private conName = '';
  private conSlots: number[] = [];
  /** Clusters (hubs) that hold at least one member of the active constellation; their spires light up. */
  private readonly conHubs = new Set<number>();
  private conHandles = new Map<number, { h: number; start: number }>();
  private conActive = false;

  constructor(canvas: HTMLCanvasElement, opts: GlobeOptions = {}) {
    this.canvas = canvas;
    this.opts = opts;
    this.artDirection = opts.artDirection ?? 'marble';
    this.qualityLevel = opts.quality ?? 'auto';
    this.profile = resolveQuality(this.qualityLevel);
    this.effects = { ...DEFAULT_EFFECTS, ...(opts.effects ?? {}) };
    this.designTokens = { ...(opts.tokens ?? {}) };
    this.tokens = defaultTokens(this.artDirection, this.designTokens);

    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new GlobeUnsupportedError('WebGL2 is not available');
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      context: gl,
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(0x000000, 1);

    this.mql =
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    this.reducedMotion = (opts.respectReducedMotion ?? true) && !!this.mql?.matches;
    this.mql?.addEventListener?.('change', this.onMotionPref);

    applyTokens(this.u, this.tokens);
    this.u.uReduced.value = this.reducedMotion ? 1 : 0;

    this.assets = new AssetStore(
      this.renderer,
      opts.assetBase ?? './',
      this.profile.name !== 'low',
      this.profile.clouds,
    );

    this.post = new Post(this.renderer);
    this.sky = new Sky(this.renderer, this.u, opts.seed ?? 7, this.profile.starCount, this.tokens);
    this.scene.add(this.sky.group);

    this.ensureBody(this.artDirection);
    // The low tier (the lite level, the governor's last step, software GL) draws country borders only.
    this.borders = new BorderLayer(
      this.assets,
      this.u,
      this.tokens,
      this.artDirection,
      opts.borders ?? 'states',
      this.profile.name !== 'low',
    );
    this.scene.add(this.borders.group);
    this.atmosphere = new Atmosphere(this.u, this.tokens, this.profile.atmoSteps);
    this.scene.add(this.atmosphere.mesh);

    // Data layers
    this.nodeLayer = new NodeLayer(this.nodes, this.u);
    this.clusterLayer = new ClusterLayer(this.nodes, this.u);
    this.arcs = new RibbonLayer(this.u, this.profile.maxArcs, 40, 41);
    this.held = new RibbonLayer(this.u, 768, 40, 40);
    this.packets = new RibbonLayer(this.u, this.profile.maxPackets, 8, 42);
    this.links = new RibbonLayer(this.u, this.profile.maxLinks, 10, 38);
    this.rings = new RingLayer(this.u, this.profile.maxRings);
    this.rays = new RayLayer(this.u, 48, 43);
    this.moon = new Moon(this.u, { lite: this.profile.moonLite, ...(opts.moon ?? {}) });
    this.moon.setTokens(this.tokens);
    this.moon.setArt(this.artDirection, true);
    this.scene.add(
      this.clusterLayer.mesh,
      this.nodeLayer.mesh,
      this.links.mesh,
      this.held.mesh,
      this.arcs.mesh,
      this.packets.mesh,
      this.rings.mesh,
      this.rays.mesh,
      this.moon.group,
    );
    // The beams' heads are drawn after the moon's body, so a head that leaves or lands on a piece shows on its face.
    this.overlayScene.add(this.moon.overlay, this.rays.head);

    this.fx = new Fx({
      store: this.nodes,
      rings: this.rings,
      arcs: this.arcs,
      packets: this.packets,
      links: this.links,
      rays: this.rays,
      u: this.u,
      rig: this.rig,
      activity: this.activity,
    });
    this.fx.reduced = this.reducedMotion;
    this.rig.reduced = this.reducedMotion;
    const host = this.choreoHost();
    this.sink = new Effects(host);
    this.choreo = new Choreographer(host, this.sink);
    this.veil = new MeshVeil(this.nodes, this.mesh, this.links, this.fx, this.rig);
    this.traffic = new Traffic(this.nodes, this.mesh, this.fx, this.rig, this.veil);
    this.picker = new Picker(this.nodes, this.rig);

    this.controls = new Controls(canvas, this.rig, {
      onHover: (x, y, inside) => {
        this.hoverX = x;
        this.hoverY = y;
        this.hoverInside = inside;
        this.hoverDirty = true;
      },
      onClick: (x, y) => this.handleClick(x, y),
      onDoubleClick: (x, y) => this.handleDoubleClick(x, y),
      onHome: () => {
        if (this.mode === 'explore') void this.home();
      },
      onZoomAt: (x, y) => this.zoomAnchorAt(x, y),
      onWake: (kind, x, y) => this.handleWake(kind, x, y),
      onInteract: () => {
        this.lastInputT = this.time;
        this.director?.interrupt();
        if (this.mode === 'explore') {
          this.moonView = null;
          this.rig.releaseFree(7);
        }
      },
    });
    this.controls.enabled = opts.interactive ?? true;

    this.ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => (this.resizeDirty = true)) : null;
    this.ro?.observe(canvas);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.hidden = document.hidden;

    this.setEffects({});
    this.setMode(opts.mode ?? 'explore');
    this.start();
  }

  // ---- events -----------------------------------------------------------------------------

  private wakeTravel = 0;
  private wakeX = -1;
  private wakeY = -1;
  private wakeGraceUntil = 0;

  /** Pointer moves wake the screensaver after 8 px of travel; presses and wheel turns wake it at once. */
  private handleWake(kind: 'move' | 'press' | 'wheel' | 'key', x: number, y: number): void {
    if (this.mode !== 'ambient') return;
    if (performance.now() < this.wakeGraceUntil) return;
    if (kind === 'move') {
      if (this.wakeX >= 0) this.wakeTravel += Math.hypot(x - this.wakeX, y - this.wakeY);
      this.wakeX = x;
      this.wakeY = y;
      if (this.wakeTravel < 8) return;
    }
    this.wakeTravel = 0;
    this.emit('wake', { kind });
  }

  /** Forwards a keyboard event from the host (the engine does not own the document keyboard). */
  notifyKey(): void {
    this.lastInputT = this.time;
    this.handleWake('key', 0, 0);
  }

  on<K extends keyof EngineEvents>(type: K, cb: Listener<K>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(cb as Listener<keyof EngineEvents>);
    return () => set?.delete(cb as Listener<keyof EngineEvents>);
  }

  emit<K extends keyof EngineEvents>(type: K, payload: EngineEvents[K]): void {
    const set = this.listeners.get(type);
    if (!set || set.size === 0) return;
    for (const cb of set) (cb as Listener<K>)(payload);
  }

  // ---- configuration ----------------------------------------------------------------------

  private ensureBody(art: ArtDirection): GlobeBody {
    let b = this.bodies[art];
    if (!b) {
      const seg = this.profile.sphereSegments;
      if (art === 'marble') b = new MarbleBody(this.assets, this.u, this.tokens, seg);
      else if (art === 'dotmatrix')
        b = new DotMatrixBody(this.assets, this.u, this.tokens, this.profile.dotLattice, seg);
      else b = new NeonBody(this.assets, this.u, this.tokens, seg);
      this.bodies[art] = b;
      this.scene.add(b.group);
    }
    return b;
  }

  setArtDirection(art: ArtDirection, resetTokens = true): void {
    this.artDirection = art;
    if (resetTokens) this.tokens = defaultTokens(art, this.designTokens);
    const body = this.ensureBody(art);
    for (const k of Object.keys(this.bodies) as ArtDirection[]) this.bodies[k]?.setVisible(k === art);
    body.setVisible(true);
    this.moon?.setArt(art);
    this.borders?.setArt(art);
    this.setTokens({});
  }

  /** Country borders, or those with state and province lines, or neither. State lines never draw on the low tier. */
  setBorders(mode: BordersMode): void {
    this.borders.setMode(mode);
  }

  /** Feeds the design system's tokens (the `--globe-*` group). The active art direction keeps its own look where it needs to. */
  setDesignTokens(t: Partial<GlobeTokens>): void {
    this.designTokens = { ...this.designTokens, ...t };
    this.setArtDirection(this.artDirection, true);
  }

  setTokens(partial: Partial<GlobeTokens>): void {
    this.tokens = { ...this.tokens, ...partial };
    applyTokens(this.u, this.tokens);
    this.sky.setTokens(this.tokens);
    this.atmosphere.setTokens(this.tokens);
    this.moon?.setTokens(this.tokens);
    this.borders?.setTokens(this.tokens);
    for (const k of Object.keys(this.bodies) as ArtDirection[]) this.bodies[k]?.setTokens(this.tokens);
    this.layoutFan = -1;
  }

  setEffects(partial: Partial<EffectToggles>): void {
    this.effects = { ...this.effects, ...partial };
    this.u.uNightLights.value = this.effects.nightLights ? 1 : 0;
    this.u.uClouds.value = this.effects.clouds ? 1 : 0;
    this.u.uTerminator.value = this.effects.terminator ? 1 : 0;
    this.u.uAtmo.value = this.effects.atmosphere ? this.ambientBoost.atmo : 0;
    this.sky.setVisible(this.effects.stars, this.profile.nebula);
    this.applyMeshFlags();
    this.layoutFan = -1;
  }

  private applyMeshFlags(): void {
    const flow = this.effects.mesh && this.meshMode === 'flow';
    this.veil.enabled = flow;
    this.traffic.enabled = flow;
    this.traffic.focusEnabled = this.effects.mesh;
    this.links.mesh.visible = flow && this.links.high > 0;
  }

  setQuality(level: QualityLevel): void {
    this.qualityLevel = level;
    this.profile = resolveQuality(level);
    this.moon.set({ lite: this.profile.moonLite });
    this.atmosphere.setSteps(this.profile.atmoSteps);
    this.borders.setStatesAllowed(this.profile.name !== 'low');
    this.renderScale = 1;
    this.resizeDirty = true;
  }

  setMode(mode: EngineMode, opts: AmbientOptions = {}): void {
    this.mode = mode;
    this.rig.clearAnchor();
    // Explore frames the planet in the free area and pitches about its centre; the director composes with the plain rig.
    this.rig.framedTarget = mode === 'explore' ? 1 : 0;
    if (this.frameNo === 0) this.rig.framed = this.rig.framedTarget;
    this.controls.enabled = mode === 'explore' && (this.opts.interactive ?? true);
    this.wakeTravel = 0;
    this.wakeX = -1;
    this.wakeGraceUntil = performance.now() + 900;
    if (mode === 'ambient') {
      this.hoverSlot = -1;
      this.clearHover();
      if (!this.director) this.director = new Director(this);
      this.director.start(opts);
    } else {
      this.director?.stop();
    }
  }

  /** The ambient (screensaver) controls, shaped like the design's `ambient: { start, stop, next }`. */
  get ambient(): {
    start(o?: AmbientOptions): void;
    stop(): void;
    next(): void;
    egg(): void;
    scene(kind: SceneKind): void;
  } {
    return {
      scene: (k) => this.director?.play(k),
      start: (o) => this.setMode('ambient', o),
      stop: () => this.setMode('explore'),
      next: () => this.director?.next(),
      egg: () =>
        this.mode === 'ambient' ? this.director?.queueEgg(true) : this.playEgg(this.cam.lat, this.cam.lon),
    };
  }

  private get cam(): { lat: number; lon: number } {
    this.rig.getLatLonHeading(this.camLL);
    return this.camLL;
  }
  private readonly camLL = { lat: 0, lon: 0, heading: 0 };

  /** A handlebar moustache drawn in light around a point. A wink at stache.beer. */
  playEgg(lat: number, lon: number): void {
    const c = this.fx.color('block', this.tmpColor);
    const half = clamp(0.11 * this.rig.range, 0.03, 0.42);
    drawMoustache(this.arcs, lat, lon, half, this.time + 0.35, c, 1.5);
    this.emit('egg', { lat, lon });
  }

  /**
   * Configures the Flux moon. The design's switches work as given (`on`, `scale`, `padTop`, `mode`):
   * the moon is always on a world orbit; `mode` picks its shape: `'companion'` (the compact ring of the
   * shell, sized to the screen), `'orbit'` (the wide inclined orbit of the sky) or `'auto'` (the default:
   * the ring in explore, the sky orbit in ambient). The rest (`lite`, and the sky orbit's size, orbit,
   * inclination, node, period, phase, breathing, glow, guides) are the renderer's own.
   * `{ enabled: false }` or `{ on: false }` removes it.
   */
  setMoon(opts: Partial<MoonOptions> & { on?: boolean; mode?: 'auto' | 'companion' | 'orbit' }): void {
    const { on, mode, ...rest } = opts;
    if (on !== undefined) rest.enabled = on;
    if (mode !== undefined) rest.placement = mode;
    this.moon.set(rest);
    if (!this.moon.enabled) this.setMoonHover(false);
  }

  /** The moon as the UI sees it, every frame: for the DOM proxy, the tooltip and the About tether (design 7.12). */
  moonState(): MoonState {
    return this.moon.state();
  }

  /** Keyboard or proxy activation of the moon: emits `moonclick` with `key: true`. */
  moonClick(): void {
    const s = this.moon.state();
    this.moon.press();
    this.moon.flareAll(0.8, 0.5);
    this.emit('moonclick', { x: s.x, y: s.y, key: true });
    this.emit('moon', { x: s.x, y: s.y, r: s.r });
  }

  /** The block clock, 0..1 across the block interval: the moon's ring. Call once a frame with the same value that drives the Beat widget. */
  setBeat(v: number): void {
    this.moon.beat = v;
  }

  /** What the chain is doing: a late or lost chain dims the moon's glow and stops its ring; the archive hides the ring and the relay. */
  setMoonStatus(status: MoonStatus): void {
    this.moon.status = status;
  }

  /**
   * Parks the moon as a small flat symbol at a screen point, CSS px (design 7.10.4: the phone header's
   * Beat mini while a tall or full sheet covers the orbit; `size` is the symbol's height, 24 by default).
   * It glides there and back (450 ms) and its orbit's clock keeps running; `null` returns it to its orbit.
   */
  setMoonPark(at: { x: number; y: number; size?: number } | null): void {
    this.moon.dock = at ? { x: at.x, y: at.y, size: at.size ?? 24 } : null;
  }

  /** Boot assembly (design 7.10.9): the symbol drawn by the moon's own code. `null` hands over to the orbit. */
  setMoonBoot(boot: MoonBoot | null): void {
    this.moon.boot = boot;
  }

  /**
   * The boot reveal wave (design 7.10.9, 7.12): only land and nodes within `thetaRad` of the origin are
   * drawn, and a soft front of light marks the edge. The origin is a node (engine id) or a point
   * (`{lat, lon}`), so the boot can start before the nodes are in. With `aperture` the whole picture
   * (the planet's body, its atmosphere, the sky) is drawn only inside a circle that widens on screen from
   * the origin with the wave: at `thetaRad` 0 the planet is hidden and the screen is the void; the moon
   * and the boot's symbol are always drawn whole. `null` ends it.
   */
  setReveal(
    origin: number | { lat: number; lon: number } | null,
    thetaRad = 0,
    opts: { aperture?: boolean } = {},
  ): void {
    const v = this.u.uReveal.value;
    this.revealAperture = false;
    if (origin === null) {
      v.set(0, 0, 1, -1);
      return;
    }
    if (typeof origin === 'number') {
      const slot = this.nodes.slotOf(origin);
      if (slot < 0) {
        v.set(0, 0, 1, -1);
        return;
      }
      const d = this.nodes.dir;
      v.set(d[slot * 3]!, d[slot * 3 + 1]!, d[slot * 3 + 2]!, Math.max(0, thetaRad));
    } else {
      const la = origin.lat * DEG;
      const lo = origin.lon * DEG;
      v.set(Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo), Math.max(0, thetaRad));
    }
    this.revealAperture = opts.aperture === true;
  }
  private revealAperture = false;
  private readonly apertureBuf = { x: 0.5, y: 0.5, r: 0, feather: 0.02 };

  /** The aperture for this frame (post.ts): a circle on screen around the reveal's origin that holds the wave's front. */
  private aperture(): { x: number; y: number; r: number; feather: number } | null {
    const v = this.u.uReveal.value;
    if (!this.revealAperture || v.w < 0) return null;
    const theta = v.w;
    if (theta >= 3.1) return null;
    const pt = this.tmpScreen;
    this.rig.project(v.x, v.y, v.z, this.cssW, this.cssH, pt);
    const h = Math.max(1, this.cssH);
    const d = Math.max(1.0002, this.rig.distance);
    const planet = this.rig.projScale / Math.sqrt(d * d - 1);
    // The front's chord on screen, a little ahead of the wave so the planet's body is there when the land
    // arrives; past a quarter turn the circle opens to the whole viewport.
    const chord = planet * 2 * Math.sin(Math.min(theta, Math.PI) / 2) * 1.12;
    const open = smoothstep(1.4, 2.9, theta);
    const diag = Math.hypot(this.cssW, this.cssH) * 1.2;
    const a = this.apertureBuf;
    a.x = pt.x / Math.max(1, this.cssW);
    a.y = 1 - pt.y / h;
    a.r = (chord + (diag - chord) * open) / h;
    a.feather = Math.max(0.03, 0.35 * a.r);
    return a;
  }

  /**
   * Scales the framed planet (1 is the framing's size): eases there over `ms` (ease-out). The boot
   * drifts the camera in while the planet reveals and lets the globe settle from 0.94 when the chrome
   * assembles (design 6.4 J). Picking, labels and the moon follow, since it is the lens.
   */
  setViewScale(scale: number, ms = 0): void {
    this.viewScaleFrom = this.viewScaleNow;
    this.viewScaleTo = clamp(scale, 0.3, 1);
    this.viewScaleT = ms > 0 ? 0 : 1;
    this.viewScaleDur = Math.max(0.001, ms / 1000);
    if (ms <= 0) this.viewScaleNow = this.viewScaleTo;
  }
  private viewScaleNow = 1;
  private viewScaleFrom = 1;
  private viewScaleTo = 1;
  private viewScaleT = 1;
  private viewScaleDur = 0.001;

  private stepViewScale(dt: number): void {
    if (this.viewScaleT >= 1) return;
    this.viewScaleT = Math.min(1, this.viewScaleT + dt / this.viewScaleDur);
    const e = 1 - (1 - this.viewScaleT) ** 3;
    this.viewScaleNow = this.viewScaleFrom + (this.viewScaleTo - this.viewScaleFrom) * e;
  }

  /** True while reduced motion is on (the OS setting, or `setReduced`). */
  get reduced(): boolean {
    return this.reducedMotion;
  }

  /** Parks the moon and swaps the relay to static lines, like the OS setting. */
  setReduced(reduced: boolean): void {
    this.reducedMotion = reduced;
    this.u.uReduced.value = reduced ? 1 : 0;
    this.fx.reduced = reduced;
    this.rig.reduced = reduced;
  }

  /** Fades the whole picture to black (0) or back (1) over `seconds`. The ambient director cross-fades its cuts with it under reduced motion. */
  fadeTo(target: number, seconds = 0.4): void {
    this.sceneFadeTarget = clamp(target, 0, 1);
    this.sceneFadeSeconds = Math.max(0.001, seconds);
  }

  /**
   * Tells the renderer which part of the viewport docked UI leaves free, in CSS pixels. Over `ms`
   * (300 by default, ease-in-out) the globe re-centers in the free area and the moon's orbit
   * re-clamps to it, so a docked window never covers either.
   */
  setInset(inset: Inset, ms = 300): void {
    this.insetFrom = { ...this.insetNow };
    this.insetTo = { ...inset };
    this.insetT = 0;
    // The first inset is where the globe starts, not somewhere it slides to.
    this.insetDur = this.insetGiven ? Math.max(0.001, ms / 1000) : 0.001;
    this.insetGiven = true;
  }
  private insetGiven = false;

  /**
   * Puts recent blocks on the moon's orbit as a chain of hexagons, each at the moon's angle when it
   * was sealed (`time` is UTC milliseconds). The app passes the last dozen or so blocks once; after
   * that every sealed block adds its own.
   */
  seedMoonChain(blocks: readonly { height: number; time: number }[]): void {
    this.moon.seedChain(blocks);
  }

  /** The moon's disc on screen in CSS pixels; `visible` is false behind the planet or behind the camera. */
  moonScreen(): { x: number; y: number; r: number; visible: boolean } {
    return this.moonPx;
  }

  /**
   * Puts the camera on a free shot of the moon and keeps it there, following the moon: a
   * `portrait`, the `earthrise` (16 s by default), the night-side `eclipse` or the orbit `follow`.
   * Pointer input, `releaseCamera()` or `flyTo` ends it. Returns the planner's cost for an eclipse
   * (above about 1.2 the moon is not well placed right now), 0 otherwise.
   */
  viewMoon(
    kind: MoonShotKind = 'portrait',
    opts: { duration?: number; at?: number; rate?: number } = {},
  ): number {
    if (!this.moon.enabled) return Infinity;
    const dur = opts.duration ?? 16;
    let cost = 0;
    if (kind === 'eclipse') cost = this.shots.planEclipse(this.moon, this.u.uSunDir.value, dur * 0.5);
    this.moonView = { kind, t0: this.time, dur, at: opts.at ?? null, rate: opts.rate ?? 1.6 };
    return cost;
  }

  /** Returns from a free camera shot (a moon portrait or an ambient moon scene) to the standard camera. */
  releaseCamera(rate = 2.2): void {
    this.moonView = null;
    this.rig.releaseFree(rate);
  }

  private applyMoonView(mv: {
    kind: MoonShotKind;
    t0: number;
    dur: number;
    at: number | null;
    rate: number;
  }): void {
    const t = mv.at ?? this.time - mv.t0;
    const p01 = clamp(t / mv.dur, 0, 1);
    let pose: ReturnType<MoonShots['portrait']>;
    switch (mv.kind) {
      case 'earthrise':
        pose = this.shots.earthrise(this.moon, p01);
        break;
      case 'eclipse':
        pose = this.shots.eclipse(p01);
        break;
      case 'follow':
        pose = this.shots.follow(this.moon, t);
        break;
      default:
        pose = this.shots.portrait(this.moon);
    }
    this.rig.setFree(pose.pos, pose.look, pose.up, mv.rate);
  }

  /** Freeze the sun at a timestamp (ms) or pass null to follow the real clock. */
  setSunTime(utcMs: number | null): void {
    this.sunFrozen = utcMs;
  }

  /** Runs the sun clock faster than real time (1 = real time). */
  setSunRate(rate: number): void {
    const now = Date.now();
    this.sunAnchorSim = this.sunAnchorSim + (now - this.sunAnchorReal) * this.sunRate;
    this.sunAnchorReal = now;
    this.sunRate = rate;
  }

  get sunTimeMs(): number {
    return this.sunFrozen ?? this.sunAnchorSim + (Date.now() - this.sunAnchorReal) * this.sunRate;
  }

  /** The design's `size`: the planet's diameter as a percentage of the viewport height at the current camera. */
  get sizePercent(): number {
    const d = Math.max(1.0002, this.rig.distance);
    return (200 * this.rig.projScale) / (Math.sqrt(d * d - 1) * Math.max(1, this.cssH));
  }

  /** The current zoom band (Z0 global ... Z3 city), from `sizePercent`. */
  get zoomBand(): ZoomBand {
    return this.bandNow;
  }

  /** Highlights a node as if the pointer were over it (list rows hovering their node), without a tooltip event. Null clears it. */
  setHover(id: number | null): void {
    const s = this.nodes;
    const slot = id === null ? -1 : s.slotOf(id);
    if (this.extHover === slot) return;
    if (this.extHover >= 0 && this.extHover !== this.hoverSlot)
      s.setState(this.extHover, NodeState.Hovered, false);
    this.extHover = slot;
    if (slot >= 0) s.setState(slot, NodeState.Hovered, true);
  }
  private extHover = -1;

  get stats(): EngineStats {
    return this.statsObj;
  }

  get viewport(): { w: number; h: number; dpr: number } {
    return { w: this.cssW, h: this.cssH, dpr: this.dpr };
  }

  /** The smallest hub that draws a tower at this camera range. */
  private towerThreshold(range: number): number {
    if (range > 2.4) {
      this.ensureHubs();
      const h = this.hubsCache;
      return Math.max(6, h.length >= 60 ? h[59]!.count : 6);
    }
    if (range > 1.25) return 8;
    return 2;
  }

  /** Mesh veil / traffic density multiplier (0..1). */
  meshDensity = 1;

  private showBelt = false;
  /** Nodes without a known location are hidden by default; show them as an orbital belt instead. */
  setUnlocatedBelt(on: boolean): void {
    this.showBelt = on;
    this.nodes.posDirty = true;
    this.layoutFan = -1;
  }

  // ---- data: nodes ------------------------------------------------------------------------

  /**
   * Replaces the whole node set. When the engine already holds nodes and `animate` is on (the
   * default), the new set is diffed by id: departures fade, arrivals grow. The first load plays an
   * intro wave radiating from the camera target.
   */
  setNodes(cols: NodeColumns, opts: { animate?: boolean; intro?: boolean } = {}): void {
    const s = this.nodes;
    const now = this.time;
    const n = cols.ids.length;
    const animate = (opts.animate ?? true) && s.live > 0;
    if (!animate) {
      this.resetTransient();
      s.clear();
      const intro = (opts.intro ?? true) && !this.reducedMotion && !this.hidden;
      s.addColumns(cols, -1000);
      if (intro) this.applyIntro(now);
    } else {
      const seen = new Set<number>();
      const changes = { add: 0, del: 0 };
      // Arrivals and in-place changes
      const arrivals: number[] = [];
      for (let i = 0; i < n; i++) {
        const id = cols.ids[i]!;
        seen.add(id);
        const slot = s.slotOf(id);
        if (slot < 0) {
          arrivals.push(i);
          changes.add++;
        } else if (s.alive[slot] === 2) {
          s.revive(slot, now);
        } else {
          let dirty = false;
          if (s.tier[slot] !== cols.tier[i]) {
            s.tier[slot] = cols.tier[i]!;
            dirty = true;
          }
          if (s.status[slot] !== cols.status[i]) {
            s.status[slot] = cols.status[i]!;
            dirty = true;
          }
          if (s.flags[slot] !== cols.flags[i]) {
            s.flags[slot] = cols.flags[i]!;
            dirty = true;
          }
          if (dirty) s.markAttr(slot);
        }
      }
      for (let slot = 0; slot < s.high; slot++) {
        if (s.alive[slot] === 1 && !seen.has(s.id[slot]!)) {
          changes.del++;
          this.removeNodeInternal(s.id[slot]!, 0.05 + hash01(s.id[slot]!) * (changes.del > 40 ? 1.1 : 0.25));
        }
      }
      const spread = arrivals.length > 40 ? 1.1 : 0.25;
      for (const i of arrivals) {
        this.addNodeInternal(
          {
            id: cols.ids[i]!,
            lat: cols.lat[i]!,
            lon: cols.lon[i]!,
            tier: cols.tier[i]!,
            status: cols.status[i]!,
            flags: cols.flags[i]!,
            loc: cols.loc[i]!,
            host: cols.host ? cols.host[i] : 0,
          },
          this.hidden || this.reducedMotion ? -1 : 0.05 + hash01(cols.ids[i]!) * spread,
        );
      }
    }
    this.afterNodesChanged();
  }

  private applyIntro(now: number): void {
    const s = this.nodes;
    const t = this.rig.target;
    for (let i = 0; i < s.high; i++) {
      if (s.alive[i] !== 1) continue;
      const d = angleBetween(t.x, t.y, t.z, s.dir[i * 3]!, s.dir[i * 3 + 1]!, s.dir[i * 3 + 2]!);
      s.birth[i] = now + 0.35 + (d / Math.PI) * 2.4 + hash01(s.id[i]!) * 0.5;
      s.markTime(i);
    }
  }

  /** Applies an incremental change (nodes joined, left, or changed). */
  updateNodes(delta: NodeDelta): void {
    const s = this.nodes;
    const animate = (delta.animate ?? true) && !this.hidden && !this.reducedMotion;
    if (delta.removedIds) {
      const n = delta.removedIds.length;
      for (let i = 0; i < n; i++)
        this.removeNodeInternal(
          delta.removedIds[i]!,
          animate ? hash01(delta.removedIds[i]!) * (n > 40 ? 1.0 : 0.2) : -1,
        );
    }
    if (delta.added) {
      const a = delta.added;
      const n = a.ids.length;
      for (let i = 0; i < n; i++) {
        this.addNodeInternal(
          {
            id: a.ids[i]!,
            lat: a.lat[i]!,
            lon: a.lon[i]!,
            tier: a.tier[i]!,
            status: a.status[i]!,
            flags: a.flags[i]!,
            loc: a.loc[i]!,
            host: a.host ? a.host[i] : 0,
          },
          animate ? hash01(a.ids[i]!) * (n > 40 ? 1.0 : 0.2) : -1,
        );
      }
    }
    if (delta.changed) {
      const c = delta.changed;
      for (let i = 0; i < c.ids.length; i++) {
        const slot = s.slotOf(c.ids[i]!);
        if (slot < 0) continue;
        if (c.tier) s.tier[slot] = c.tier[i]!;
        if (c.status) s.status[slot] = c.status[i]!;
        if (c.flags) s.flags[slot] = c.flags[i]!;
        s.markAttr(slot);
      }
    }
    this.afterNodesChanged();
  }

  private afterNodesChanged(): void {
    this.nodes.posDirty = true;
    this.hubsDirty = true;
    this.mesh.resolveDirty = true;
    this.mesh.adjDirty = true;
    this.reapplyFilter();
    if (this.selectedId !== 0 && this.nodes.slotOf(this.selectedId) < 0) this.select(null);
    this.rebuildWatched();
  }

  private addNodeInternal(rec: NodeRecord, delay: number): number {
    const s = this.nodes;
    const existing = s.slotOf(rec.id);
    if (existing >= 0) {
      if (s.alive[existing] === 2) s.revive(existing, this.time);
      return existing;
    }
    const slot = s.add(rec, delay < 0 ? -1000 : this.time + delay);
    if (slot >= 0) {
      this.applyFilterTo(slot);
      this.hubsDirty = true;
    }
    return slot;
  }

  private removeNodeInternal(id: number, delay: number): number {
    const s = this.nodes;
    const slot = s.slotOf(id);
    if (slot < 0 || s.alive[slot] !== 1) return -1;
    const at = delay < 0 ? this.time - FADE_OUT - 1 : this.time + delay;
    s.remove(id, at, FADE_OUT);
    this.mesh.removeNode(id, (e) => {
      this.links.fadeOut(this.mesh.link[e]!, this.time, 0.5);
      this.mesh.link[e] = -1;
    });
    if (this.selectedSlot === slot) this.select(null);
    this.hubsDirty = true;
    return slot;
  }

  /** Clears everything transient (used on full reloads and after the tab was hidden). */
  private resetTransient(): void {
    this.arcs.clear();
    this.packets.clear();
    this.rings.clear();
    this.held.clear();
    this.links.clear();
    this.rays.clear();
    this.selHandles.length = 0;
    this.selStarts.length = 0;
    this.beaconHandles.length = 0;
    this.beaconRings.length = 0;
    this.beaconPillar = -1;
    this.conHandles.clear();
    this.selectedSlot = -1;
    this.selectedId = 0;
    this.selectedCluster = -1;
    this.hoverSlot = -1;
    this.focusTarget = 0;
    this.conActive = false;
    this.conSlots.length = 0;
    this.choreo?.flush();
  }

  // ---- filter & watch ---------------------------------------------------------------------

  /** Dims nodes that fail the filter. Pass null to clear. `allowIds` restricts to a set of node ids. */
  setFilter(filter: NodeFilter | null, allowIds?: ArrayLike<number> | null): void {
    this.filterSpec = filter;
    this.filterAllow =
      allowIds && allowIds.length > 0 ? new Set(Array.from(allowIds as ArrayLike<number>)) : null;
    this.filterActive = !!filter || !!this.filterAllow;
    this.reapplyFilter(true);
  }

  private passes(slot: number): boolean {
    if (!this.filterActive) return true;
    const s = this.nodes;
    const f = this.filterSpec;
    if (this.filterAllow && !this.filterAllow.has(s.id[slot]!)) return false;
    if (f) {
      if (f.tiers !== undefined && (f.tiers & (1 << s.tier[slot]!)) === 0) return false;
      if (f.statuses !== undefined && (f.statuses & (1 << s.status[slot]!)) === 0) return false;
      if (f.requireFlags !== undefined && (s.flags[slot]! & f.requireFlags) !== f.requireFlags) return false;
      if (f.excludeFlags !== undefined && (s.flags[slot]! & f.excludeFlags) !== 0) return false;
    }
    return true;
  }

  private applyFilterTo(slot: number): void {
    const s = this.nodes;
    const dim = !this.passes(slot);
    const cur = (s.state[slot]! & NodeState.Dim) !== 0;
    let st = s.state[slot]! & ~(NodeState.Dim | NodeState.DimPrev);
    if (dim) st |= NodeState.Dim | NodeState.DimPrev;
    s.state[slot] = st;
    s.markAttr(slot);
    const c = s.cluster[slot]!;
    if (c !== NO_CLUSTER && dim !== cur && s.alive[slot] === 1) {
      if (dim) s.cPass[c]!--;
      else s.cPass[c]!++;
    }
  }

  private reapplyFilter(animate = false): void {
    const s = this.nodes;
    for (let c = 0; c < s.clusterCount; c++) s.cPass[c] = 0;
    for (let i = 0; i < s.high; i++) {
      if (s.alive[i] === 0) continue;
      const dim = !this.passes(i);
      const prev = (s.state[i]! & NodeState.Dim) !== 0;
      let st = s.state[i]! & ~(NodeState.Dim | NodeState.DimPrev);
      if (dim) st |= NodeState.Dim;
      if (animate ? prev : dim) st |= NodeState.DimPrev;
      if (st !== s.state[i]) {
        s.state[i] = st;
        s.markAttr(i);
      }
      const c = s.cluster[i]!;
      if (c !== NO_CLUSTER && s.alive[i] === 1 && !dim) s.cPass[c]!++;
    }
    if (animate) this.filterT = 0;
    s.clustersDirty = true;
    s.posDirty = true;
  }

  /** Marks nodes as watched (persistent ring). */
  setWatched(ids: ArrayLike<number>): void {
    for (const id of this.watched) {
      const s = this.nodes.slotOf(id);
      if (s >= 0) this.nodes.setState(s, NodeState.Watched, false);
    }
    this.watched = Array.from(ids as ArrayLike<number>);
    this.rebuildWatched();
  }

  private rebuildWatched(): void {
    for (const id of this.watched) {
      const s = this.nodes.slotOf(id);
      if (s >= 0) this.nodes.setState(s, NodeState.Watched, true);
    }
  }

  // ---- data: mesh -------------------------------------------------------------------------

  /** Replaces the P2P mesh. Both arrays hold node ids; pairs are undirected. */
  setMesh(edgesA: ArrayLike<number>, edgesB: ArrayLike<number>): void {
    this.mesh.clear();
    this.links.clear();
    const n = Math.min(edgesA.length, edgesB.length);
    for (let i = 0; i < n; i++) this.mesh.add(edgesA[i]!, edgesB[i]!);
    this.mesh.resolve(this.nodes);
    this.rebuildLinks();
  }

  /** Streams mesh changes (links appear and vanish gracefully). */
  updateMesh(delta: {
    addA?: ArrayLike<number>;
    addB?: ArrayLike<number>;
    removeA?: ArrayLike<number>;
    removeB?: ArrayLike<number>;
  }): void {
    if (delta.removeA && delta.removeB)
      for (let i = 0; i < Math.min(delta.removeA.length, delta.removeB.length); i++)
        this.removeLinkInternal(delta.removeA[i]!, delta.removeB[i]!, !this.hidden);
    if (delta.addA && delta.addB) {
      let selectionGained = false;
      const shown = this.handshakes;
      shown.length = 0;
      let firstHand = 0;
      for (let i = 0; i < Math.min(delta.addA.length, delta.addB.length); i++) {
        const e = this.addLinkInternal(delta.addA[i]!, delta.addB[i]!, !this.hidden, false);
        if (e < 0) continue;
        if (!this.hidden && this.canShowLink(e)) {
          // A link on the selection or a watched node goes first.
          if (this.linkPriority(e)) {
            shown.push(shown[firstHand] ?? e);
            shown[firstHand++] = e;
          } else shown.push(e);
        }
        if (this.touchesSelection(e)) selectionGained = true;
      }
      // Every link is in the store; only a few handshakes light per sweep, so an outlier report (a
      // queried host that adds thousands of links at once) never reads as a flood of light or costs a
      // frame: the priority ones, then an even sample of the rest.
      const cap = GlobeEngine.HANDSHAKE_CAP;
      if (shown.length <= cap) for (const e of shown) this.drawLink(e);
      else {
        const first = Math.min(firstHand, cap);
        for (let k = 0; k < first; k++) this.drawLink(shown[k]!);
        const rest = shown.length - firstHand;
        const want = cap - first;
        for (let k = 0; k < want && rest > 0; k++)
          this.drawLink(shown[firstHand + Math.floor(((k + 0.5) * rest) / want)]!);
      }
      shown.length = 0;
      // One reveal per sweep: each rebuilds the adjacency and redraws the selection's arcs.
      if (selectionGained) this.revealPeers(this.selectedSlot);
    }
  }

  /** At most this many link handshakes (a ribbon fading in and a packet) light per `updateMesh` call. */
  static readonly HANDSHAKE_CAP = 48;
  private readonly handshakes: number[] = [];

  private rebuildLinks(): void {
    const m = this.mesh;
    this.links.clear();
    this.veil.reset();
    m.link.fill(-1);
    m.resolve(this.nodes);
  }

  /** Mesh layer modes: `off`, `selection` (a selected node's peers only), `flow` (a rolling web of all links). */
  setMeshMode(mode: 'off' | 'selection' | 'flow'): void {
    this.meshMode = mode;
    this.effects = { ...this.effects, mesh: mode !== 'off' };
    this.applyMeshFlags();
    if (mode !== 'flow') {
      // Fade the veil out gently: every live link ribbon, including any whose edge bookkeeping was
      // lost (a re-shown or removed edge), or they would outlive the mode for up to a minute.
      this.links.fadeAll(this.time, 0.8);
    }
  }
  meshMode: 'off' | 'selection' | 'flow' = 'flow';

  private addLinkInternal(a: number, b: number, _animate: boolean, reveal = true): number {
    const m = this.mesh;
    const e = m.add(a, b);
    if (e < 0) return -1;
    m.resolve(this.nodes); // just this edge, unless the node slots changed since the last resolve
    // A new link on the selection shows up immediately among its peers.
    if (reveal && this.touchesSelection(e)) this.revealPeers(this.selectedSlot);
    return e;
  }

  private touchesSelection(e: number): boolean {
    const sel = this.selectedSlot;
    return sel >= 0 && (this.mesh.sa[e] === sel || this.mesh.sb[e] === sel);
  }

  /** Whether a freshly added link would show its handshake (alive ends, the mesh mode, in view). */
  private canShowLink(e: number): boolean {
    const m = this.mesh;
    if (!m.alive[e]) return false;
    const sa = m.sa[e]!;
    const sb = m.sb[e]!;
    if (sa === 0xffffffff || sb === 0xffffffff) return false;
    if (this.nodes.alive[sa] !== 1 || this.nodes.alive[sb] !== 1) return false;
    if (this.meshMode !== 'flow' && !this.linkPriority(e)) return false;
    return this.fx.visible(sa) || this.fx.visible(sb);
  }

  /** A link with a selected or watched end. */
  private linkPriority(e: number): boolean {
    const m = this.mesh;
    const sa = m.sa[e]!;
    const sb = m.sb[e]!;
    if (sa === 0xffffffff || sb === 0xffffffff) return false;
    return ((this.nodes.state[sa]! | this.nodes.state[sb]!) & (NodeState.Selected | NodeState.Watched)) !== 0;
  }

  /** One link's handshake, when it would show (the choreographer's single links). */
  private showLink(e: number): void {
    if (this.canShowLink(e)) this.drawLink(e);
  }

  /** Draws a freshly added link: fade-in, plus a bright packet so the eye sees the handshake. */
  private drawLink(e: number): void {
    const m = this.mesh;
    const sa = m.sa[e]!;
    const sb = m.sb[e]!;
    const c = this.fx.color('mesh', this.tmpColor);
    this.veil.showEdge(e, this.time, 1.6, c, 1.8);
    this.fx.packetRaw(sa, sb, c.r * 1.6, c.g * 1.6, c.b * 1.6, 0.9, 2.0, 1.4);
  }

  private removeLinkInternal(a: number, b: number, animate: boolean): void {
    const e = this.mesh.remove(a, b);
    if (e < 0) return;
    const li = this.mesh.link[e]!;
    if (li >= 0 && this.links.isActive(li, this.mesh.linkStart[e]!))
      this.links.fadeOut(li, this.time, animate ? 0.9 : 0.05);
    this.mesh.link[e] = -1;
  }

  private readonly tmpColor = new THREE.Color();
  private readonly tmpMoonV = new THREE.Vector3();
  private readonly tmpScreen: ScreenPoint = { x: 0, y: 0, visible: false, depth: 0 };

  // label anchors (labelAnchors): inputs and their per-frame projections, index aligned
  private anchorIn: LabelAnchorInput[] = [];
  private anchorOut: LabelAnchor[] = [];
  private anchorFrame = -1;
  private frameNo = 0;

  // ---- selection & camera -----------------------------------------------------------------

  /**
   * Selects a node (null clears). Everything else dims, the node's peers light up with their links
   * revealed, and the camera flies in unless `fly` is false.
   */
  select(id: number | null, opts: { fly?: boolean; alt?: number; silent?: boolean } = {}): void {
    const s = this.nodes;
    // Clear the previous selection
    if (this.selectedSlot >= 0) {
      s.setState(this.selectedSlot, NodeState.Selected, false);
      this.clearRelated();
    }
    this.clearSelectionArcs();
    this.endBeacon();
    this.rig.clearAnchor('lock');
    if (id === null || id === 0) {
      this.selectedSlot = -1;
      this.selectedId = 0;
      this.selectedCluster = -1;
      this.focusTarget = this.conActive ? 1 : 0;
      if (!opts.silent) this.emit('select', null);
      return;
    }
    const slot = s.slotOf(id);
    if (slot < 0 || s.alive[slot] !== 1) return;
    this.selectedSlot = slot;
    this.selectedId = id;
    this.selectedCluster = s.cluster[slot]!;
    s.setState(slot, NodeState.Selected, true);
    this.focusTarget = 1;
    this.startBeacon(slot);
    this.revealPeers(slot);
    if (opts.fly !== false) this.flyToNode(id, opts.alt);
    if (!opts.silent) this.emit('select', this.makePickInfo(slot, false, 0, 0));
  }

  private clearRelated(): void {
    const s = this.nodes;
    for (let i = 0; i < s.high; i++) {
      if (s.state[i]! & NodeState.Related) s.setState(i, NodeState.Related, false);
    }
    // Constellation members stay related.
    if (this.conActive) for (const slot of this.conSlots) s.setState(slot, NodeState.Related, true);
  }

  /** How many of the selected node's peers are drawn, and how they split. */
  readonly selectionPeers = { total: 0, shown: 0, outbound: 0, inbound: 0 };

  private revealPeers(slot: number): void {
    const s = this.nodes;
    const mesh = this.mesh;
    // Rebuilding on a live selection (a link arrived) clears the old arcs first.
    this.clearSelectionArcs();
    mesh.buildAdjacency(s);
    const [lo, hi] = mesh.range(slot);
    const nb = mesh.neighbours;
    const ne = mesh.neighbourEdges;
    const c = this.fx.color('mesh', this.tmpColor);
    // Nearest peers first (distance stands in for latency): they draw first and survive the cap.
    const n = hi - lo;
    const order = new Array<number>(n);
    for (let i = 0; i < n; i++) order[i] = lo + i;
    const d = s.dir;
    const ang = (k: number): number => {
      const t = nb[k]!;
      return angleBetween(
        d[slot * 3]!,
        d[slot * 3 + 1]!,
        d[slot * 3 + 2]!,
        d[t * 3]!,
        d[t * 3 + 1]!,
        d[t * 3 + 2]!,
      );
    };
    order.sort((x, y) => ang(x) - ang(y));
    const cap = Math.min(n, 60);
    let out = 0;
    let inn = 0;
    for (let i = 0; i < n; i++) {
      const k = order[i]!;
      const t = nb[k]!;
      if (s.alive[t] !== 1) continue;
      s.setState(t, NodeState.Related, true);
      const outbound = mesh.isOutbound(ne[k]!, slot);
      if (outbound) out++;
      else inn++;
      if (i >= cap) continue;
      const a = ang(k);
      const start = this.time + 0.05 + (i / Math.max(1, cap)) * 0.5;
      const lift = arcLift(a, 0.05, 0.18);
      const style = outbound ? RibbonStyle.Arc : RibbonStyle.Dashed;
      const inten = this.tokens.meshAlpha * 3.2;
      const h = outbound
        ? this.held.add(slot, t, style, start, 0.8 + 0.35 * a, 1e9, lift, 1.2, c.r, c.g, c.b, inten)
        : this.held.add(t, slot, style, start, 0.8 + 0.35 * a, 1e9, lift, 1.2, c.r, c.g, c.b, inten);
      if (h >= 0) {
        this.selHandles.push(h);
        this.selStarts.push(start);
      }
    }
    this.selectionPeers.total = out + inn;
    this.selectionPeers.shown = Math.min(cap, out + inn);
    this.selectionPeers.outbound = out;
    this.selectionPeers.inbound = inn;
  }

  private clearSelectionArcs(): void {
    for (let i = 0; i < this.selHandles.length; i++) this.held.fadeOut(this.selHandles[i]!, this.time, 0.45);
    this.selHandles.length = 0;
    this.selStarts.length = 0;
  }

  /**
   * The selection beacon: a 2px pillar rising 0.22R from the node, two 1.25px pulses repeating on
   * the surface plane (10 to 26px, 2.4 s, offset half a period), and 0.5px leaders with small rings
   * to the nodes that share the selected node's host. All of it is held until the node is deselected.
   */
  private startBeacon(slot: number): void {
    const s = this.nodes;
    const c = this.fx.color('accent', this.tmpColor);
    const t = this.time;
    this.beaconLift = this.pillarLift();
    const pillar = this.held.add(
      slot,
      slot,
      RibbonStyle.Beam,
      t,
      this.reducedMotion ? 0.01 : 0.4,
      1e9,
      this.beaconLift,
      2.0,
      c.r,
      c.g,
      c.b,
      0.62,
    );
    if (pillar >= 0) {
      this.beaconHandles.push(pillar);
      this.beaconPillar = pillar;
      this.beaconPillarStart = t;
    }
    // The lock ring and its pulse are drawn by the node layer itself (nodes/nodeShaders.ts), in the
    // marker's own pass, so they can sit on a dark stage and stay legible over any background.
    const host = s.host[slot];
    const cl = s.cluster[slot];
    if (host === 0 || cl === NO_CLUSTER) return;
    let n = 0;
    for (let i = 0; i < s.high && n < 24; i++) {
      if (i === slot || s.alive[i] !== 1 || s.cluster[i] !== cl || s.host[i] !== host) continue;
      const start = t + 0.12 + n * 0.02;
      const h = this.held.add(slot, i, RibbonStyle.Link, start, 0.4, 1e9, 0, 0.5, c.r, c.g, c.b, 0.8);
      if (h >= 0) this.beaconHandles.push(h);
      const r = this.rings.add(i, RingKind.Host, start, 1e9, -6, c.r, c.g, c.b, 0.5, 0, 6);
      if (r >= 0) this.beaconRings.push(r, start);
      n++;
    }
  }

  /**
   * The pillar is 0.22R tall, but never more than a third of the camera range so it stays in frame up
   * close, where it shrinks away as the lens closes: the lock ring does its job there, and a stick
   * through the field is the kind of line the view is better without.
   */
  private pillarLift(): number {
    const range = Math.max(0.004, this.rig.distance - 1);
    const lens = lensAtDistance(this.rig.projScale, range);
    return Math.min(0.22, 0.3 * range * (1 - 0.85 * lens));
  }

  private endBeacon(): void {
    this.beaconPillar = -1;
    for (let i = 0; i < this.beaconHandles.length; i++)
      this.held.fadeOut(this.beaconHandles[i]!, this.time, 0.45);
    this.beaconHandles.length = 0;
    for (let i = 0; i + 1 < this.beaconRings.length; i += 2)
      this.fx.endRing(this.beaconRings[i]!, this.beaconRings[i + 1]!, 0.45);
    this.beaconRings.length = 0;
  }

  /** Focus-only mode: with a node selected, everything outside its neighbourhood drops to the full dim alpha. */
  setFocusOnly(on: boolean): void {
    this.focusOnly = on;
  }

  /**
   * Camera fly-to with smooth easing. `alt` is the camera range to the surface, in globe radii; `arc` scales the
   * zoom-out a long flight makes on its way (0 to 1, default 1).
   */
  flyTo(
    lat: number,
    lon: number,
    alt = 1.2,
    opts: { tilt?: number; heading?: number; duration?: number; radius?: number; arc?: number } = {},
  ): Promise<boolean> {
    this.director?.interrupt();
    return this.rig.flyTo(lat, lon, alt, {
      tilt: opts.tilt ?? 0,
      heading: opts.heading ?? 0,
      duration: opts.duration,
      radius: opts.radius,
      arc: opts.arc,
    });
  }

  /**
   * Flies to a node so it lands exactly at the view centre (the free area's centre), where it is drawn at
   * the flight's end (its place in its site's fan at that zoom), and then holds it there: if it is the
   * selection, the camera stays locked on it through zoom, pitch and layout changes until the globe is
   * dragged or another flight starts.
   */
  flyToNode(id: number, alt?: number): Promise<boolean> {
    const s = this.nodes;
    const slot = s.slotOf(id);
    if (slot < 0) return Promise.resolve(false);
    const c = s.cluster[slot]!;
    const n = c === NO_CLUSTER ? 1 : s.cLive[c]!;
    const range = alt ?? (n > 60 ? 0.3 : n > 8 ? 0.36 : 0.5);
    const p = this.tmpV;
    this.nodeAt(slot, range, p);
    const r = p.length();
    const lat = Math.asin(clamp(p.y / r, -1, 1)) * RAD;
    const lon = Math.atan2(p.x, p.z) * RAD;
    return this.flyTo(lat, lon, range, { tilt: 0.32, radius: r }).then((done) => {
      if (done && this.selectedId === id && this.mode === 'explore' && s.alive[slot] === 1) {
        this.nodePos(slot, this.tmpV);
        this.rig.setAnchor(this.tmpV, 'lock', 0, 0);
      }
      return done;
    });
  }

  /** Where `slot` is drawn at camera range `range` (the layout's own formula; see `slotPosition`). */
  private nodeAt(slot: number, range: number, out: THREE.Vector3): void {
    const t = this.tmp3;
    slotPosition(this.nodes, slot, 1 - smoothstep(0.35, 1.45, range), this.fanSpacingFor(range), t);
    out.set(t[0]!, t[1]!, t[2]!);
  }

  /** Where `slot` is drawn right now. */
  private nodePos(slot: number, out: THREE.Vector3): void {
    const p = this.nodes.pos;
    out.set(p[slot * 4]!, p[slot * 4 + 1]!, p[slot * 4 + 2]!);
  }

  private readonly tmpV = new THREE.Vector3();

  /**
   * After the layout: the anchor follows the selected node (it moves as its fan opens or closes with the
   * zoom) and the rig turns so the node, or the point a zoom is anchored on, stays where it is on screen.
   */
  private holdAnchor(): void {
    const rig = this.rig;
    const kind = rig.anchorKind;
    if (kind === null) return;
    if (this.mode !== 'explore') {
      rig.clearAnchor();
      return;
    }
    if (kind === 'lock') {
      const slot = this.selectedSlot;
      if (slot < 0 || this.nodes.alive[slot] !== 1) {
        rig.clearAnchor('lock');
        return;
      }
      this.nodePos(slot, this.tmpV);
      rig.moveAnchor(this.tmpV);
    } else if (!rig.isZooming) {
      // The zoom has settled: the point is where the user put it, and nothing holds it any more.
      rig.clearAnchor('zoom');
      return;
    }
    rig.holdAnchor(this.time);
  }

  /**
   * A wheel turn or a pinch at (x, y), CSS px, before the zoom is applied: what the zoom holds still.
   * The selection, while it is on screen, stays exactly where it is (design 7.7: the selection camera);
   * otherwise the point of the planet under the pointer stays under it (zoom to the cursor); off the
   * planet the zoom is about the view centre.
   */
  private zoomAnchorAt(x: number, y: number): void {
    if (this.mode !== 'explore' || this.rig.isFree) return;
    if (this.anchorSelection()) return;
    const p = this.tmpV;
    if (x >= 0 && this.rig.pickSurface((x / this.cssW) * 2 - 1, -((y / this.cssH) * 2 - 1), p)) {
      this.rig.setAnchor(p, 'zoom');
    } else {
      this.rig.clearAnchor('zoom');
    }
  }

  /** Locks the camera on the selection where it is on screen, if it is on screen. True when it did. */
  private anchorSelection(): boolean {
    const rig = this.rig;
    if (rig.anchorKind === 'lock') return true;
    const slot = this.selectedSlot;
    if (slot < 0 || this.nodes.alive[slot] !== 1) return false;
    this.nodePos(slot, this.tmpV);
    const pt = this.tmpScreen;
    const v = this.tmpV;
    rig.project(v.x, v.y, v.z, this.cssW, this.cssH, pt);
    const m = 8;
    if (!pt.visible || pt.x < m || pt.y < m || pt.x > this.cssW - m || pt.y > this.cssH - m) return false;
    return rig.setAnchor(v, 'lock');
  }

  /** The F key (design 10.4): back to the selection, centred and locked. False when nothing is selected. */
  flyToSelection(): boolean {
    if (this.mode !== 'explore' || this.selectedSlot < 0 || this.nodes.alive[this.selectedSlot] !== 1)
      return false;
    void this.flyToNode(this.selectedId, Math.min(this.rig.rangeD, 0.5));
    return true;
  }

  // ---- keyboard camera (design 7.2, 10.4) ---------------------------------------------------
  // Steps scale with the view, so a press moves the picture by about the same share of the screen at
  // any zoom. Reduced motion takes them at once; otherwise the rig's springs glide (a short ease).

  /** Arrow keys: turns the globe by `x`, `y` steps (+x shows more of what is right, +y of what is above). */
  orbitStep(x: number, y: number): void {
    if (this.mode !== 'explore') return;
    this.keyInput();
    const a = 0.22 * this.rig.viewSpan;
    this.rig.panBy(x * a, y * a);
    if (this.reducedMotion) this.rig.settleNow();
  }

  /** Shift and arrows: turns the heading and the pitch by steps (about the selection while it is locked). */
  turnStep(heading: number, tilt: number): void {
    if (this.mode !== 'explore') return;
    this.keyInput();
    this.rig.orbitBy(heading * 0.14, tilt * 0.09);
    if (this.reducedMotion) this.rig.settleNow();
  }

  /** `+` and `-`: zooms by `steps` (positive is in), holding the selection still while it is on screen. */
  zoomStep(steps: number): void {
    if (this.mode !== 'explore' || steps === 0) return;
    this.keyInput();
    if (!this.anchorSelection()) this.rig.clearAnchor('zoom');
    this.rig.zoomBy(0.72 ** steps);
    if (this.reducedMotion) this.rig.settleNow();
  }

  private keyInput(): void {
    this.lastInputT = this.time;
    this.director?.interrupt();
    this.moonView = null;
    this.rig.releaseFree(7);
  }

  /** Fly to a co-location cluster so its stack unfurls. */
  flyToCluster(cluster: number, alt?: number): Promise<boolean> {
    const s = this.nodes;
    if (cluster < 0 || cluster >= s.clusterCount) return Promise.resolve(false);
    const n = s.cLive[cluster]!;
    return this.flyTo(s.cLat[cluster]!, s.cLon[cluster]!, alt ?? (n > 200 ? 0.42 : n > 30 ? 0.36 : 0.45), {
      tilt: 0.42,
    });
  }

  private readonly tmp3 = new Float32Array(3);

  /** `zoomBand` when the band changes, `cameraChange` when the pose does (once per frame at most). */
  private emitCamera(): void {
    const size = this.sizePercent;
    const band: ZoomBand = size < 110 ? 0 : size < 260 ? 1 : size < 700 ? 2 : 3;
    const rig = this.rig;
    rig.getLatLonHeading(this.camTmp);
    const c = this.camSent;
    const t = this.camTmp;
    const moved =
      Math.abs(t.lat - c.lat) > 0.005 ||
      Math.abs(t.lon - c.lon) > 0.005 ||
      Math.abs(t.heading - c.heading) > 1e-4 ||
      Math.abs(rig.range - c.range) > 1e-4 * Math.max(1, rig.range) ||
      Math.abs(rig.tilt - c.tilt) > 1e-4;
    if (band !== this.bandNow) {
      this.bandNow = band;
      this.emit('zoomBand', { band, size });
    }
    if (!moved) return;
    c.lat = t.lat;
    c.lon = t.lon;
    c.heading = t.heading;
    c.range = rig.range;
    c.tilt = rig.tilt;
    const info = this.camInfo;
    info.lat = t.lat;
    info.lon = t.lon;
    info.heading = t.heading;
    info.range = rig.range;
    info.tilt = rig.tilt;
    info.size = size;
    info.band = band;
    this.emit('cameraChange', info);
  }

  private fanSpacingFor(range: number): number {
    const pxSp = 8 * (1 + 2.2 * (1 - smoothstep(0.03, 0.18, range)));
    return (pxSp * range) / this.rig.projScale;
  }

  // ---- app constellations -----------------------------------------------------------------

  /**
   * Links an app's instances with luminous arcs (a minimum spanning tree plus a few loop-closing
   * links, like a star chart). Everything else dims. Pass null/empty to clear.
   */
  showAppConstellation(
    instances: ArrayLike<number> | null,
    opts: { name?: string; fly?: boolean } = {},
  ): void {
    const s = this.nodes;
    // Clear previous
    for (const slot of this.conSlots) s.setState(slot, NodeState.Related, false);
    for (const { h } of this.conHandles.values()) this.held.fadeOut(h, this.time, 0.5);
    this.conHandles.clear();
    this.conSlots.length = 0;
    this.conHubs.clear();
    this.conActive = false;
    this.conName = opts.name ?? '';
    if (!instances || instances.length === 0) {
      this.focusTarget = this.selectedSlot >= 0 ? 1 : 0;
      return;
    }
    for (let i = 0; i < instances.length; i++) {
      const slot = s.slotOf(instances[i]!);
      if (slot >= 0 && s.alive[slot] === 1) this.conSlots.push(slot);
    }
    if (this.conSlots.length === 0) return;
    this.conActive = true;
    for (const slot of this.conSlots) s.setState(slot, NodeState.Related, true);
    this.focusTarget = 1;
    this.buildConstellationArcs(true);
    if (opts.fly !== false) this.fitSlots(this.conSlots, 1.35);
  }

  clearAppConstellation(): void {
    this.showAppConstellation(null);
  }

  private fitSlots(slots: readonly number[], margin: number): void {
    const s = this.nodes;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const i of slots) {
      cx += s.dir[i * 3]!;
      cy += s.dir[i * 3 + 1]!;
      cz += s.dir[i * 3 + 2]!;
    }
    const l = Math.hypot(cx, cy, cz);
    if (l < 1e-6) return;
    cx /= l;
    cy /= l;
    cz /= l;
    let rho = 0.04;
    for (const i of slots)
      rho = Math.max(rho, angleBetween(cx, cy, cz, s.dir[i * 3]!, s.dir[i * 3 + 1]!, s.dir[i * 3 + 2]!));
    const range = rangeToFit(rho, this.rig.fovV, this.rig.aspect, margin);
    const lat = Math.asin(clamp(cy, -1, 1)) * RAD;
    const lon = Math.atan2(cx, cz) * RAD;
    this.flyTo(lat, lon, Math.max(range, 0.9), { tilt: 0.0 });
  }

  /** MST + extra short links over the current constellation members. */
  private buildConstellationArcs(first: boolean): void {
    const s = this.nodes;
    const slots = this.conSlots;
    const n = slots.length;
    this.conHubs.clear();
    for (const sl of slots) if (s.cluster[sl] !== NO_CLUSTER) this.conHubs.add(s.cluster[sl]!);
    const want = new Map<number, { a: number; b: number; depth: number }>();
    if (n >= 2) {
      const d = s.dir;
      const dist = (i: number, j: number): number => {
        const a = slots[i]!;
        const b = slots[j]!;
        return d[a * 3]! * d[b * 3]! + d[a * 3 + 1]! * d[b * 3 + 1]! + d[a * 3 + 2]! * d[b * 3 + 2]!;
      };
      // Prim on maximum dot (= minimum angle), rooted at the member nearest the centroid.
      let cx = 0,
        cy = 0,
        cz = 0;
      for (const i of slots) {
        cx += d[i * 3]!;
        cy += d[i * 3 + 1]!;
        cz += d[i * 3 + 2]!;
      }
      let root = 0;
      let best = -2;
      for (let i = 0; i < n; i++) {
        const v = d[slots[i]! * 3]! * cx + d[slots[i]! * 3 + 1]! * cy + d[slots[i]! * 3 + 2]! * cz;
        if (v > best) {
          best = v;
          root = i;
        }
      }
      const inTree = new Uint8Array(n);
      const bestDot = new Float32Array(n).fill(-2);
      const from = new Int32Array(n).fill(-1);
      const depth = new Int32Array(n);
      inTree[root] = 1;
      for (let j = 0; j < n; j++)
        if (j !== root) {
          bestDot[j] = dist(root, j);
          from[j] = root;
        }
      const key = (a: number, b: number): number => (a < b ? a * 65536 + b : b * 65536 + a);
      for (let step = 1; step < n; step++) {
        let pick = -1;
        let pv = -3;
        for (let j = 0; j < n; j++)
          if (!inTree[j] && bestDot[j]! > pv) {
            pv = bestDot[j]!;
            pick = j;
          }
        if (pick < 0) break;
        inTree[pick] = 1;
        depth[pick] = depth[from[pick]!]! + 1;
        const a = slots[from[pick]!]!;
        const b = slots[pick]!;
        want.set(key(a, b), { a, b, depth: depth[pick]! });
        for (let j = 0; j < n; j++)
          if (!inTree[j]) {
            const v = dist(pick, j);
            if (v > bestDot[j]!) {
              bestDot[j] = v;
              from[j] = pick;
            }
          }
      }
      // Loop-closing links: connect some nodes to their nearest non-tree neighbour.
      for (let i = 0; i < n; i++) {
        if (hash01(s.id[slots[i]!]! * 7 + 3) > 0.42) continue;
        let bj = -1;
        let bv = -2;
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          const k = key(slots[i]!, slots[j]!);
          if (want.has(k)) continue;
          const v = dist(i, j);
          if (v > bv) {
            bv = v;
            bj = j;
          }
        }
        if (bj >= 0 && bv > 0.6)
          want.set(key(slots[i]!, slots[bj]!), {
            a: slots[i]!,
            b: slots[bj]!,
            depth: Math.max(depth[i]!, depth[bj]!) + 1,
          });
      }
    }
    // Diff against existing arcs
    for (const [k, v] of this.conHandles) {
      if (!want.has(k)) {
        this.held.fadeOut(v.h, this.time, 0.5);
        this.conHandles.delete(k);
      }
    }
    const c = this.fx.color('constellation', new THREE.Color());
    // One tick per hub per half second: a hub holding dozens of instances would otherwise stack
    // dozens of additive blips at different heights of its spire into one white blob.
    const ticked = new Map<number, number>();
    for (const [k, w] of want) {
      if (this.conHandles.has(k)) continue;
      const a = this.dirAngle(w.a, w.b);
      const start = this.time + (first ? w.depth * 0.22 : 0.05);
      const h = this.held.add(
        w.a,
        w.b,
        RibbonStyle.Tree,
        start,
        0.7 + 0.3 * a,
        1e9,
        arcLift(a, 0.01, 0.03),
        1.1,
        c.r,
        c.g,
        c.b,
        0.9,
      );
      if (h >= 0) this.conHandles.set(k, { h, start });
      // Impact tick at the far end when the head arrives.
      if (first) {
        const at = start + 0.7 + 0.3 * a;
        const hub = this.nodes.cluster[w.b]!;
        const last = ticked.get(hub);
        if (last === undefined || Math.abs(at - last) > 0.5) {
          this.rings.add(w.b, RingKind.Tick, at, 0.9, 0.02, c.r, c.g, c.b, 1.1);
          ticked.set(hub, at);
        }
      }
    }
  }

  private dirAngle(a: number, b: number): number {
    const d = this.nodes.dir;
    return angleBetween(d[a * 3]!, d[a * 3 + 1]!, d[a * 3 + 2]!, d[b * 3]!, d[b * 3 + 1]!, d[b * 3 + 2]!);
  }

  // ---- events -----------------------------------------------------------------------------

  /** Feed a live event. Everything is scheduled with a visual budget (see choreographer.ts). */
  enqueue(ev: GlobeEvent): void {
    // In ambient mode the director gets a short head start on a block so the camera is already
    // moving when the flare goes off. State changes still apply immediately.
    if (ev.type === 'block' && this.mode === 'ambient' && this.director && !this.hidden) {
      const lead = this.director.onBlockIncoming(ev);
      this.choreo.enqueue(ev, lead);
      return;
    }
    this.choreo.enqueue(ev);
  }

  /**
   * For a host that drives `sink` itself: tells the ambient director (and the lab's overlays, through
   * the `block` event) that a block is about to play, so the camera can cut to it. Returns the head
   * start, in seconds, the director would like before `sink.beat` (0 outside ambient mode); a host that
   * must never delay the Beat can ignore it, and the camera then cuts on the flare instead.
   */
  announceBlock(ev: Omit<import('./types').BlockEvent, 'type'>): number {
    const full = { type: 'block', ...ev } as import('./types').BlockEvent;
    const lead =
      this.mode === 'ambient' && this.director && !this.hidden ? this.director.onBlockIncoming(full) : 0;
    this.emit('block', full);
    return lead;
  }

  /** Block production: producer to payees. Sugar for `enqueue({ type: 'block', ... })`. */
  emitBlock(ev: Omit<import('./types').BlockEvent, 'type'>): void {
    this.enqueue({ type: 'block', ...ev });
  }

  private readonly aimList: AimAnchor[] = Array.from({ length: 8 }, () => ({
    id: 0,
    slot: -1,
    tier: 0,
    x: 0,
    y: 0,
    visible: false,
  }));
  private readonly aimView = { count: 0, list: this.aimList };

  /**
   * Screen positions of the pre-aimed next payees (valid until the block lands). The returned object
   * and its entries are reused on every call; a host draws its reticle labels from them each frame.
   */
  aimAnchors(): { count: number; list: readonly AimAnchor[] } {
    const c = this.choreo;
    const s = this.nodes;
    const n = Math.min(c.aimedCount, this.aimList.length);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const slot = c.aimedSlot(i);
      if (slot < 0 || s.alive[slot] !== 1) continue;
      const a = this.aimList[k++]!;
      a.id = s.id[slot]!;
      a.slot = slot;
      a.tier = s.tier[slot]!;
      a.visible = this.rig.project(
        s.pos[slot * 4]!,
        s.pos[slot * 4 + 1]!,
        s.pos[slot * 4 + 2]!,
        this.cssW,
        this.cssH,
        this.tmpScreen,
      );
      a.x = this.tmpScreen.x;
      a.y = this.tmpScreen.y;
    }
    this.aimView.count = k;
    return this.aimView;
  }

  /** Manual pulse on a node (an echo ring and a flash). */
  pulse(id: number, opts: { color?: 'accent' | 'block' | 'alert' | 'tier'; strong?: boolean } = {}): void {
    const slot = this.nodes.slotOf(id);
    if (slot < 0) return;
    const c =
      opts.color === 'tier' || !opts.color
        ? this.fx.tierColor(this.nodes.tier[slot]!, new THREE.Color())
        : this.fx.color(opts.color, new THREE.Color());
    this.fx.ring(slot, RingKind.Pulse, c, opts.strong ? 0.09 : 0.05, 1.6, 1.3);
    this.fx.flash(slot, opts.strong ? 2.2 : 1.4);
  }

  private choreoHost(): ChoreoHost {
    const self = this;
    return {
      fx: this.fx,
      store: this.nodes,
      mesh: this.mesh,
      get hidden() {
        return self.hidden;
      },
      set hidden(_v: boolean) {
        /* read-only */
      },
      now: () => self.time,
      emit: (type, payload) => self.emit(type, payload),
      addNode: (rec, delay) => self.addNodeAndRefresh(rec, delay),
      removeNode: (id, delay) => self.removeNodeAndRefresh(id, delay),
      setStatus: (slot, status) => {
        self.nodes.status[slot] = status;
        self.nodes.markAttr(slot);
      },
      constellationChange: (app, slot, op) => self.constellationChange(app, slot, op),
      transientConstellation: (slots, n, seconds) => self.transientConstellation(slots, n, seconds),
      addLink: (a, b, animate) => self.addLinkInternal(a, b, animate),
      showLink: (e) => self.showLink(e),
      removeLink: (a, b, animate) => self.removeLinkInternal(a, b, animate),
      tokens: () => self.tokens,
      linkShow: (a, b) => {
        let e = self.addLinkInternal(a, b, true);
        if (e < 0) e = self.mesh.find(a, b);
        if (e >= 0) self.showLink(e);
      },
      linkHide: (a, b) => self.removeLinkInternal(a, b, true),
      flushQueued: () => self.choreo.flush(),
      isFocused: (slot) => self.isFocused(slot),
      moon: () => (self.moon.enabled ? self.moon : null),
      flowEnabled: () => self.meshMode === 'flow' && self.effects.mesh,
      screenOf: (slot, out) => {
        const pt = self.tmpScreen;
        const n = self.nodes;
        self.rig.project(
          n.pos[slot * 4]!,
          n.pos[slot * 4 + 1]!,
          n.pos[slot * 4 + 2]!,
          self.cssW,
          self.cssH,
          pt,
        );
        out.x = pt.x;
        out.y = pt.y;
      },
      moonPiecePoint: (piece, out) => {
        self.moon.anchor(piece, self.tmpMoonV);
        self.rig.project(
          self.tmpMoonV.x,
          self.tmpMoonV.y,
          self.tmpMoonV.z,
          self.cssW,
          self.cssH,
          self.tmpScreen,
        );
        out.x = self.tmpScreen.x;
        out.y = self.tmpScreen.y;
      },
    } as ChoreoHost;
  }

  private addNodeAndRefresh(rec: NodeRecord, delay: number): number {
    const slot = this.addNodeInternal(rec, delay);
    this.nodes.posDirty = true;
    this.mesh.resolveDirty = true;
    this.mesh.adjDirty = true;
    this.hubsDirty = true;
    return slot;
  }

  private removeNodeAndRefresh(id: number, delay: number): number {
    const slot = this.removeNodeInternal(id, delay);
    this.nodes.posDirty = true;
    this.hubsDirty = true;
    return slot;
  }

  private isFocused(slot: number): boolean {
    return (this.nodes.state[slot]! & (NodeState.Selected | NodeState.Watched | NodeState.Related)) !== 0 &&
      this.focusTarget > 0
      ? true
      : (this.nodes.state[slot]! & (NodeState.Selected | NodeState.Watched)) !== 0;
  }

  private constellationChange(app: string, slot: number, op: 'spawn' | 'remove'): boolean {
    if (!this.conActive || this.conName === '' || this.conName.toLowerCase() !== app.toLowerCase())
      return false;
    const idx = this.conSlots.indexOf(slot);
    if (op === 'spawn' && idx < 0) {
      this.conSlots.push(slot);
      this.nodes.setState(slot, NodeState.Related, true);
    } else if (op === 'remove' && idx >= 0) {
      this.conSlots.splice(idx, 1);
      this.nodes.setState(slot, NodeState.Related, false);
    } else {
      return true;
    }
    this.buildConstellationArcs(false);
    return true;
  }

  /** A short-lived constellation for a freshly deployed app (not the selected one). */
  private transientConstellation(slots: Int32Array, n: number, seconds: number): void {
    if (this.conActive || n < 2) return;
    const s = this.nodes;
    const c = this.fx.color('constellation', new THREE.Color());
    // Connect in order of angular proximity with a simple chain from the first slot.
    const used = new Uint8Array(n);
    let cur = 0;
    used[0] = 1;
    for (let k = 1; k < n; k++) {
      let best = -1;
      let bv = -2;
      for (let j = 0; j < n; j++) {
        if (used[j]) continue;
        const v =
          s.dir[slots[cur]! * 3]! * s.dir[slots[j]! * 3]! +
          s.dir[slots[cur]! * 3 + 1]! * s.dir[slots[j]! * 3 + 1]! +
          s.dir[slots[cur]! * 3 + 2]! * s.dir[slots[j]! * 3 + 2]!;
        if (v > bv) {
          bv = v;
          best = j;
        }
      }
      if (best < 0) break;
      used[best] = 1;
      const a = this.dirAngle(slots[cur]!, slots[best]!);
      this.arcs.add(
        slots[cur]!,
        slots[best]!,
        RibbonStyle.Tree,
        this.time + k * 0.18,
        0.7 + 0.3 * a,
        seconds,
        arcLift(a, 0.01, 0.03),
        1.1,
        c.r,
        c.g,
        c.b,
        0.9,
      );
      cur = best;
    }
  }

  // ---- label anchors ----------------------------------------------------------------------

  /**
   * Replaces the registered label anchors. Their screen positions are recomputed once per frame
   * (after the camera moved, before the frame event) and read with `labelAnchors()`.
   */
  setLabelAnchors(list: readonly LabelAnchorInput[]): void {
    this.anchorIn = list.slice();
    const out: LabelAnchor[] = [];
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!;
      const prev = this.anchorOut[i];
      const o: LabelAnchor = prev ?? {
        id: '',
        kind: 'custom',
        text: '',
        x: 0,
        y: 0,
        visible: false,
        depth: 1,
        facing: -1,
      };
      o.id = a.id;
      o.kind = a.kind ?? (a.nodeId !== undefined ? 'node' : 'custom');
      o.text = a.text ?? '';
      out.push(o);
    }
    this.anchorOut = out;
    this.anchorFrame = -1;
  }

  /**
   * This frame's projections of the registered anchors, in registration order. Occlusion-culled:
   * a point behind the planet (past the limb, with its lift) or outside the viewport is not
   * `visible`. The array and its objects are reused; read them, do not keep them.
   */
  labelAnchors(): readonly LabelAnchor[] {
    if (this.anchorFrame !== this.frameNo) this.updateLabelAnchors();
    return this.anchorOut;
  }

  private updateLabelAnchors(): void {
    this.anchorFrame = this.frameNo;
    const n = this.anchorIn.length;
    if (n === 0) return;
    const s = this.nodes;
    const pt = this.tmpScreen;
    const cam = this.rig.camera.position;
    const w = this.cssW;
    const h = this.cssH;
    for (let i = 0; i < n; i++) {
      const a = this.anchorIn[i]!;
      const o = this.anchorOut[i]!;
      let x = 0;
      let y = 0;
      let z = 0;
      let ok = true;
      if (a.nodeId !== undefined) {
        const slot = s.slotOf(a.nodeId);
        if (slot < 0 || s.alive[slot] === 0) ok = false;
        else {
          x = s.pos[slot * 4]!;
          y = s.pos[slot * 4 + 1]!;
          z = s.pos[slot * 4 + 2]!;
        }
      } else if (
        a.lat !== undefined &&
        a.lon !== undefined &&
        Number.isFinite(a.lat) &&
        Number.isFinite(a.lon)
      ) {
        const r = 1 + (a.alt ?? 0.01);
        const la = a.lat * DEG;
        const lo = a.lon * DEG;
        const c = Math.cos(la);
        x = c * Math.sin(lo) * r;
        y = Math.sin(la) * r;
        z = c * Math.cos(lo) * r;
      } else ok = false;
      if (!ok) {
        o.visible = false;
        o.facing = -1;
        continue;
      }
      const vis = this.rig.project(x, y, z, w, h, pt);
      const len = Math.hypot(x, y, z) || 1;
      const dx = cam.x - x;
      const dy = cam.y - y;
      const dz = cam.z - z;
      const dl = Math.hypot(dx, dy, dz) || 1;
      o.facing = (x * dx + y * dy + z * dz) / (len * dl);
      o.x = pt.x;
      o.y = pt.y;
      o.depth = pt.depth;
      o.visible = vis && pt.x >= -40 && pt.x <= w + 40 && pt.y >= -40 && pt.y <= h + 40;
    }
  }

  // ---- projection & info ------------------------------------------------------------------

  private readonly densityBuf = { frame: -1, cols: 0, rows: 0, sat: new Uint32Array(0) };
  private readonly densityApi = {
    count: (x0: number, y0: number, x1: number, y1: number): number => this.densityCount(x0, y0, x1, y1),
  };
  private static readonly DENSITY_CELL = 12;

  /**
   * Nodes on screen this frame as a summed-area table of 12 px cells: `count(x0, y0, x1, y1)` is the
   * number of visible nodes in a box (CSS px), in constant time. Built at most once a frame, on demand
   * (the place labels keep off dense clusters with it).
   */
  nodeDensity(): { count(x0: number, y0: number, x1: number, y1: number): number } {
    const d = this.densityBuf;
    if (d.frame !== this.frameNo) this.buildDensity();
    return this.densityApi;
  }

  private buildDensity(): void {
    const d = this.densityBuf;
    d.frame = this.frameNo;
    const C = GlobeEngine.DENSITY_CELL;
    const cols = Math.max(1, Math.ceil(this.cssW / C));
    const rows = Math.max(1, Math.ceil(this.cssH / C));
    const n = (cols + 1) * (rows + 1);
    if (d.sat.length < n) d.sat = new Uint32Array(n);
    const sat = d.sat;
    sat.fill(0, 0, n);
    d.cols = cols;
    d.rows = rows;
    const cam = this.rig.camera;
    const m = this.tmpMat.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).elements;
    const cp = this.rig.position;
    const s = this.nodes;
    const pos = s.pos;
    const W = cols + 1;
    for (let i = 0; i < s.high; i++) {
      if (s.alive[i] !== 1) continue;
      const o = i * 4;
      if (pos[o + 3]! <= 0) continue;
      const x = pos[o]!;
      const y = pos[o + 1]!;
      const z = pos[o + 2]!;
      // Over the horizon: hidden by the planet.
      if (x * cp.x + y * cp.y + z * cp.z < x * x + y * y + z * z) continue;
      const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
      if (w <= 1e-3) continue;
      const sx = ((m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w) * 0.5 + 0.5;
      const sy = 0.5 - ((m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w) * 0.5;
      const cx = Math.floor((sx * this.cssW) / C);
      const cy = Math.floor((sy * this.cssH) / C);
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
      sat[(cy + 1) * W + cx + 1]!++;
    }
    for (let r = 1; r <= rows; r++) {
      let run = 0;
      for (let c = 1; c <= cols; c++) {
        run += sat[r * W + c]!;
        sat[r * W + c] = sat[(r - 1) * W + c]! + run;
      }
    }
  }

  private densityCount(x0: number, y0: number, x1: number, y1: number): number {
    const d = this.densityBuf;
    if (d.frame < 0) return 0;
    const C = GlobeEngine.DENSITY_CELL;
    const W = d.cols + 1;
    const c0 = clamp(Math.floor(x0 / C), 0, d.cols);
    const c1 = clamp(Math.ceil(x1 / C), 0, d.cols);
    const r0 = clamp(Math.floor(y0 / C), 0, d.rows);
    const r1 = clamp(Math.ceil(y1 / C), 0, d.rows);
    if (c1 <= c0 || r1 <= r0) return 0;
    const t = d.sat;
    return t[r1 * W + c1]! - t[r0 * W + c1]! - t[r1 * W + c0]! + t[r0 * W + c0]!;
  }
  private readonly tmpMat = new THREE.Matrix4();

  /** Projects a lat/lon (and radius, default 1) to CSS pixels on the canvas. */
  project(lat: number, lon: number, radius: number, out: ScreenPoint): boolean {
    const la = lat * DEG;
    const lo = lon * DEG;
    const c = Math.cos(la);
    return this.rig.project(
      c * Math.sin(lo) * radius,
      Math.sin(la) * radius,
      c * Math.cos(lo) * radius,
      this.cssW,
      this.cssH,
      out,
    );
  }

  /** Projects a node's current display position. */
  projectNode(id: number, out: ScreenPoint): boolean {
    const s = this.nodes;
    const slot = s.slotOf(id);
    if (slot < 0) return false;
    return this.rig.project(
      s.pos[slot * 4]!,
      s.pos[slot * 4 + 1]!,
      s.pos[slot * 4 + 2]!,
      this.cssW,
      this.cssH,
      out,
    );
  }

  /** Looks up a node's static info by id. Returns null when unknown. */
  nodeInfo(id: number): PickInfo | null {
    const slot = this.nodes.slotOf(id);
    return slot < 0 ? null : this.makePickInfo(slot, false, 0, 0);
  }

  private makePickInfo(slot: number, isCluster: boolean, x: number, y: number): PickInfo {
    const s = this.nodes;
    const c = s.cluster[slot]!;
    return {
      id: s.id[slot]!,
      slot,
      loc: s.locId[slot]!,
      clusterSize: c === NO_CLUSTER ? 1 : s.cLive[c]!,
      isCluster,
      lat: s.lat[slot]!,
      lon: s.lon[slot]!,
      tier: s.tier[slot]!,
      status: s.status[slot]!,
      flags: s.flags[slot]!,
      x,
      y,
    };
  }

  /** The biggest hubs (co-location clusters), largest first. The returned array is reused. */
  getHubs(max = 12): HubInfo[] {
    this.ensureHubs();
    return this.hubsCache.length > max ? this.hubsCache.slice(0, max) : this.hubsCache;
  }

  /** Rebuilds the sorted hub list when the clusters changed (cheap, at most a few times per second). */
  private ensureHubs(): void {
    if (!this.hubsDirty) return;
    const nowMs = performance.now();
    if (this.hubsCache.length > 0 && nowMs - this.hubsAt < 500) return;
    this.hubsAt = nowMs;
    const s = this.nodes;
    const list: HubInfo[] = [];
    for (let c = 0; c < s.clusterCount; c++) {
      if (s.cLive[c]! < 2) continue;
      list.push({
        cluster: c,
        loc: s.cLoc[c]!,
        lat: s.cLat[c]!,
        lon: s.cLon[c]!,
        count: s.cLive[c]!,
        tiers: [s.cTier[c * 3]!, s.cTier[c * 3 + 1]!, s.cTier[c * 3 + 2]!],
      });
    }
    list.sort((a, b) => b.count - a.count);
    this.hubsCache = list;
    this.hubsDirty = false;
  }

  get hubCount(): number {
    this.ensureHubs();
    return this.hubsCache.length;
  }

  // ---- interaction ------------------------------------------------------------------------

  private doPick(x: number, y: number): boolean {
    const fan = this.layoutFan < 0 ? 0 : this.layoutFan;
    const hit = this.picker.pick(
      x,
      y,
      this.cssW,
      this.cssH,
      this.tokens.nodeScale,
      this.nodeWorld.value,
      this.pickScratch,
    );
    if (hit) return true;
    if (this.effects.spires && fan < 0.85)
      return this.picker.pickColumn(x, y, this.cssW, this.cssH, fan, this.pickScratch);
    return false;
  }

  private readonly nodeWorld = { value: 0.002 };

  /** Screen disc of the moon for this frame (center, radius in CSS pixels, visible past the planet's limb). */
  private stepInset(dt: number): void {
    if (this.insetT >= 1) return;
    this.insetT = Math.min(1, this.insetT + dt / this.insetDur);
    const e = this.insetT < 0.5 ? 4 * this.insetT ** 3 : 1 - (-2 * this.insetT + 2) ** 3 / 2;
    const a = this.insetFrom;
    const b = this.insetTo;
    const n = this.insetNow;
    n.left = a.left + (b.left - a.left) * e;
    n.right = a.right + (b.right - a.right) * e;
    n.top = a.top + (b.top - a.top) * e;
    n.bottom = a.bottom + (b.bottom - a.bottom) * e;
  }

  /** The home zoom: a portrait screen (the phone) frames tighter so the globe fills the width. */
  get homeRange(): number {
    return this.cssW / Math.max(1, this.cssH) < 0.8 ? 2.85 : 3.6;
  }

  private applyFraming(): void {
    const rig = this.rig;
    const f = computeFraming(
      {
        w: this.cssW,
        h: this.cssH,
        inset: this.insetNow,
        tanHalfFov: rig.tanHalfFovBase,
        homeRange: this.homeRange,
        weight: rig.framed,
      },
      this.framingSpec,
    );
    rig.setViewShift(f.shiftX, f.shiftY);
    rig.setFit(f.fit * this.viewScaleNow);
    this.frameNow = f;
  }

  /**
   * The current framing, CSS px: the free area (the viewport minus the chrome's inset), where the
   * planet's centre goes, the lens fit, the planet's radius at the home zoom (`homeRadius`) and its
   * projected disc right now (`center`, `radius`: pitch and zoom included).
   */
  framing(): {
    free: Rect;
    center: { x: number; y: number };
    radius: number;
    homeRadius: number;
    fit: number;
  } {
    const pt = this.tmpScreen;
    this.rig.project(0, 0, 0, this.cssW, this.cssH, pt);
    const d = Math.max(1.0002, this.rig.distance);
    const f = this.frameNow;
    return {
      free: { ...f.free },
      center: { x: pt.x, y: pt.y },
      radius: this.rig.projScale / Math.sqrt(d * d - 1),
      homeRadius: f.homeRadius,
      fit: f.fit,
    };
  }

  /** Back to the home view: north up, no pitch, the home zoom, over the current spot (eased). */
  home(): Promise<boolean> {
    this.director?.interrupt();
    this.moonView = null;
    this.rig.releaseFree(2.2);
    return this.rig.home(this.homeRange);
  }

  private updateMoonScreen(): void {
    // Where the moon is on screen (it follows its place on the world orbit); the pointer takes it only when the planet is not hiding it.
    const sc = this.moon.screen;
    const mp = this.moonPx;
    mp.x = sc.x;
    mp.y = sc.y;
    mp.r = sc.r;
    mp.visible = sc.hit;
  }

  private moonHit(x: number, y: number): boolean {
    const mp = this.moonPx;
    if (!mp.visible || !this.moon.enabled) return false;
    const dx = x - mp.x;
    const dy = y - mp.y;
    return dx * dx + dy * dy <= mp.r * mp.r;
  }

  private setMoonHover(on: boolean): void {
    if (on === this.moonHovered) return;
    this.moonHovered = on;
    this.moon.hoverTarget = on ? 1 : 0;
    this.canvas.style.cursor = on ? 'pointer' : '';
    const mp = this.moonPx;
    this.emit('moonhover', { hovered: on, on, x: mp.x, y: mp.y, r: mp.r });
  }

  private handleHover(): void {
    this.hoverDirty = false;
    if (this.mode !== 'explore' || !this.hoverInside || this.rig.isGrabbing) {
      if (this.hoverSlot >= 0 || this.hoverCluster >= 0) this.clearHover();
      this.setMoonHover(false);
      return;
    }
    if (this.moonHit(this.hoverX, this.hoverY)) {
      if (this.hoverSlot >= 0 || this.hoverCluster >= 0) this.clearHover();
      this.setMoonHover(true);
      return;
    }
    this.setMoonHover(false);
    const hit = this.doPick(this.hoverX, this.hoverY);
    const slot = hit ? this.pickScratch.slot : -1;
    const cluster = hit ? this.pickScratch.cluster : -1;
    // A stack reads as its site until it fans out: the same node can change what it stands for.
    const site =
      slot >= 0 &&
      (this.pickScratch.column ||
        (this.layoutFan < 0.55 && cluster !== NO_CLUSTER && this.nodes.cLive[cluster]! > 1));
    // `hover` is emitted when what the pointer is on changes (a node, a site, nothing), never per frame.
    if (slot === this.hoverSlot && (slot < 0 || site === this.hoverSite)) return;
    if (slot !== this.hoverSlot) {
      if (this.hoverSlot >= 0) this.nodes.setState(this.hoverSlot, NodeState.Hovered, false);
      this.hoverSlot = slot;
      if (slot >= 0) this.nodes.setState(slot, NodeState.Hovered, true);
      this.canvas.style.cursor = slot >= 0 ? 'pointer' : '';
    }
    this.hoverCluster = cluster;
    this.hoverSite = site;
    this.emit(
      'hover',
      slot >= 0 ? this.makePickInfo(slot, site, this.pickScratch.x, this.pickScratch.y) : null,
    );
  }
  private hoverSite = false;

  private clearHover(): void {
    if (this.hoverSlot >= 0) this.nodes.setState(this.hoverSlot, NodeState.Hovered, false);
    const had = this.hoverSlot >= 0;
    this.hoverSlot = -1;
    this.hoverCluster = -1;
    this.canvas.style.cursor = '';
    if (had) this.emit('hover', null);
  }

  private handleClick(x: number, y: number): void {
    if (this.mode !== 'explore') return;
    if (this.moonHit(x, y)) {
      // The moon opens the About Flux window in the app; here it answers with a dip and a flare.
      this.moon.press();
      this.moon.flareAll(0.8, 0.5);
      const mp = this.moonPx;
      this.emit('moon', { x: mp.x, y: mp.y, r: mp.r });
      this.emit('moonclick', { x: mp.x, y: mp.y });
      return;
    }
    if (!this.doPick(x, y)) {
      if (this.selectedSlot >= 0) this.select(null);
      return;
    }
    const slot = this.pickScratch.slot;
    const c = this.pickScratch.cluster;
    const stacked = this.layoutFan < 0.55 && c !== NO_CLUSTER && this.nodes.cLive[c]! > 1;
    if (this.pickScratch.column || stacked) {
      // A hub: fly in so the stack unfurls, then individual nodes become pickable.
      this.selectedCluster = c;
      this.emit('select', this.makePickInfo(slot, true, x, y));
      if (c !== NO_CLUSTER) {
        const st = this.nodes;
        this.emit('pickCluster', {
          cluster: c,
          loc: st.cLoc[c]!,
          lat: st.cLat[c]!,
          lon: st.cLon[c]!,
          count: st.cLive[c]!,
          tiers: [st.cTier[c * 3]!, st.cTier[c * 3 + 1]!, st.cTier[c * 3 + 2]!],
          x,
          y,
        });
      }
      this.flyToCluster(c);
    } else {
      this.select(this.nodes.id[slot]!);
    }
  }

  private handleDoubleClick(x: number, y: number): void {
    if (this.mode !== 'explore') return;
    const ndcX = (x / this.cssW) * 2 - 1;
    const ndcY = -((y / this.cssH) * 2 - 1);
    const p = new THREE.Vector3();
    if (this.rig.pickSurface(ndcX, ndcY, p)) {
      const lat = Math.asin(clamp(p.y, -1, 1)) * RAD;
      const lon = Math.atan2(p.x, p.z) * RAD;
      this.flyTo(lat, lon, Math.max(0.14, this.rig.range * 0.42), { tilt: this.rig.tilt });
    }
  }

  // ---- lifecycle --------------------------------------------------------------------------

  private start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.lastMs = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Stops the animation loop (frames then only advance through `stepFrame`): for deterministic captures and tests. */
  pause(): void {
    this.stop();
  }

  /** Restarts the animation loop after `pause`. */
  resume(): void {
    if (!this.contextLost && !document.hidden) this.start();
  }

  private readonly onVisibility = (): void => {
    this.hidden = document.hidden;
    if (document.hidden) {
      this.stop();
    } else if (!this.contextLost) {
      // Skip queued flourishes; state was applied when the events arrived.
      this.choreo.flush();
      this.arcs.clear();
      this.packets.clear();
      this.rings.clear();
      this.rays.clear();
      this.lastMs = performance.now();
      this.start();
    }
  };

  private readonly onMotionPref = (e: MediaQueryListEvent): void => {
    if (this.opts.respectReducedMotion ?? true) {
      this.reducedMotion = e.matches;
      this.u.uReduced.value = e.matches ? 1 : 0;
      this.fx.reduced = e.matches;
      this.rig.reduced = e.matches;
    }
  };

  private readonly onContextLost = (e: Event): void => {
    e.preventDefault();
    this.contextLost = true;
    this.contextEverLost = true;
    this.stop();
  };
  /** Once lost, every GPU object belongs to a dead context: dispose() leaves them to the collector. */
  private contextEverLost = false;

  private readonly onContextRestored = (): void => {
    this.contextLost = false;
    this.resizeDirty = true;
    this.start();
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.ro?.disconnect();
    this.mql?.removeEventListener?.('change', this.onMotionPref);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.director?.stop();
    this.controls.dispose();
    this.choreo.dispose();
    this.listeners.clear();
    if (this.contextEverLost) {
      // Deleting them would only make the browser warn ("object does not belong to this context")
      // once the context is restored; stop late asset uploads and let the rest go.
      this.assets.dispose(false);
      return;
    }
    for (const k of Object.keys(this.bodies) as ArtDirection[]) this.bodies[k]?.dispose();
    this.borders.dispose();
    this.nodeLayer.dispose();
    this.clusterLayer.dispose();
    this.arcs.dispose();
    this.held.dispose();
    this.packets.dispose();
    this.links.dispose();
    this.rings.dispose();
    this.rays.dispose();
    this.moon.dispose();
    this.sky.dispose();
    this.atmosphere.dispose();
    this.post.dispose();
    this.assets.dispose();
    this.renderer.dispose();
  }

  // ---- frame ------------------------------------------------------------------------------

  private applySize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.cssW = Math.max(1, rect.width);
    this.cssH = Math.max(1, rect.height);
    const devDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.dpr = Math.min(devDpr, this.profile.maxDpr, this.opts.maxDpr ?? 2);
    const bw = Math.max(2, Math.round(this.cssW * this.dpr));
    const bh = Math.max(2, Math.round(this.cssH * this.dpr));
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(bw, bh, false);
    const sw = Math.max(2, Math.round(bw * this.renderScale));
    const sh = Math.max(2, Math.round(bh * this.renderScale));
    this.post.resize(sw, sh, this.profile.msaa, this.profile.bloomLevels);
    this.u.uViewport.value.set(sw, sh);
    this.u.uPxScale.value = this.dpr * this.renderScale;
    this.rig.setViewport(this.cssW, this.cssH);
    if (!this.framed) {
      // A portrait screen (the phone) opens with a tighter framing: the globe fills the width.
      this.framed = true;
      if (this.cssW / this.cssH < 0.8) {
        this.rig.range = 2.85;
        this.rig.rangeD = 2.85;
      }
    }
    this.resizeDirty = false;
  }

  private readonly frame = (nowMs: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    const cpu0 = performance.now();
    if (this.resizeDirty) this.applySize();
    const dtRaw = (nowMs - this.lastMs) / 1000;
    this.lastMs = nowMs;
    const dt = clamp(dtRaw, 0, 0.1);
    this.time = (nowMs - this.startMs) / 1000;
    this.update(dt);
    this.render();
    this.track(dtRaw, performance.now() - cpu0);
  };

  /** Advance one simulation step and draw, for deterministic captures. */
  stepFrame(dt: number): void {
    this.time += dt;
    this.update(dt);
    this.render();
  }

  private update(dt: number): void {
    const u = this.u;
    const s = this.nodes;
    u.uTime.value = this.time;
    this.fx.time = this.time;
    this.fx.reduced = this.reducedMotion;
    this.rig.reduced = this.reducedMotion;

    if (this.mode === 'ambient') this.director?.update(dt);
    this.shots.fovV = this.rig.fovV;
    this.shots.aspect = this.rig.aspect;
    if (this.moonView && this.moon.enabled) this.applyMoonView(this.moonView);
    // The globe is framed in the free area of the viewport (the part the chrome and docked windows
    // leave open): optically centred, and fitted with clearance at the home zoom (framing.ts).
    this.stepInset(dt);
    this.stepViewScale(dt);
    this.applyFraming();
    u.uViewShift.value.set(this.rig.shiftNdcX, this.rig.shiftNdcY);
    this.rig.update(dt, this.time);
    // Layout: stack <-> fan by camera range.
    const range = this.rig.lodRange;
    // Stacks always unfurl into fans with zoom (spires only change how tall the towers draw).
    const fan = 1 - smoothstep(0.35, 1.45, range);
    const spacing = this.fanSpacingFor(range);
    if (
      s.posDirty ||
      Math.abs(fan - this.layoutFan) > 0.0012 ||
      Math.abs(spacing / Math.max(1e-6, this.layoutSpacing) - 1) > 0.008 ||
      this.layoutAnimating
    ) {
      this.layoutAnimating = computeLayout(s, {
        belt: this.showBelt,
        fan,
        spacing,
        spireScale: this.tokens.spireScale * (this.effects.spires ? 1 : 0.0001),
        minTower: this.towerThreshold(range),
        pxPerRad: this.rig.projScale / Math.max(1.02, this.rig.distance),
        dt,
      });
      this.layoutFan = fan;
      this.layoutSpacing = spacing;
      s.posDirty = true;
    }
    this.holdAnchor();
    const cam = this.rig.camera;
    u.uCamPos.value.copy(cam.position);
    u.uCamRight.value.copy(this.rig.right);
    u.uCamUp.value.copy(this.rig.up);
    u.uCamBack.value.copy(this.rig.viewDir).negate();
    u.uTanHalfFov.value = Math.tan((this.rig.fovV * Math.PI) / 360);
    u.uAspect.value = this.rig.aspect;
    u.uProjScale.value = this.rig.projScale * this.renderScale * this.dpr;

    this.fx.camDir.copy(cam.position).normalize();
    this.fx.horizonCos = 1 / Math.max(1.0001, this.rig.distance);

    // The Flux moon (after the camera, so it faces the camera it will be drawn with).
    const moon = this.moon;
    if (moon.enabled) {
      moon.reduced = this.reducedMotion;
      // An app constellation or a focus set (the operator's fan) on screen: the chain steps back (design 7.10.3).
      moon.chainDim = this.conActive || this.focusOnly ? 1 : 0;
      // A free moon shot (portrait, earthrise, eclipse, follow) lifts the moon onto the sky orbit; otherwise it rides the shell ring.
      moon.lift(this.moonView !== null);
      const mv = this.moonViewBuf;
      mv.camera = cam;
      mv.up.copy(this.rig.up);
      mv.cssW = this.cssW;
      mv.cssH = this.cssH;
      mv.pxScale = this.u.uPxScale.value;
      mv.projScale = this.rig.projScale;
      const dd = Math.max(1.0002, this.rig.distance);
      mv.planetR = this.rig.projScale / Math.sqrt(dd * dd - 1);
      mv.surf = Math.max(0.0005, this.rig.distance - 1);
      mv.inset = this.insetNow;
      mv.insetGoal = this.insetTo;
      moon.update(dt, this.time, mv, {
        rate: this.sunRate,
        free: this.rig.isFree,
        ambient: this.mode === 'ambient',
        utcMs: this.sunTimeMs,
      });
      // The moon is a world object: the far plane keeps its orbit and the near plane never cuts it.
      this.rig.farExtra = moon.shape.radius + 0.4;
      this.rig.protectCenter.copy(moon.pos);
      this.rig.protectRadius = moon.radius * 1.2;
      this.updateMoonScreen();
    } else {
      this.rig.farExtra = 0;
      this.rig.protectRadius = 0;
      this.moonPx.visible = false;
    }
    this.emitCamera();
    this.frameNo++;

    const ms = this.sunTimeMs;
    sunVector(ms, u.uSunDir.value);
    subsolarPoint(ms, this.sub);

    this.fade = damp(this.fade, 1, 1.4, dt);
    if (this.sceneFade !== this.sceneFadeTarget) {
      const step = dt / this.sceneFadeSeconds;
      this.sceneFade += clamp(this.sceneFadeTarget - this.sceneFade, -step, step);
    }
    // Idle drift (design 6.x, controls): 1.2 degrees per second once nothing has touched the globe for 20 s.
    if (
      this.idleDrift &&
      this.mode === 'explore' &&
      !this.reducedMotion &&
      !this.hidden &&
      this.time - this.lastInputT > 20 &&
      this.bandNow === 0 && // only the global view drifts; a city view stays where it is
      this.selectedSlot < 0 &&
      !this.conActive &&
      !this.rig.isFlying &&
      !this.rig.isFree &&
      !this.moonView
    ) {
      this.rig.rotateBy(Y_AXIS, -1.2 * DEG * dt);
    }
    if (this.effects.atmosphere) this.u.uAtmo.value = this.ambientBoost.atmo;

    u.uFan.value = fan;
    const surf = Math.max(0.004, this.rig.distance - 1);
    this.lensNow = lensAtDistance(this.rig.projScale, surf);
    // Political lines: the pixels per radian at the nearest ground decides which of them are worth a draw.
    this.borders.update(dt, this.rig.projScale / surf, this.reducedMotion);
    // The markers' dark halo has nothing to do until the lens opens: no draw at the global view.
    this.nodeLayer.knock.visible = this.lensNow > 0.002;
    u.uZoomGain.value = 0.55 + 0.45 * smoothstep(2.9, 1.0, range);
    this.nodeWorld.value = 0.3 * spacing;
    this.nodeLayer.nodeWorld.value = this.nodeWorld.value;
    this.clusterLayer.spacing.value = spacing;

    // Lifecycle of dying nodes
    this.reapT += dt;
    if (this.reapT > 0.25 && s.dying > 0) {
      this.reapT = 0;
      if (s.reap(this.time, FADE_OUT) > 0) {
        this.mesh.resolveDirty = true;
        this.mesh.adjDirty = true;
        s.posDirty = true;
        this.hubsDirty = true;
      }
    }

    // Focus and filter easing
    this.u.uFocus.value = damp(this.u.uFocus.value, this.focusTarget, 5, dt);
    // Plain selection dims the rest to 55%; a focus mode (app constellation, focus-only) to the full dim alpha.
    this.u.uFocusAlpha.value = damp(
      this.u.uFocusAlpha.value,
      this.conActive || this.focusOnly ? this.tokens.dimAlpha : 0.55,
      6,
      dt,
    );
    if (this.filterT < 1) this.filterT = Math.min(1, this.filterT + dt / 0.5);
    this.u.uFilterT.value = this.filterT;

    // Events and traffic
    this.sink.update(this.time);
    this.choreo.update(dt);
    this.activity.update(dt);
    this.fx.updateWaves();
    if (this.mesh.resolveDirty) this.mesh.resolve(s);
    this.veil.gain = this.ambientBoost.mesh;
    const dens = this.profile.meshDensity * this.meshDensity;
    if (this.veil.enabled)
      this.veil.update(dt, this.time, dens, this.cssW, this.cssH, this.fx.color('mesh', this.tmpColor));
    this.traffic.update(dt, dens * this.ambientBoost.mesh, this.selectedSlot, this.reducedMotion);

    if (this.beaconPillar >= 0) {
      const want = this.pillarLift();
      if (Math.abs(want - this.beaconLift) > 0.015 * want) {
        this.beaconLift = want;
        this.held.setLift(this.beaconPillar, this.beaconPillarStart, want);
      }
    }
    this.arcs.update(this.time);
    this.held.update(this.time);
    this.packets.update(this.time);
    this.links.update(this.time);
    this.rings.update(this.time);
    this.rays.update(this.time);
    this.links.mesh.visible = this.links.high > 0;
    this.packets.mesh.visible = this.effects.mesh && this.packets.high > 0;

    this.nodeLayer.sync();
    this.clusterLayer.sync(this.selectedCluster, this.conActive ? this.conHubs : null);
    this.clusterLayer.mesh.visible = this.effects.spires && this.clusterLayer.mesh.visible;

    // The moon travels under a pointer that is not moving: look again while the pointer is near it.
    const mp = this.moonPx;
    const nearMoon =
      this.hoverInside &&
      this.mode === 'explore' &&
      this.moon.enabled &&
      (this.hoverX - mp.x) ** 2 + (this.hoverY - mp.y) ** 2 < (mp.r * 1.8 + 30) ** 2;
    if (
      this.hoverDirty ||
      this.moonHovered ||
      nearMoon ||
      (this.rig.isFlying === false && this.hoverSlot >= 0 && this.mode === 'explore')
    )
      this.handleHover();

    const body = this.bodies[this.artDirection];
    body?.update(this.time);
  }

  private render(): void {
    const p: PostParams = {
      exposure: this.tokens.exposure,
      // Up close the bloom pulls in: crisp markers over a dim ground, not a glow that fills the field.
      bloom: this.tokens.bloom * this.ambientBoost.bloom * (1 - 0.35 * this.lensNow),
      chroma: this.effects.chromatic && this.profile.chroma && !this.reducedMotion ? this.tokens.chroma : 0,
      grain: this.effects.grain && this.profile.grain && !this.reducedMotion ? this.tokens.grain : 0,
      vignette: this.effects.vignette ? 0.55 : 0,
      bloomEnabled: this.effects.bloom,
      time: this.time,
      fade: this.fade * this.sceneFade,
      aperture: this.aperture(),
    };
    this.post.render(
      this.scene,
      this.rig.camera,
      p,
      this.renderer.domElement.width,
      this.renderer.domElement.height,
      this.overlayScene,
    );
  }

  private track(dtRaw: number, cpuMs: number): void {
    const s = this.statsObj;
    const info = this.renderer.info;
    s.cpuMs = damp(s.cpuMs, cpuMs, 8, 0.016);
    s.frameMs = dtRaw * 1000;
    this.fpsFrames++;
    this.fpsT += dtRaw;
    if (this.fpsT >= 0.5) {
      s.fps = this.fpsFrames / this.fpsT;
      this.fpsFrames = 0;
      this.fpsT = 0;
    }
    s.drawCalls = info.render.calls;
    s.triangles = info.render.triangles;
    s.geometries = info.memory.geometries;
    s.textures = info.memory.textures;
    s.dpr = this.dpr;
    s.renderScale = this.renderScale;
    s.quality = this.profile.name;
    s.nodes = this.nodes.live;
    s.dying = this.nodes.dying;
    s.clusters = this.nodes.clusterCount;
    s.arcs = this.arcs.count + this.held.count;
    s.packets = this.packets.count;
    s.rings = this.rings.count;
    s.queued = this.choreo.queued;
    s.suppressed = this.choreo.suppressed;
    this.renderer.info.reset();

    // Dynamic resolution governor (auto quality only): step the render scale down on sustained
    // slow frames, and probe back up slowly when frames are comfortably fast.
    if (this.qualityLevel === 'auto' && !this.hidden) {
      const ms = Math.min(dtRaw * 1000, 200);
      if (ms > 19.5) {
        this.slowT += dtRaw;
        this.calmT = 0;
      } else {
        this.calmT += dtRaw;
        this.slowT = Math.max(0, this.slowT - dtRaw * 0.5);
      }
      if (this.slowT > 1.5 && this.renderScale > 0.56) {
        this.renderScale = Math.max(0.55, this.renderScale - 0.1);
        this.slowT = 0;
        this.lastDowngrade = this.time;
        this.resizeDirty = true;
        this.emit('quality', { level: this.profile.name, dpr: this.dpr, scale: this.renderScale });
      } else if (this.slowT > 1.5 && this.profile.name !== 'low') {
        // The render scale is at its floor and frames are still long: drop a tier (the ladder is high, medium, low).
        const next = this.profile.name === 'high' ? 'medium' : 'low';
        this.profile = PROFILES[next];
        this.moon.set({ lite: this.profile.moonLite });
        this.atmosphere.setSteps(this.profile.atmoSteps);
        this.borders.setStatesAllowed(this.profile.name !== 'low');
        this.renderScale = 0.8;
        this.slowT = 0;
        this.lastDowngrade = this.time;
        this.resizeDirty = true;
        this.emit('quality', { level: next, dpr: this.dpr, scale: this.renderScale });
      } else if (this.calmT > 12 && this.renderScale < 1 && this.time - this.lastDowngrade > 20) {
        this.renderScale = Math.min(1, this.renderScale + 0.05);
        this.calmT = 0;
        this.resizeDirty = true;
        this.emit('quality', { level: this.profile.name, dpr: this.dpr, scale: this.renderScale });
      }
    }
    this.emit('frame', s);
  }

  /** Forces a render at a fixed frame count with GPU sync, for benchmarks. Returns ms per frame. */
  benchmark(frames = 120): number {
    const gl = this.renderer.getContext();
    const px = new Uint8Array(4);
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      this.time += 1 / 60;
      this.update(1 / 60);
      this.render();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    return (performance.now() - t0) / frames;
  }
}

export { RibbonStyle, RingKind };
