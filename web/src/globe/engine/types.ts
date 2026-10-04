// Public types of the globe engine. The engine is framework-agnostic: everything crosses the
// boundary as plain numbers and typed arrays so it can be fed straight from a binary snapshot.

/** Tier codes match the backend `Tier` enum. */
export const Tier = { Unknown: 0, Cumulus: 1, Nimbus: 2, Stratus: 3 } as const;
export type TierCode = (typeof Tier)[keyof typeof Tier];

/** Status codes. The shader maps them through a small table, so new codes only need a token. */
export const Status = {
  Unknown: 0,
  Confirmed: 1,
  /** Started but not yet confirmed: drawn as a hollow ring. */
  Started: 2,
  /** Unreachable: 55% alpha, desaturated, no halo. */
  Offline: 3,
  /** DoS listed: dimmed with a crit cross. */
  Dos: 4,
  /** 560 or more blocks without a check-in (expires at 640): a breathing ring in the risk color. */
  AtRisk: 5,
} as const;

/** Bits of the `flags` column. Same layout as the backend snapshot. */
export const NodeFlag = {
  HasApps: 1 << 0,
  Ipv6: 1 << 1,
  NonDefaultPort: 1 << 2,
  GeoApprox: 1 << 3,
  Arcane: 1 << 4,
  Enterprise: 1 << 5,
  RecentlyPaid: 1 << 6,
  New24h: 1 << 7,
} as const;

/** Per-node render state owned by the engine (never supplied by the data source). */
export const NodeState = {
  Hovered: 1 << 0,
  Selected: 1 << 1,
  Watched: 1 << 2,
  /** Filtered out (dimmed) right now. */
  Dim: 1 << 3,
  /** Filtered out before the most recent filter change, used to cross-fade. */
  DimPrev: 1 << 4,
  /** Peer of the selection, or member of the active app constellation. */
  Related: 1 << 5,
  /** Just paid: holds +40% brightness for 6 s. */
  Paid: 1 << 6,
  /** Pre-aimed as a payee of the next block. */
  Aimed: 1 << 7,
} as const;

/** Columnar node data. All arrays have the same length (`loc` and `host` are optional). */
export interface NodeColumns {
  /** Stable node ids (interned NodeId). Must be unique and non-zero. */
  ids: Uint32Array;
  /** Degrees. NaN means the location is unknown (the node is drawn in the unlocated belt). */
  lat: Float32Array;
  lon: Float32Array;
  tier: Uint8Array;
  status: Uint8Array;
  flags: Uint8Array;
  /** Co-location cluster id (same coordinates). Nodes with equal `loc` stack together. */
  loc: Uint32Array;
  /** Optional: host (distinct IP) id. Nodes of one host sit next to each other inside a stack. */
  host?: Uint32Array;
}

/** An incremental change to the node set. */
export interface NodeDelta {
  added?: NodeColumns;
  removedIds?: ArrayLike<number>;
  changed?: {
    ids: ArrayLike<number>;
    tier?: ArrayLike<number>;
    status?: ArrayLike<number>;
    flags?: ArrayLike<number>;
  };
  /** Animate appearance and disappearance (default true). */
  animate?: boolean;
}

/** One node for single-node lifecycle events. */
export interface NodeRecord {
  id: number;
  lat: number;
  lon: number;
  tier: number;
  status: number;
  flags: number;
  loc: number;
  host?: number;
}

export interface Payee {
  id: number;
  /** 1 cumulus, 2 nimbus, 3 stratus. Colors the beam; looked up from the node when omitted. */
  tier?: number;
  /** FLUX amount, only used for the floating label. */
  amount?: number;
}

export interface BlockEvent {
  type: 'block';
  height: number;
  producer: number;
  payees: readonly Payee[];
  /** Nodes that confirmed in this block (the heartbeat txs). Staggered over a few seconds. */
  confirms?: ArrayLike<number>;
  /** Unix ms when the block was observed. Late blocks skip their animation (see Choreographer). */
  time?: number;
  /** The one-off emission (reward cut) block: double shockwave and an emission-colored flare. */
  emission?: boolean;
}

/** The next block's payees are known one block ahead: aim a subtle lock on them until the block lands. */
export interface NextPayeesEvent {
  type: 'nextPayees';
  height: number;
  payees: readonly Payee[];
  /** Milliseconds until the block is expected (drives the reticle's breathing and its last-5-seconds tempo). Default 30000. */
  eta?: number;
  time?: number;
}

/** App deployment lifecycle as it reaches the globe. */
export type AppPhase = 'pending' | 'confirmed' | 'installing' | 'spawned' | 'failed' | 'removed';

/** Everything the event choreographer understands. Each maps to exactly one real network event. */
export type GlobeEvent =
  | BlockEvent
  | NextPayeesEvent
  | { type: 'confirm'; ids: ArrayLike<number>; time?: number }
  | { type: 'mempool'; count?: number; seed?: number; time?: number }
  | { type: 'nodeStarted'; node: NodeRecord; time?: number }
  | { type: 'nodeLeft'; id: number; reason?: 'expired' | 'removed' | 'offline'; time?: number }
  | { type: 'nodeStatus'; id: number; status: number; time?: number }
  | { type: 'appDeploy'; app: string; phase: AppPhase; nodes?: ArrayLike<number>; time?: number }
  | { type: 'appInstance'; app: string; node: number; op: 'spawn' | 'remove'; time?: number }
  | { type: 'crawl'; ids: ArrayLike<number>; time?: number }
  | { type: 'peerLink'; a: number; b: number; op: 'add' | 'remove'; time?: number };

export type ArtDirection = 'dotmatrix' | 'marble' | 'neon';
/** Political lines on the planet: none, country borders, or country borders with state and province lines. */
export type BordersMode = 'off' | 'countries' | 'states';
export type QualityLevel = 'auto' | 'high' | 'medium' | 'low';
export type EngineMode = 'explore' | 'ambient';

export interface NodeFilter {
  /** Bit i set = tier code i visible. Undefined = all. */
  tiers?: number;
  /** Bit i set = status code i visible. */
  statuses?: number;
  /** Required flag bits (all must be set). */
  requireFlags?: number;
  /** Excluded flag bits (none may be set). */
  excludeFlags?: number;
}

/** Hover and select payloads. */
export interface PickInfo {
  id: number;
  /** Internal slot. Stable while the node lives; do not persist. */
  slot: number;
  loc: number;
  /** Nodes in the same co-location cluster. */
  clusterSize: number;
  /** True when the pick resolved to a stacked cluster rather than a single node. */
  isCluster: boolean;
  lat: number;
  lon: number;
  tier: number;
  status: number;
  flags: number;
  /** CSS pixels relative to the canvas. */
  x: number;
  y: number;
}

export interface EngineStats {
  fps: number;
  frameMs: number;
  cpuMs: number;
  drawCalls: number;
  triangles: number;
  nodes: number;
  dying: number;
  clusters: number;
  arcs: number;
  packets: number;
  rings: number;
  queued: number;
  suppressed: number;
  dpr: number;
  renderScale: number;
  quality: string;
  geometries: number;
  textures: number;
}

/** The design's zoom bands by the planet's on-screen size: Z0 global (under 110%), Z1 continental (to 260%), Z2 regional (to 700%), Z3 city. */
export type ZoomBand = 0 | 1 | 2 | 3;

/** The camera's pose and the design's `size`: the planet's diameter as a percentage of the viewport height. */
export interface CameraInfo {
  lat: number;
  lon: number;
  /** Bearing of screen-up, radians (0 = north up). */
  heading: number;
  /** Altitude above the surface in globe radii. */
  range: number;
  tilt: number;
  size: number;
  band: ZoomBand;
}

export interface EngineEvents {
  hover: PickInfo | null;
  select: PickInfo | null;
  /** The camera moved (at most once per frame, only when the pose changed). */
  cameraChange: CameraInfo;
  /** The zoom band changed. */
  zoomBand: { band: ZoomBand; size: number };
  /** A hub (a tower or a stack) was clicked; the engine flies in so the stack unfurls. Same moment as `select` with `isCluster`. */
  pickCluster: {
    cluster: number;
    loc: number;
    lat: number;
    lon: number;
    count: number;
    tiers: [number, number, number];
    x: number;
    y: number;
  };
  /** The pointer, touch, wheel or keyboard woke the screensaver (pointer moves count after 8 px of travel). */
  wake: { kind: 'move' | 'press' | 'wheel' | 'key' };
  /** The next block's payees were announced (one block ahead). `eta` is milliseconds until the expected landing. */
  aim: { height: number; eta: number; payees: { id: number; tier: number; amount: number }[] };
  /** Fired when the choreographer starts animating a block. */
  block: BlockEvent;
  /** A user-facing caption from the ambient director. */
  caption: AmbientCaption;
  /** Fires once per frame with the stats object (shared, do not keep). */
  frame: EngineStats;
  /** The camera came to rest on a new cluster hub list. Used by hub labels. */
  ready: undefined;
  /** Quality was changed by the auto governor. */
  quality: { level: string; dpr: number; scale: number };
  /** Something in the event feed was suppressed by the visual budget. */
  budget: { suppressed: number };
  /** A payout beam landed on its payee. */
  payout: {
    id: number;
    tier: number;
    amount: number;
    height: number;
    x: number;
    y: number /** The amount as the feed gave it (8-decimal string), when it came through the effect sink. */;
    text?: string;
  };
  /** App deployment phase changes, for toasts and HUD lists. */
  appDeploy: { app: string; phase: AppPhase; count: number };
  /** The easter egg played at this location. */
  egg: { lat: number; lon: number };
  /** A mempool transaction was seen (subtle tick). */
  mempool: { count: number };
  /** The moon sealed a block (the producer's beam arrived). Fires about a second after `block`. */
  seal: { height: number };
  /** The Flux moon was clicked (the app can open its About Flux window). x, y, r: the moon's disc in canvas pixels. Same moment as `moonclick`. */
  moon: { x: number; y: number; r: number };
  /** The design's name for the same click; `key` is true when it came from `moonClick()` (keyboard or the DOM proxy). */
  moonclick: { x: number; y: number; key?: boolean };
  /** The pointer entered or left the Flux moon (explore mode). `on` is the design's name for `hovered`. */
  moonhover: { hovered: boolean; on: boolean; x: number; y: number; r: number };
  /** The dev-fund output paid: the slanted bar flashed. x, y is the bar's center in canvas pixels, for the chip. */
  devfund: {
    height: number;
    x: number;
    y: number /** The output's amount (8-decimal string), when it came through the effect sink. */;
    amount?: string;
  };
  /** "+N more" for events a budget coalesced; updates in place by `id` (from the effect sink). */
  summary: { id: string; kind: string; count: number; final: boolean };
  /** The chain took another road: the newest beads came off the moon's orbit. */
  reorg: { forkHeight: number; fromHeight: number; toHeight: number; orphaned: number };
  /** Whatever played while nobody watched was dropped in favor of a recap. */
  recap: {
    reason: 'hidden' | 'catch_up';
    spanMs: number;
    blocks: number;
    lastHeight: number | null;
    events: number;
    byKind: Record<string, number>;
  };
}

export interface AmbientCaption {
  kind: 'shot' | 'block' | 'region' | 'app' | 'stats' | 'idle' | 'egg';
  title: string;
  subtitle?: string;
  /** Extra fields for the block caption. */
  height?: number;
  producerName?: string;
  payeeNames?: string[];
  /** Payees with their tier and FLUX amount, for the route line. */
  payees?: { name: string; tier: number; amount: number }[];
  /** Seconds the caption should stay up. */
  duration: number;
}

export interface GlobeOptions {
  artDirection?: ArtDirection;
  /** Country borders and state lines (default `states`: both; state lines never draw on the low tier). */
  borders?: BordersMode;
  quality?: QualityLevel;
  /** Cap on device pixel ratio. Default 2. */
  maxDpr?: number;
  /** Respect `prefers-reduced-motion` (default true). */
  respectReducedMotion?: boolean;
  /** Start in this mode. */
  mode?: EngineMode;
  /** Night lights, clouds, stars, atmosphere, etc. */
  effects?: Partial<EffectToggles>;
  /** Tokens override (see tokens.ts). */
  tokens?: Partial<import('./tokens').GlobeTokens>;
  /** Base URL for the texture and geography assets. Default './'. */
  assetBase?: string;
  /** Let the pointer orbit/zoom (explore mode). Default true. */
  interactive?: boolean;
  /** Seed for the deterministic parts (stars, jitter). */
  seed?: number;
  /** The Flux moon (on by default). See `engine.setMoon`. */
  moon?: Partial<import('./moon/moon').MoonOptions>;
}

export interface EffectToggles {
  bloom: boolean;
  chromatic: boolean;
  grain: boolean;
  vignette: boolean;
  atmosphere: boolean;
  stars: boolean;
  clouds: boolean;
  nightLights: boolean;
  terminator: boolean;
  mesh: boolean;
  spires: boolean;
  labels: boolean;
}

export const DEFAULT_EFFECTS: EffectToggles = {
  bloom: true,
  chromatic: true,
  grain: true,
  vignette: true,
  atmosphere: true,
  stars: true,
  clouds: true,
  nightLights: true,
  terminator: true,
  mesh: true,
  spires: true,
  labels: true,
};

export class GlobeUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GlobeUnsupportedError';
  }
}
