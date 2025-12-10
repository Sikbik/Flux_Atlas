import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().optional(),
  FLUX_API_BASE_URL: z.string().optional(),
  FLUX_DAEMON_LIST_ENDPOINT: z.string().optional(),
  FLUX_RPC_PORT: z.string().optional(),
  FLUX_RPC_TIMEOUT: z.string().optional(),
  FLUX_MAX_WORKERS: z.string().optional(),
  FLUX_MAX_NODES: z.string().optional(),
  FLUX_QUICK_SAMPLE_NODES: z.string().optional(),
  FLUX_MAX_PEERS_PER_NODE: z.string().optional(),
  FLUX_MAX_EDGES: z.string().optional(),
  FLUX_MAX_NODE_DEGREE: z.string().optional(),
  FLUX_MAX_STUB_NODES: z.string().optional(),
  FLUX_INCLUDE_EXTERNAL_PEERS: z.string().optional(),
  FLUX_LAYOUT_NODE_CAP: z.string().optional(),
  FLUX_UPDATE_INTERVAL: z.string().optional(),
  FLUX_RPC_PROTOCOL: z.string().optional(),
  FLUX_ALLOW_INSECURE_SSL: z.string().optional(),
  FLUX_ENABLE_ARCANE_PROBE: z.string().optional(),
  FLUX_LAYOUT_SEED: z.string().optional()
});

type RawEnv = z.infer<typeof envSchema>;

const rawEnv: RawEnv = envSchema.parse(process.env);

const toNumber = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback;
  return /^(1|true|yes)$/i.test(value.trim());
};

export interface FluxConfig {
  port: number;
  apiBaseUrl: string;
  daemonListEndpoint: string;
  rpcProtocol: 'http' | 'https';
  rpcPort: number;
  rpcTimeout: number;
  maxWorkers: number;
  maxNodes: number;
  quickSampleNodes: number;
  maxPeersPerNode: number;
  maxEdges: number;
  maxNodeDegree: number;
  maxStubNodes: number;
  includeExternalPeers: boolean;
  layoutNodeCap: number;
  updateIntervalMs: number;
  allowInsecureSSL: boolean;
  enableArcaneProbe: boolean;
  layoutSeed: string;
}

export const config: FluxConfig = {
  port: toNumber(rawEnv.PORT, 4000),
  apiBaseUrl: rawEnv.FLUX_API_BASE_URL ?? 'https://api.runonflux.io',
  daemonListEndpoint:
    rawEnv.FLUX_DAEMON_LIST_ENDPOINT ?? '/daemon/listfluxnodes',
  rpcProtocol: (rawEnv.FLUX_RPC_PROTOCOL ?? 'http').toLowerCase() === 'https'
    ? 'https'
    : 'http',
  rpcPort: toNumber(rawEnv.FLUX_RPC_PORT, 16127),
  // Reduced timeout for faster fail-fast on unresponsive nodes
  rpcTimeout: toNumber(rawEnv.FLUX_RPC_TIMEOUT, 4000),
  // Increased concurrency for faster network scans
  maxWorkers: Math.max(1, toNumber(rawEnv.FLUX_MAX_WORKERS, 50)),
  maxNodes: Math.max(1, toNumber(rawEnv.FLUX_MAX_NODES, 9000)),
  quickSampleNodes: Math.max(0, toNumber(rawEnv.FLUX_QUICK_SAMPLE_NODES, 0)),
  maxPeersPerNode: Math.max(0, toNumber(rawEnv.FLUX_MAX_PEERS_PER_NODE, 48)),
  maxEdges: Math.max(0, toNumber(rawEnv.FLUX_MAX_EDGES, 90000)),
  maxNodeDegree: Math.max(0, toNumber(rawEnv.FLUX_MAX_NODE_DEGREE, 64)),
  maxStubNodes: Math.max(0, toNumber(rawEnv.FLUX_MAX_STUB_NODES, 6000)),
  includeExternalPeers: toBoolean(rawEnv.FLUX_INCLUDE_EXTERNAL_PEERS, true),
  layoutNodeCap: Math.max(0, toNumber(rawEnv.FLUX_LAYOUT_NODE_CAP, 4200)),
  updateIntervalMs: Math.max(0, toNumber(rawEnv.FLUX_UPDATE_INTERVAL, 30 * 60_000)), // 30 minutes
  allowInsecureSSL: toBoolean(rawEnv.FLUX_ALLOW_INSECURE_SSL, true),
  enableArcaneProbe: toBoolean(rawEnv.FLUX_ENABLE_ARCANE_PROBE, true),
  layoutSeed: rawEnv.FLUX_LAYOUT_SEED ?? 'flux-atlas'
};

export type Config = typeof config;
