import seedrandom from 'seedrandom';
import { forceLink, forceManyBody, forceSimulation, SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';
import { config } from '../config/env.js';
import { AtlasBuild, AtlasBounds, AtlasEdge, AtlasNode, AtlasState, NodeKind, NodeStatus, NodeTier, FluxNodeRecord } from '../types/atlas.js';
import { fetchFluxNodeList, fetchPeerData, PeerFetchResult } from './fluxApi.js';
import { edgeKey, makeNodeId, normalizeIp, splitHostPort } from '../utils/net.js';
import { logger } from '../utils/logger.js';

interface InternalNode {
  id: string;
  kind: NodeKind;
  tier: NodeTier;
  status: NodeStatus;
  arcane?: boolean;
  record?: FluxNodeRecord;
  bandwidth?: {
    download_speed: number;
    upload_speed: number;
  };
}

interface InternalEdge {
  key: string;
  source: string;
  target: string;
  weight: number;
  stubEdge: boolean;
}

interface BuildArtifacts {
  nodes: AtlasNode[];
  edges: AtlasEdge[];
  bounds: AtlasBounds;
  stats: AtlasBuild['stats'];
  meta: AtlasBuild['meta'];
  durationMs: number;
  rawEdgeCount: number;
}

const tierMap: Record<string, NodeTier> = {
  CUMULUS: 'CUMULUS',
  NIMBUS: 'NIMBUS',
  STRATUS: 'STRATUS',
};

const mapTier = (value?: string): NodeTier => {
  if (!value) return 'UNKNOWN';
  const upper = value.toUpperCase();
  return tierMap[upper] ?? 'UNKNOWN';
};

const determineStatus = (arcane?: boolean): NodeStatus => {
  if (arcane === true) return 'ARCANE';
  if (arcane === false) return 'LEGACY';
  return 'UNVERIFIED';
};

const layoutExtent = 1000;

const createFluxNode = (
  record: FluxNodeRecord,
  arcane?: boolean,
  bandwidth?: { download_speed: number; upload_speed: number }
): InternalNode => {
  const id = makeNodeId(record.ip, record.collateral);
  return {
    id,
    kind: 'flux',
    tier: mapTier(record.tier),
    arcane,
    status: determineStatus(arcane),
    record,
    bandwidth,
  };
};

const createStubNode = (id: string): InternalNode => ({
  id,
  kind: 'stub',
  tier: 'UNKNOWN',
  status: 'UNVERIFIED',
});

const toAtlasEdge = (edge: InternalEdge): AtlasEdge => {
  const kind: AtlasEdge['kind'] = edge.stubEdge ? 'flux-stub' : 'flux-flux';
  return {
    id: edge.key,
    source: edge.source,
    target: edge.target,
    weight: edge.weight,
    kind,
  };
};

interface NodeAdjacency {
  edges: Set<string>;
  stubEdges: Set<string>;
}

const buildAdjacency = (edges: Map<string, InternalEdge>): Map<string, NodeAdjacency> => {
  const adjacency = new Map<string, NodeAdjacency>();

  edges.forEach((edge) => {
    const sourceEntry = adjacency.get(edge.source) ?? { edges: new Set<string>(), stubEdges: new Set<string>() };
    sourceEntry.edges.add(edge.key);
    if (edge.stubEdge) sourceEntry.stubEdges.add(edge.key);
    adjacency.set(edge.source, sourceEntry);

    const targetEntry = adjacency.get(edge.target) ?? { edges: new Set<string>(), stubEdges: new Set<string>() };
    targetEntry.edges.add(edge.key);
    if (edge.stubEdge) targetEntry.stubEdges.add(edge.key);
    adjacency.set(edge.target, targetEntry);
  });

  return adjacency;
};

const removeEdge = (
  edges: Map<string, InternalEdge>,
  adjacency: Map<string, NodeAdjacency>,
  key: string,
) => {
  const edge = edges.get(key);
  if (!edge) return;

  edges.delete(key);

  const sourceAdj = adjacency.get(edge.source);
  if (sourceAdj) {
    sourceAdj.edges.delete(key);
    sourceAdj.stubEdges.delete(key);
  }

  const targetAdj = adjacency.get(edge.target);
  if (targetAdj) {
    targetAdj.edges.delete(key);
    targetAdj.stubEdges.delete(key);
  }
};

const enforceMaxDegree = (
  nodes: Map<string, InternalNode>,
  edges: Map<string, InternalEdge>,
  adjacency: Map<string, NodeAdjacency>,
  maxDegree: number,
) => {
  if (maxDegree <= 0) return;

  nodes.forEach((node) => {
    const adj = adjacency.get(node.id);
    if (!adj) return;

    while (adj.edges.size > maxDegree) {
      const candidates = Array.from(adj.edges)
        .map((edgeKey) => edges.get(edgeKey)!)
        .sort((a, b) => {
          const aOther = a.source === node.id ? a.target : a.source;
          const bOther = b.source === node.id ? b.target : b.source;
          const aNode = nodes.get(aOther);
          const bNode = nodes.get(bOther);

          const aPriority = (aNode?.kind === 'stub' ? 0 : 1) * 1000 + a.weight;
          const bPriority = (bNode?.kind === 'stub' ? 0 : 1) * 1000 + b.weight;
          return aPriority - bPriority;
        });

      const toRemove = candidates[0];
      if (!toRemove) break;
      removeEdge(edges, adjacency, toRemove.key);
    }
  });
};

const enforceEdgeCap = (
  edges: Map<string, InternalEdge>,
  adjacency: Map<string, NodeAdjacency>,
  maxEdges: number,
) => {
  if (maxEdges <= 0) return;

  while (edges.size > maxEdges) {
    const edgeList = Array.from(edges.values()).sort((a, b) => {
      const aPriority = (a.stubEdge ? 0 : 1) * 1000 + a.weight;
      const bPriority = (b.stubEdge ? 0 : 1) * 1000 + b.weight;
      return aPriority - bPriority;
    });

    const candidate = edgeList[0];
    if (!candidate) break;
    removeEdge(edges, adjacency, candidate.key);
  }
};

const enforceStubCap = (
  nodes: Map<string, InternalNode>,
  edges: Map<string, InternalEdge>,
  adjacency: Map<string, NodeAdjacency>,
  maxStubs: number,
) => {
  const stubNodes = Array.from(nodes.values()).filter((node) => node.kind === 'stub');
  if (maxStubs <= 0) {
    stubNodes.forEach((node) => {
      const adj = adjacency.get(node.id);
      if (adj) {
        Array.from(adj.edges).forEach((edgeKey) => removeEdge(edges, adjacency, edgeKey));
      }
      nodes.delete(node.id);
    });
    return;
  }

  if (stubNodes.length <= maxStubs) {
    return;
  }

  const degreeMap = new Map<string, number>();
  adjacency.forEach((value, key) => {
    degreeMap.set(key, value.edges.size);
  });

  const sorted = stubNodes.sort((a, b) => {
    const aDegree = degreeMap.get(a.id) ?? 0;
    const bDegree = degreeMap.get(b.id) ?? 0;
    return bDegree - aDegree;
  });

  sorted.slice(maxStubs).forEach((node) => {
    const adj = adjacency.get(node.id);
    if (adj) {
      Array.from(adj.edges).forEach((edgeKey) => removeEdge(edges, adjacency, edgeKey));
    }
    nodes.delete(node.id);
  });
};

const dropIsolatedStubs = (
  nodes: Map<string, InternalNode>,
  adjacency: Map<string, NodeAdjacency>,
) => {
  nodes.forEach((node) => {
    if (node.kind !== 'stub') return;
    const adj = adjacency.get(node.id);
    if (!adj || adj.edges.size === 0) {
      nodes.delete(node.id);
    }
  });
};

interface GraphSnapshot {
  nodes: Map<string, InternalNode>;
  edges: Map<string, InternalEdge>;
  adjacency: Map<string, NodeAdjacency>;
  rawEdgeCount: number;
  outgoingCounts: Map<string, number>; // Outgoing connections from API
  incomingCounts: Map<string, number>; // Incoming connections from API
}

const buildGraph = (peerResults: PeerFetchResult[]): GraphSnapshot => {
  const nodes = new Map<string, InternalNode>();
  const edges = new Map<string, InternalEdge>();

  peerResults.forEach(({ node, arcane, bandwidth }) => {
    const fluxNode = createFluxNode(node, arcane, bandwidth);
    nodes.set(fluxNode.id, fluxNode);
  });

  // Create IP:port to node ID lookup map
  // For uPNP clusters, we need to match by IP:port to get the right node
  // But we also need to handle peers that report IPs without ports
  const ipPortToId = new Map<string, string[]>();
  peerResults.forEach(({ node }) => {
    const nodeId = makeNodeId(node.ip, node.collateral);
    const { host, port } = splitHostPort(node.ip);

    // Always map by bare IP (last one wins for non-uPNP)
    if (!ipPortToId.has(host)) {
      ipPortToId.set(host, []);
    }
    ipPortToId.get(host)!.push(nodeId);

    // Also map by IP:port if port is specified (for exact matching)
    if (port) {
      const ipPort = `${host}:${port}`;
      if (!ipPortToId.has(ipPort)) {
        ipPortToId.set(ipPort, []);
      }
      ipPortToId.get(ipPort)!.push(nodeId);
    } else {
      // Node has no explicit port - also map IP:16127
      const ipPort = `${host}:${config.rpcPort}`;
      if (!ipPortToId.has(ipPort)) {
        ipPortToId.set(ipPort, []);
      }
      ipPortToId.get(ipPort)!.push(nodeId);
    }
  });

  let rawEdgeCount = 0;
  const outgoingCounts = new Map<string, number>();
  const incomingCounts = new Map<string, number>();

  logger.info('IP mapping created', {
    totalMappings: ipPortToId.size,
    sampleMappings: Array.from(ipPortToId.entries()).slice(0, 5).map(([key, ids]) => ({ key, count: ids.length })),
    multiNodeMappings: Array.from(ipPortToId.entries()).filter(([_, ids]) => ids.length > 1).length
  });

  // Process outgoing connections (edges FROM this node)
  let successfulLookups = 0;
  let failedLookups = 0;
  let ambiguousLookups = 0;
  const targetHitCount = new Map<string, number>();

  peerResults.forEach(({ node, outgoingPeers }) => {
    const sourceId = makeNodeId(node.ip, node.collateral);
    const sourceNode = nodes.get(sourceId);
    if (!sourceNode) return;

    // Count unique outgoing IPs
    outgoingCounts.set(sourceId, outgoingPeers.length);

    outgoingPeers.forEach((peer) => {
      // Try to match peer to exact node using IP:port first
      let targetIds = ipPortToId.get(peer);

      if (!targetIds) {
        const { host, port } = splitHostPort(peer);

        // If peer has port, try exact IP:port match
        if (port) {
          targetIds = ipPortToId.get(`${host}:${port}`);
        }

        // If still no match and no port specified, try with default port
        if (!targetIds && !port) {
          targetIds = ipPortToId.get(`${host}:${config.rpcPort}`);
        }

        // Last resort: try bare IP (only if above strategies failed)
        // This will return multiple nodes for UPnP clusters
        if (!targetIds) {
          targetIds = ipPortToId.get(host);
          if (targetIds && targetIds.length > 1) {
            ambiguousLookups++;
          }
        }
      }

      if (!targetIds || targetIds.length === 0) {
        // External peer (not in our flux node list)
        failedLookups++;
        if (!config.includeExternalPeers) return;
        if (!nodes.has(peer)) {
          nodes.set(peer, createStubNode(peer));
        }
        targetIds = [peer];
      } else {
        successfulLookups++;
      }

      // Select target node: use random distribution for multi-node targets to avoid hotspots
      let targetId: string;
      if (targetIds.length === 1) {
        targetId = targetIds[0];
      } else {
        // Multiple nodes at same IP: randomly distribute to avoid [0] hotspot
        const randomIndex = Math.floor(Math.random() * targetIds.length);
        targetId = targetIds[randomIndex];
      }

      if (targetId === sourceId) return;

      // Track how often each target is hit
      targetHitCount.set(targetId, (targetHitCount.get(targetId) || 0) + 1);

      // Create directed edge (source -> target)
      const key = `${sourceId}|${targetId}`;
      const stubEdge = (nodes.get(targetId)?.kind === 'stub') || sourceNode.kind === 'stub';

      if (!edges.has(key)) {
        edges.set(key, {
          key,
          source: sourceId,
          target: targetId,
          weight: 1,
          stubEdge,
        });
        rawEdgeCount += 1;
      }
    });
  });

  // Log top targets getting hit most often
  const topTargets = Array.from(targetHitCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  logger.info('[Debug] Top 5 most-targeted nodes:', {
    targets: topTargets.map(([id, count]) => {
      const node = nodes.get(id);
      return {
        id: id.substring(0, 20),
        ip: node?.record?.ip,
        timesTargeted: count
      };
    })
  });

  logger.info('Edge creation complete', {
    rawEdgeCount,
    successfulLookups,
    ambiguousLookups,
    failedLookups,
    totalPeerReports: successfulLookups + failedLookups
  });

  // Process incoming connections (just for counting, edges already created from outgoing)
  peerResults.forEach(({ node, incomingPeers }) => {
    const targetId = makeNodeId(node.ip, node.collateral);

    // Count unique incoming IPs
    incomingCounts.set(targetId, incomingPeers.length);
  });

  const adjacency = buildAdjacency(edges);

  return {
    nodes,
    edges,
    adjacency,
    rawEdgeCount,
    outgoingCounts,
    incomingCounts,
  };
};

const computeDegreeMetrics = (
  adjacency: Map<string, NodeAdjacency>,
  edges: Map<string, InternalEdge>,
) => {
  const degree = new Map<string, number>();
  const weightedDegree = new Map<string, number>();

  adjacency.forEach((value, key) => {
    // Count only non-stub edges for degree
    const nonStubEdges = Array.from(value.edges).filter(edgeKey => {
      const edge = edges.get(edgeKey);
      return edge && !edge.stubEdge;
    });
    degree.set(key, nonStubEdges.length);

    const totalWeight = Array.from(value.edges).reduce((sum, edgeKey) => {
      const edge = edges.get(edgeKey);
      return edge ? sum + edge.weight : sum;
    }, 0);
    weightedDegree.set(key, totalWeight);
  });

  return { degree, weightedDegree };
};

// Normalize degree values for nodes in UPnP clusters
// Divides aggregate cluster degree by cluster size to get per-node average
const normalizeClusterDegrees = (
  nodes: Map<string, InternalNode>,
  degree: Map<string, number>,
) => {
  const normalizedDegree = new Map<string, number>();

  // Group nodes by IP to identify clusters
  const ipGroups = new Map<string, InternalNode[]>();
  nodes.forEach((node) => {
    if (node.record) {
      const ip = normalizeIp(node.record.ip);
      const group = ipGroups.get(ip) || [];
      group.push(node);
      ipGroups.set(ip, group);
    } else {
      // Stub nodes stay as-is
      ipGroups.set(node.id, [node]);
    }
  });

  // Calculate normalized degree for each node
  let clustersNormalized = 0;
  let maxAggregate = 0;
  let maxClusterIp = '';

  ipGroups.forEach((nodesInGroup, ip) => {
    const clusterSize = nodesInGroup.length;

    if (clusterSize === 1) {
      // Single node - no normalization needed
      const nodeId = nodesInGroup[0].id;
      normalizedDegree.set(nodeId, degree.get(nodeId) || 0);
    } else {
      // Multi-node cluster - normalize by dividing aggregate by cluster size
      const aggregateDegree = nodesInGroup.reduce((sum, node) => {
        return sum + (degree.get(node.id) || 0);
      }, 0);

      const normalizedValue = aggregateDegree / clusterSize;

      clustersNormalized++;
      if (aggregateDegree > maxAggregate) {
        maxAggregate = aggregateDegree;
        maxClusterIp = ip;
      }

      // Assign normalized degree to all nodes in cluster
      nodesInGroup.forEach((node) => {
        normalizedDegree.set(node.id, normalizedValue);
      });
    }
  });

  if (maxClusterIp) {
    const maxCluster = ipGroups.get(maxClusterIp);
    if (maxCluster) {
      logger.info(`[Normalization] Largest cluster: ${maxClusterIp} size=${maxCluster.length} aggregate=${maxAggregate} normalized=${(maxAggregate / maxCluster.length).toFixed(1)}`);
    }
  }
  logger.info(`[Normalization] Normalized ${clustersNormalized} clusters total`);

  return normalizedDegree;
};

interface LayoutNode extends SimulationNodeDatum {
  id: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

const normalizePositions = (
  positions: Map<string, { x: number; y: number }>,
  strategy: 'force' | 'seeded',
) => {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  positions.forEach(({ x, y }) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  });

  const width = (maxX - minX) || 1;
  const height = (maxY - minY) || 1;
  const scale = layoutExtent / Math.max(width, height);

  const normalized = new Map<string, { x: number; y: number }>();
  const offsetX = minX + width / 2;
  const offsetY = minY + height / 2;

  positions.forEach(({ x, y }, id) => {
    normalized.set(id, {
      x: (x - offsetX) * scale,
      y: (y - offsetY) * scale,
    });
  });

  const bounds: AtlasBounds = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  };

  normalized.forEach(({ x, y }) => {
    if (x < bounds.minX) bounds.minX = x;
    if (x > bounds.maxX) bounds.maxX = x;
    if (y < bounds.minY) bounds.minY = y;
    if (y > bounds.maxY) bounds.maxY = y;
  });

  return { positions: normalized, bounds, strategy };
};

const applyLayout = (
  nodes: Map<string, InternalNode>,
  edges: Map<string, InternalEdge>,
  compositeWeights: Map<string, number>,
) => {
  const totalNodes = nodes.size;
  const positions = new Map<string, { x: number; y: number }>();
  const rngSeed = config.layoutSeed + ':' + Date.now().toString();
  const rng = seedrandom(rngSeed);

  if (totalNodes === 0) {
    return {
      positions,
      bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
      strategy: 'seeded' as const,
    };
  }

  // Group nodes by IP address for clustering
  const ipGroups = new Map<string, InternalNode[]>();
  nodes.forEach((node) => {
    if (node.record) {
      const ip = normalizeIp(node.record.ip);
      const group = ipGroups.get(ip) || [];
      group.push(node);
      ipGroups.set(ip, group);
    } else {
      // Stub nodes (shouldn't happen with FLUX_INCLUDE_EXTERNAL_PEERS=false)
      ipGroups.set(node.id, [node]);
    }
  });

  // Create cluster representatives for force-directed layout
  // Weight cluster importance by aggregate degree of nodes within
  const clusterNodes: LayoutNode[] = [];
  const ipToClusterNode = new Map<string, LayoutNode>();
  const clusterWeights = new Map<string, number>();

  ipGroups.forEach((nodesInGroup, ip) => {
    const clusterId = `cluster_${ip}`;
    // Calculate aggregate composite weight for this cluster
    const aggregateWeight = nodesInGroup.reduce((sum, node) => {
      const nodeWeight = compositeWeights.get(node.id) || 0;
      return sum + nodeWeight;
    }, 0);

    // Position high-weight clusters further from origin
    const weightMultiplier = 1 + (aggregateWeight / nodesInGroup.length) * 2; // 1-3x based on avg weight
    const spreadFactor = 6.0 * weightMultiplier;

    const clusterNode: LayoutNode = {
      id: clusterId,
      x: (rng() - 0.5) * layoutExtent * spreadFactor,
      y: (rng() - 0.5) * layoutExtent * spreadFactor,
    };
    clusterNodes.push(clusterNode);
    ipToClusterNode.set(ip, clusterNode);
    clusterWeights.set(clusterId, aggregateWeight);
  });

  // Create edges between clusters (aggregating edges from nodes in those clusters)
  const clusterEdges = new Map<string, { source: string; target: string; weight: number }>();

  edges.forEach((edge) => {
    const sourceNode = nodes.get(edge.source);
    const targetNode = nodes.get(edge.target);

    if (sourceNode?.record && targetNode?.record) {
      const sourceIp = normalizeIp(sourceNode.record.ip);
      const targetIp = normalizeIp(targetNode.record.ip);

      if (sourceIp !== targetIp) {
        const clusterEdgeKey = edgeKey(`cluster_${sourceIp}`, `cluster_${targetIp}`);
        const existing = clusterEdges.get(clusterEdgeKey);
        if (existing) {
          existing.weight += edge.weight;
        } else {
          clusterEdges.set(clusterEdgeKey, {
            source: `cluster_${sourceIp}`,
            target: `cluster_${targetIp}`,
            weight: edge.weight,
          });
        }
      }
    }
  });

  // Apply moderate force simulation - balance between structure and distribution
  if (clusterNodes.length > 0 && clusterNodes.length <= config.layoutNodeCap) {
    const simLinks: SimulationLinkDatum<LayoutNode>[] = Array.from(clusterEdges.values()).map((edge) => ({
      source: edge.source,
      target: edge.target,
      value: edge.weight,
    }));

    // Balanced forces: enough structure to look organized, enough repulsion to spread
    const simulation = forceSimulation<LayoutNode>(clusterNodes)
      .force('charge', forceManyBody().strength(-250))  // Moderate repulsion
      .force('link', forceLink<LayoutNode, SimulationLinkDatum<LayoutNode>>(simLinks)
        .id((d: LayoutNode) => d.id)
        .distance(200)  // Moderate link distance
        .strength(0.3))  // Moderate link strength
      .stop();  // NO center force

    // Run minimal iterations - just enough to resolve overlaps, not enough to centralize
    const iterations = Math.min(100, 30 + Math.floor(clusterNodes.length * 0.02));
    for (let i = 0; i < iterations; i += 1) {
      simulation.tick();
    }
  }

  // Position individual nodes around their cluster centers
  const clusterRadius = 6;  // Increased from 3 to 6 to fan out cluster nodes more

  let multiNodeClusters = 0;
  let maxClusterSize = 0;

  ipGroups.forEach((nodesInGroup, ip) => {
    const clusterNode = ipToClusterNode.get(ip);
    const centerX = clusterNode?.x ?? 0;
    const centerY = clusterNode?.y ?? 0;

    if (nodesInGroup.length === 1) {
      // Single node - place at cluster center
      positions.set(nodesInGroup[0].id, { x: centerX, y: centerY });
    } else {
      // Multiple nodes - arrange in circle around cluster center
      multiNodeClusters += 1;
      maxClusterSize = Math.max(maxClusterSize, nodesInGroup.length);

      const angleStep = (2 * Math.PI) / nodesInGroup.length;
      nodesInGroup.forEach((node, index) => {
        const angle = index * angleStep;
        const x = centerX + clusterRadius * Math.cos(angle);
        const y = centerY + clusterRadius * Math.sin(angle);
        positions.set(node.id, { x, y });
      });
    }
  });

  logger.info('[Layout] UPnP cluster statistics', {
    multiNodeClusters,
    maxClusterSize
  });

  const strategy = clusterNodes.length <= config.layoutNodeCap ? 'force' : 'seeded';
  return normalizePositions(positions, strategy);
};

/**
 * Compute composite weight for each node based on:
 * 1. Connection count (degree)
 * 2. Centrality (normalized degree)
 * 3. Bandwidth (download + upload speed)
 *
 * Returns normalized weights in range [0, 1]
 */
const computeCompositeWeights = (
  nodes: Map<string, InternalNode>,
  degree: Map<string, number>,
  centrality: Map<string, number>,
) => {
  const weights = new Map<string, number>();

  // Find max values for normalization
  let maxDegree = 0;
  let maxCentrality = 0;
  let maxBandwidth = 0;

  nodes.forEach((node) => {
    const deg = degree.get(node.id) || 0;
    const cent = centrality.get(node.id) || 0;
    const bw = node.bandwidth
      ? (node.bandwidth.download_speed + node.bandwidth.upload_speed)
      : 0;

    if (deg > maxDegree) maxDegree = deg;
    if (cent > maxCentrality) maxCentrality = cent;
    if (bw > maxBandwidth) maxBandwidth = bw;
  });

  // Avoid division by zero
  maxDegree = Math.max(maxDegree, 1);
  maxCentrality = Math.max(maxCentrality, 0.001);
  maxBandwidth = Math.max(maxBandwidth, 1);

  // Compute weighted scores (equal weights for each metric)
  nodes.forEach((node) => {
    const normalizedDegree = (degree.get(node.id) || 0) / maxDegree;
    const normalizedCentrality = (centrality.get(node.id) || 0) / maxCentrality;
    const normalizedBandwidth = node.bandwidth
      ? (node.bandwidth.download_speed + node.bandwidth.upload_speed) / maxBandwidth
      : 0;

    // Average of the three metrics
    const compositeWeight = (normalizedDegree + normalizedCentrality + normalizedBandwidth) / 3;
    weights.set(node.id, compositeWeight);
  });

  return weights;
};

const computeCentrality = (degree: Map<string, number>, totalNodes: number) => {
  const centrality = new Map<string, number>();
  const divisor = Math.max(1, totalNodes - 1);
  degree.forEach((value, key) => {
    centrality.set(key, value / divisor);
  });
  return centrality;
};

const computeHubThreshold = (nodes: Map<string, InternalNode>, centrality: Map<string, number>) => {
  const fluxCentralities = Array.from(nodes.values())
    .filter((node) => node.kind === 'flux')
    .map((node) => centrality.get(node.id) ?? 0)
    .sort((a, b) => a - b);

  if (fluxCentralities.length === 0) return 0;
  const index = Math.floor(fluxCentralities.length * 0.9);
  return fluxCentralities[index];
};

const toAtlasNodes = (
  nodes: Map<string, InternalNode>,
  positions: Map<string, { x: number; y: number }>,
  degree: Map<string, number>,
  centrality: Map<string, number>,
  hubThreshold: number,
  outgoingCounts: Map<string, number>,
  incomingCounts: Map<string, number>,
) => {
  return Array.from(nodes.values()).map((node) => {
    const degreeValue = degree.get(node.id) ?? 0;
    const outgoingValue = outgoingCounts.get(node.id) ?? 0;
    const incomingValue = incomingCounts.get(node.id) ?? 0;
    const centralityValue = centrality.get(node.id) ?? 0;
    const position = positions.get(node.id) ?? { x: 0, y: 0 };
    const record = node.record;

    // Get actual port from node IP for RPC endpoint
    const { host, port } = record ? splitHostPort(record.ip) : { host: undefined, port: undefined };
    const apiPort = port ?? config.rpcPort;
    const frontendPort = apiPort - 1; // Frontend port is API port - 1

    return {
      id: node.id,
      label: node.id,
      tier: node.tier,
      kind: node.kind,
      status: node.status,
      isArcane: node.arcane ?? false,
      isHub: centralityValue >= hubThreshold && node.kind === 'flux',
      metrics: {
        degree: degreeValue,
        degreeCentrality: centralityValue,
        connectionCount: outgoingValue + incomingValue,
        incomingPeers: incomingValue,
        outgoingPeers: outgoingValue,
      },
      position,
      meta: {
        tier: node.tier,
        status: node.status,
        ip: host,
        collateral: record?.collateral,
        paymentAddress: record?.payment_address,
        rpcEndpoint: host ? `${config.rpcProtocol}://${host}:${apiPort}` : undefined,
        frontendUrl: host ? `http://${host}:${frontendPort}` : undefined,
        lastConfirmedHeight: record?.last_confirmed_height,
        isFluxNode: node.kind === 'flux',
        isStub: node.kind === 'stub',
        bandwidth: node.bandwidth,
      },
    };
  });
};

const computeStats = (
  nodes: Map<string, InternalNode>,
  edges: Map<string, InternalEdge>,
  rawEdgeCount: number,
  buildDurationMs: number,
  hubThreshold: number,
  centrality: Map<string, number>,
) => {
  const tierTotals: Record<NodeTier, number> & { UNKNOWN: number } = {
    CUMULUS: 0,
    NIMBUS: 0,
    STRATUS: 0,
    UNKNOWN: 0,
  };
  const statusTotals: Record<NodeStatus, number> = {
    ARCANE: 0,
    LEGACY: 0,
    UNVERIFIED: 0,
  };

  let fluxNodes = 0;
  let stubNodes = 0;
  let hubs = 0;

  nodes.forEach((node) => {
    tierTotals[node.tier] += 1;
    if (node.kind === 'flux') {
      fluxNodes += 1;
      statusTotals[node.status] += 1; // Only count status for Flux nodes
      if ((centrality.get(node.id) ?? 0) >= hubThreshold) {
        hubs += 1;
      }
    }
    if (node.kind === 'stub') stubNodes += 1;
  });

  return {
    totalFluxNodes: fluxNodes,
    totalStubNodes: stubNodes,
    totalNodes: nodes.size,
    totalEdgesRaw: rawEdgeCount,
    totalEdgesTrimmed: edges.size,
    hubCount: hubs,
    tierTotals,
    statusTotals,
    stubAfterTrim: stubNodes,
    sampling: {
      quickSampleEnabled: config.quickSampleNodes > 0,
      sampledCount: config.quickSampleNodes,
    },
    buildDurationMs,
  };
};

const buildArtifacts = (peerResults: PeerFetchResult[], startedAt: number): BuildArtifacts => {
  const graph = buildGraph(peerResults);
  const nodes = graph.nodes;
  const edges = graph.edges;
  const adjacency = graph.adjacency;
  const rawEdgeCount = graph.rawEdgeCount;

  logger.info('Before enforcement', { nodes: nodes.size, edges: edges.size });

  enforceStubCap(nodes, edges, adjacency, config.maxStubNodes);
  logger.info('After enforceStubCap', { nodes: nodes.size, edges: edges.size });

  enforceMaxDegree(nodes, edges, adjacency, config.maxNodeDegree);
  logger.info('After enforceMaxDegree', { nodes: nodes.size, edges: edges.size });

  enforceEdgeCap(edges, adjacency, config.maxEdges);
  logger.info('After enforceEdgeCap', { nodes: nodes.size, edges: edges.size });

  dropIsolatedStubs(nodes, adjacency);
  logger.info('After dropIsolatedStubs', { nodes: nodes.size, edges: edges.size });

  const metrics = computeDegreeMetrics(adjacency, edges);

  // Log nodes with highest degree before normalization
  const sortedByDegree = Array.from(metrics.degree.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  logger.info('[Debug] Top 5 nodes by degree (before normalization):', {
    topNodes: sortedByDegree.map(([id, deg]) => {
      const node = nodes.get(id);
      return {
        id: id.substring(0, 20),
        ip: node?.record?.ip,
        degree: deg,
        outgoing: graph.outgoingCounts.get(id),
        incoming: graph.incomingCounts.get(id)
      };
    })
  });

  // Normalize degree values for UPnP clusters to prevent visual over-representation
  const normalizedDegree = normalizeClusterDegrees(nodes, metrics.degree);

  const centrality = computeCentrality(normalizedDegree, nodes.size);
  const hubThreshold = computeHubThreshold(nodes, centrality);

  // Compute composite weights from degree, centrality, and bandwidth
  const compositeWeights = computeCompositeWeights(nodes, metrics.degree, centrality);

  // Log top weighted nodes
  const sortedByWeight = Array.from(compositeWeights.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  logger.info('[Debug] Top 5 nodes by composite weight:', {
    topNodes: sortedByWeight.map(([id, weight]) => {
      const node = nodes.get(id);
      return {
        id: id.substring(0, 20),
        ip: node?.record?.ip,
        weight: weight.toFixed(3),
        degree: metrics.degree.get(id),
        centrality: centrality.get(id)?.toFixed(3),
        bandwidth: node?.bandwidth
          ? `${node.bandwidth.download_speed.toFixed(1)} / ${node.bandwidth.upload_speed.toFixed(1)}`
          : 'N/A'
      };
    })
  });

  // Use composite weights for layout positioning
  const layout = applyLayout(nodes, edges, compositeWeights);

  const atlasNodes = toAtlasNodes(nodes, layout.positions, normalizedDegree, centrality, hubThreshold, graph.outgoingCounts, graph.incomingCounts);
  const atlasEdges = Array.from(edges.values()).map(toAtlasEdge);

  const durationMs = Date.now() - startedAt;
  const stats = computeStats(nodes, edges, rawEdgeCount, durationMs, hubThreshold, centrality);

  const meta: AtlasBuild['meta'] = {
    axis: layout.bounds,
    hubThreshold,
    layoutStrategy: layout.strategy,
    source: config.apiBaseUrl + config.daemonListEndpoint,
  };

  return {
    nodes: atlasNodes,
    edges: atlasEdges,
    bounds: layout.bounds,
    stats,
    meta,
    durationMs,
    rawEdgeCount,
  };
};

export class AtlasBuilder {
  private state: AtlasState = { building: true };
  private lastCompletedBuild?: AtlasBuild;
  private timer?: NodeJS.Timeout;

  public async start() {
    await this.refresh();
    if (config.updateIntervalMs > 0) {
      this.timer = setInterval(() => {
        this.refresh().catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          logger.error('Failed to refresh atlas', { message });
        });
      }, config.updateIntervalMs);
    }
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  public getState(): AtlasState {
    return this.state;
  }

  public async refresh() {
    logger.info('Starting atlas build');
    // Always preserve the last completed build while rebuilding
    this.state = { building: true, data: this.lastCompletedBuild };
    const startedAt = Date.now();

    try {
      const fluxNodes = await fetchFluxNodeList();
      const peerResults = await fetchPeerData(fluxNodes);
      const artifacts = buildArtifacts(peerResults, startedAt);

      const buildId = Date.now().toString(36) + '-' + artifacts.nodes.length.toString();

      const build: AtlasBuild = {
        buildId,
        startedAt: new Date(startedAt).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: artifacts.durationMs,
        nodes: artifacts.nodes,
        edges: artifacts.edges,
        bounds: artifacts.bounds,
        stats: artifacts.stats,
        config: {
          maxNodes: config.maxNodes,
          maxPeersPerNode: config.maxPeersPerNode,
          maxEdges: config.maxEdges,
          maxNodeDegree: config.maxNodeDegree,
          maxStubNodes: config.maxStubNodes,
          includeExternalPeers: config.includeExternalPeers,
          layoutNodeCap: config.layoutNodeCap,
          updateIntervalMs: config.updateIntervalMs,
          quickSampleNodes: config.quickSampleNodes,
          rpcTimeout: config.rpcTimeout,
          rpcPort: config.rpcPort,
        },
        meta: artifacts.meta,
      };

      // Save the completed build and update state
      this.lastCompletedBuild = build;
      this.state = {
        building: false,
        data: build,
      };

      logger.info('Atlas build complete', {
        nodes: build.nodes.length,
        edges: build.edges.length,
        durationMs: build.durationMs,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Atlas build failed', { message });
      // Keep last completed build on error, just mark as not building
      this.state = {
        building: false,
        data: this.lastCompletedBuild,
        error: message,
      };
    }
  }
}

export const atlasBuilder = new AtlasBuilder();



