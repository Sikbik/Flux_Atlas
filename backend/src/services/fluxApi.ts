import pLimit from 'p-limit';
import { config } from '../config/env.js';
import { FluxNodeRecord } from '../types/atlas.js';
import { fetchJson } from '../utils/http.js';
import { normalizeIp, splitHostPort } from '../utils/net.js';
import { logger } from '../utils/logger.js';

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

export async function fetchPeerData(nodes: FluxNodeRecord[]): Promise<PeerFetchResult[]> {
  const tasks = nodes.map((node) =>
    workerLimit(async () => {
      const { host, port } = splitHostPort(node.ip);

      // Skip nodes with invalid/empty IP
      if (!host || host.trim() === '') {
        logger.warn('Skipping node with invalid IP', { nodeIp: node.ip });
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

      let outgoingPeers: string[] = [];
      let incomingPeers: string[] = [];
      let arcane: boolean | undefined;

      try {
        // Fetch outgoing connections (connectedpeers)
        const outgoingEndpoint = `${baseUrl}/flux/connectedpeers`;
        const outgoingResponse = await fetchJson<FluxPeersResponse>(outgoingEndpoint, {
          timeoutMs: config.rpcTimeout
        });

        if (outgoingResponse.status === 'success') {
          outgoingPeers = outgoingResponse.data
            .map((peer) => sanitizePeer(peer, host))
            .filter((value): value is string => Boolean(value));
        }

        // Fetch incoming connections
        const incomingEndpoint = `${baseUrl}/flux/incomingconnections`;
        try {
          const incomingResponse = await fetchJson<FluxPeersResponse>(incomingEndpoint, {
            timeoutMs: config.rpcTimeout
          });

          if (incomingResponse.status === 'success') {
            incomingPeers = incomingResponse.data
              .map((peer) => sanitizePeer(peer, host))
              .filter((value): value is string => Boolean(value));
          }
        } catch (error) {
          logger.debug('Failed to fetch incoming connections', {
            node: host,
            message: error instanceof Error ? error.message : String(error)
          });
        }

        // Probe for ArcaneOS
        if (config.enableArcaneProbe) {
          try {
            const arcaneEndpoint = `${baseUrl}/flux/isarcaneos`;
            const arcaneResponse = await fetchJson<FluxBooleanResponse>(arcaneEndpoint, {
              timeoutMs: Math.min(config.rpcTimeout, 8000)
            });
            if (arcaneResponse.status === 'success') {
              arcane = Boolean(arcaneResponse.data);
            }
          } catch (error) {
            logger.debug('Arcane probe failed', {
              node: host,
              message: error instanceof Error ? error.message : String(error)
            });
          }
        }

        // Fetch bandwidth benchmarks
        let bandwidth: BenchmarkData | undefined;
        try {
          const benchmarkEndpoint = `${baseUrl}/benchmark/getbenchmarks`;
          const benchmarkResponse = await fetchJson<FluxBenchmarkResponse>(benchmarkEndpoint, {
            timeoutMs: Math.min(config.rpcTimeout, 8000)
          });
          if (benchmarkResponse.status === 'success' && benchmarkResponse.data) {
            bandwidth = {
              download_speed: benchmarkResponse.data.download_speed || 0,
              upload_speed: benchmarkResponse.data.upload_speed || 0
            };
          }
        } catch (error) {
          logger.debug('Benchmark fetch failed', {
            node: host,
            message: error instanceof Error ? error.message : String(error)
          });
        }

        return {
          node,
          outgoingPeers,
          incomingPeers,
          arcane,
          bandwidth
        } satisfies PeerFetchResult;
      } catch (error) {
        logger.warn('Failed to fetch peer data', {
          node: host,
          message: error instanceof Error ? error.message : String(error)
        });
        return {
          node,
          outgoingPeers: [],
          incomingPeers: [],
          arcane: undefined
        } satisfies PeerFetchResult;
      }
    })
  );

  return Promise.all(tasks);
}
