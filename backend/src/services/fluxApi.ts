import pLimit from 'p-limit';
import { config } from '../config/env.js';
import { FluxNodeRecord, FluxApp } from '../types/atlas.js';
import { fetchJson } from '../utils/http.js';
import { normalizeIp, splitHostPort, isPrivateOrReservedIp } from '../utils/net.js';
import { logger } from '../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';

const CACHE_FILE = path.resolve(process.cwd(), 'data', 'peer_cache.json');
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface FluxDaemonResponse {
  status: 'success' | 'error';
  data: FluxNodeRecord[];
}

interface FluxPeersResponse {
  status: 'success' | 'error';
  data: Array<string | { ip: string; weight?: number; bytes?: number }>;
}

interface FluxBooleanResponse {
  status: 'success' | 'error';
  data: boolean;
}

interface FluxBenchmarkResponse {
  status: 'success' | 'error';
  data: BenchmarkData;
}

interface FluxAppsResponse {
  status: 'success' | 'error';
  data: Array<{
    name: string;
    description: string;
    version?: number;
    owner?: string;
  }>;
}

export interface BenchmarkData {
  download_speed: number;
  upload_speed: number;
}

export interface PeerFetchResult {
  node: FluxNodeRecord;
  outgoingPeers: string[];
  incomingPeers: string[];
  arcane?: boolean;
  bandwidth?: BenchmarkData;
  apps?: FluxApp[];
}

export async function fetchFluxNodeList(): Promise<FluxNodeRecord[]> {
  const endpoint = new URL(config.daemonListEndpoint, config.apiBaseUrl).toString();
  logger.info('Fetching flux node list', { endpoint });
  const response = await fetchJson<FluxDaemonResponse>(endpoint, {
    timeoutMs: Math.max(config.rpcTimeout, 15_000)
  });

  if (response.status !== 'success') {
    throw new Error('Flux daemon list returned non-success status');
  }

  let nodes = response.data ?? [];
  if (config.quickSampleNodes > 0 && nodes.length > config.quickSampleNodes) {
    nodes = nodes.slice(0, config.quickSampleNodes);
  }

  return nodes.slice(0, config.maxNodes);
}

const workerLimit = pLimit(config.maxWorkers);

const sanitizePeer = (value: string | { ip: string }, nodeIp: string) => {
  if (!value) return null;
  const raw = typeof value === 'string' ? value : value.ip;
  if (!raw) return null;

  // Keep the port if present (important for uPNP clusters)
  const { host, port } = splitHostPort(raw);
  const cleaned = port ? `${host}:${port}` : host;

  // Filter out self-connections (same host, ignoring port)
  if (!host || host === splitHostPort(nodeIp).host) {
    return null;
  }
  return cleaned;
};

export async function fetchPeerData(
  nodes: FluxNodeRecord[],
  onProgress?: (completed: number, total: number) => void
): Promise<PeerFetchResult[]> {
  // Try to load from cache first
  try {
    const cacheExists = await fs.stat(CACHE_FILE).then(() => true).catch(() => false);
    if (cacheExists) {
      const cacheContent = await fs.readFile(CACHE_FILE, 'utf-8');

      // SECURITY: Validate JSON structure before using
      const cache = JSON.parse(cacheContent);

      // Validate cache structure
      if (!cache || typeof cache !== 'object' || !cache.timestamp || !Array.isArray(cache.data)) {
        logger.warn('Cache file has invalid structure, ignoring');
        throw new Error('Invalid cache structure');
      }

      const age = Date.now() - cache.timestamp;

      if (age < CACHE_TTL_MS) {
        logger.info('Loading peer data from cache', { ageMs: age });
        return cache.data;
      } else {
        logger.info('Cache expired', { ageMs: age });
      }
    }
  } catch (err) {
    logger.warn('Failed to read cache, will fetch fresh data', { err });
  }

  let completedCount = 0;
  const totalCount = nodes.length;

  const tasks = nodes.map((node) =>
    workerLimit(async () => {
      const { host, port } = splitHostPort(node.ip);

      // Skip nodes with invalid/empty IP
      if (!host || host.trim() === '') {
        logger.warn('Skipping node with invalid IP', { nodeIp: node.ip });
        completedCount++;
        if (onProgress) onProgress(completedCount, totalCount);
        return {
          node,
          outgoingPeers: [],
          incomingPeers: [],
          arcane: undefined
        } satisfies PeerFetchResult;
      }

      // SECURITY: Block private/reserved IPs to prevent SSRF attacks
      if (isPrivateOrReservedIp(host)) {
        logger.warn('Blocked request to private/reserved IP (SSRF protection)', { ip: host });
        completedCount++;
        if (onProgress) onProgress(completedCount, totalCount);
        return {
          node,
          outgoingPeers: [],
          incomingPeers: [],
          arcane: undefined
        } satisfies PeerFetchResult;
      }

      // Use port from API if available, otherwise default to 16127
      const apiPort = port ?? config.rpcPort;
      const baseUrl = `${config.rpcProtocol}://${host}:${apiPort}`;

      // Phase 1: Topology (Peers) - Critical for graph structure
      // Run these in parallel
      const outgoingPromise = fetchJson<FluxPeersResponse>(`${baseUrl}/flux/connectedpeers`, {
        timeoutMs: config.rpcTimeout
      });

      const incomingPromise = fetchJson<FluxPeersResponse>(`${baseUrl}/flux/incomingconnections`, {
        timeoutMs: config.rpcTimeout
      });

      const [outgoingResult, incomingResult] = await Promise.allSettled([outgoingPromise, incomingPromise]);

      let outgoingPeers: string[] = [];
      let incomingPeers: string[] = [];
      let isAlive = false;

      if (outgoingResult.status === 'fulfilled' && outgoingResult.value.status === 'success') {
        outgoingPeers = outgoingResult.value.data
          .map((peer) => sanitizePeer(peer, host))
          .filter((value): value is string => Boolean(value));
        isAlive = true;
      }

      if (incomingResult.status === 'fulfilled' && incomingResult.value.status === 'success') {
        incomingPeers = incomingResult.value.data
          .map((peer) => sanitizePeer(peer, host))
          .filter((value): value is string => Boolean(value));
        isAlive = true;
      }

      // Fail Fast: If we can't reach the node for peer data, it's likely down or blocking RPC.
      // Skip metadata fetching to save time.
      if (!isAlive) {
        completedCount++;
        if (onProgress) onProgress(completedCount, totalCount);
        return {
          node,
          outgoingPeers: [],
          incomingPeers: [],
          arcane: undefined
        } satisfies PeerFetchResult;
      }

      // Phase 2: Metadata (Arcane, Benchmarks, Apps) - Nice to have
      // Run these in parallel only if node is alive
      // Use shorter timeouts for metadata - not critical for graph structure
      const metadataTimeout = Math.min(config.rpcTimeout, 3000);

      const arcanePromise = config.enableArcaneProbe
        ? fetchJson<FluxBooleanResponse>(`${baseUrl}/flux/isarcaneos`, { timeoutMs: metadataTimeout })
        : Promise.resolve(null);

      const benchmarkPromise = fetchJson<FluxBenchmarkResponse>(`${baseUrl}/benchmark/getbenchmarks`, {
        timeoutMs: metadataTimeout
      });

      const appsPromise = fetchJson<FluxAppsResponse>(`${baseUrl}/apps/installedapps`, {
        timeoutMs: metadataTimeout
      });

      const [arcaneResult, benchmarkResult, appsResult] = await Promise.allSettled([
        arcanePromise,
        benchmarkPromise,
        appsPromise
      ]);

      let arcane: boolean | undefined;
      if (arcaneResult.status === 'fulfilled' && arcaneResult.value && arcaneResult.value.status === 'success') {
        arcane = Boolean(arcaneResult.value.data);
      }

      let bandwidth: BenchmarkData | undefined;
      if (benchmarkResult.status === 'fulfilled' && benchmarkResult.value.status === 'success' && benchmarkResult.value.data) {
        bandwidth = {
          download_speed: benchmarkResult.value.data.download_speed || 0,
          upload_speed: benchmarkResult.value.data.upload_speed || 0
        };
      }

      let apps: FluxApp[] | undefined;
      if (appsResult.status === 'fulfilled' && appsResult.value.status === 'success' && appsResult.value.data) {
        apps = appsResult.value.data.map(app => ({
          name: app.name,
          description: app.description,
          version: app.version,
          owner: app.owner
        }));
      }

      completedCount++;
      if (onProgress) {
        onProgress(completedCount, totalCount);
      }

      return {
        node,
        outgoingPeers,
        incomingPeers,
        arcane,
        bandwidth,
        apps
      } satisfies PeerFetchResult;
    })
  );

  const results = await Promise.all(tasks);

  // Save to cache
  try {
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify({
      timestamp: Date.now(),
      data: results
    }, null, 2));
    logger.info('Saved peer data to cache', { path: CACHE_FILE });
  } catch (err) {
    logger.warn('Failed to save cache', { err });
  }

  return results;
}
