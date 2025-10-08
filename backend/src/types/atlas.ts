export type NodeTier = 'CUMULUS' | 'NIMBUS' | 'STRATUS' | 'UNKNOWN';
export type NodeStatus = 'ARCANE' | 'LEGACY' | 'UNVERIFIED';
export type NodeKind = 'flux' | 'stub';

export interface FluxNodeRecord {
  collateral: string;
  txhash: string;
  outidx: string;
  ip: string;
  network: string;
  added_height: number;
  confirmed_height: number;
  last_confirmed_height: number;
  last_paid_height: number;
  tier: NodeTier | string;
  payment_address: string;
  pubkey: string;
  activesince?: number;
  lastpaid?: number;
  status?: string;
  // Flexible metadata bag for forward compatibility
  [key: string]: unknown;
}

export interface FluxNodeSummary {
  id: string;
  ip: string;
  rpcEndpoint: string;
  tier: NodeTier;
  status: NodeStatus;
  isArcane: boolean;
  isFlux: boolean;
}

export interface PeerEdge {
  source: string;
  target: string;
  weight: number;
  isStubEdge: boolean;
  includesFluxStub: boolean;
}

export interface AtlasNode {
  id: string;
  label: string;
  tier: NodeTier;
  kind: NodeKind;
  status: NodeStatus;
  isArcane: boolean;
  isHub: boolean;
  metrics: {
    degree: number;
    degreeCentrality: number;
    connectionCount: number;
  };
  position: {
    x: number;
    y: number;
  };
  meta: {
    tier: NodeTier;
    status: NodeStatus;
    collateral?: string;
    paymentAddress?: string;
    rpcEndpoint?: string;
    frontendUrl?: string;
    lastConfirmedHeight?: number;
    isFluxNode: boolean;
    isStub: boolean;
    bandwidth?: {
      download_speed: number;
      upload_speed: number;
    };
  } & Record<string, unknown>;
}

export interface AtlasEdge {
  id: string;
  source: string;
  target: string;
  weight: number;
  kind: 'flux-flux' | 'flux-stub' | 'stub-stub';
}

export interface AtlasBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface AtlasStats {
  totalFluxNodes: number;
  totalStubNodes: number;
  totalNodes: number;
  totalEdgesRaw: number;
  totalEdgesTrimmed: number;
  hubCount: number;
  tierTotals: Record<NodeTier, number> & { UNKNOWN: number };
  statusTotals: Record<NodeStatus, number>;
  stubAfterTrim: number;
  sampling: {
    quickSampleEnabled: boolean;
    sampledCount: number;
  };
  buildDurationMs: number;
}

export interface AtlasBuild {
  buildId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  nodes: AtlasNode[];
  edges: AtlasEdge[];
  bounds: AtlasBounds;
  stats: AtlasStats;
  config: Record<string, unknown>;
  meta: {
    axis: AtlasBounds;
    hubThreshold: number;
    layoutStrategy: 'force' | 'seeded';
    source: string;
  };
}

export interface AtlasState {
  building: boolean;
  error?: string;
  data?: AtlasBuild;
}
