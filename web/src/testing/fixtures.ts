// Deterministic synthetic network data for unit tests and benchmarks (never imported by the app).

import { encodeSyntheticNodesBin, type SyntheticNode } from '../api/bin/writer';
import type { BlockMsg } from '../api/generated/BlockMsg';
import type { BootstrapDto } from '../api/generated/BootstrapDto';
import type { LiveMsg } from '../api/generated/LiveMsg';
import type { NetworkSummary } from '../api/generated/NetworkSummary';
import type { Tier } from '../api/generated/Tier';
import { decodeNodesBin, type NodesBin } from '../api/nodesBin';

export const TIERS: Tier[] = ['cumulus', 'nimbus', 'stratus'];

export function hex64(n: number): string {
  return n.toString(16).padStart(64, '0');
}

/** A mainnet-sized nodes.bin (6,724 by default) with 10 locations and a few countries/orgs. */
export function syntheticNodesBin(count = 6_724, seq = 100): NodesBin {
  const nodes: SyntheticNode[] = [];
  for (let i = 0; i < count; i++) {
    const loc = i % 50 === 49 ? 0 : 1 + (i % 10);
    nodes.push({
      id: i,
      lat: loc === 0 ? Number.NaN : 10 + loc,
      lon: loc === 0 ? Number.NaN : 20 + loc,
      tier: 1 + (i % 10 < 5 ? 0 : i % 10 < 7 ? 1 : 2),
      status: 1,
      flags: i % 3 === 0 ? 0x01 : 0,
      loc,
      country: loc === 0 ? 0 : 1 + (loc % 3),
      org: loc === 0 ? 0 : 1 + (loc % 2),
      appCount: i % 3 === 0 ? 1 : 0,
      rank: 1 + i,
      lastPaid: 2_990_000 + (i % 3000),
      ip: `5.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}:16127`,
    });
  }
  const locations = [{ lat: Number.NaN, lon: Number.NaN, country: 0, nodeCount: 0, city: '' }];
  for (let l = 1; l <= 10; l++)
    locations.push({ lat: 10 + l, lon: 20 + l, country: 1 + (l % 3), nodeCount: 0, city: `City ${l}` });
  for (const n of nodes) locations[n.loc ?? 0]!.nodeCount++;
  return decodeNodesBin(
    encodeSyntheticNodesBin(nodes, {
      seq,
      generatedMs: 1_000,
      countries: ['', 'DE\u001fGermany', 'FI\u001fFinland', 'US\u001fUnited States'],
      orgs: ['', 'Hetzner Online GmbH', 'OVH SAS'],
      versions: ['', '8.20.0'],
      locations,
    }),
  );
}

export function summary(height: number, extra: Partial<NetworkSummary> = {}): NetworkSummary {
  return {
    node_count: 6_724,
    host_count: 2_655,
    tiers: { cumulus: 3_378, nimbus: 1_582, stratus: 1_764, total: 6_724 },
    country_count: 60,
    provider_count: 120,
    arcane_count: 1_000,
    unreachable_count: 150,
    app_count: 1_900,
    instance_count: 5_700,
    tip: { height, hash: hex64(height), time_ms: 1_000_000, producer: 7 },
    reward: '14.00000000',
    next_reduction_height: 3_071_200,
    supply: null,
    price: null,
    mempool_size: 12,
    ...extra,
  };
}

export function bootstrap(seq = 100, height = 2_996_914): BootstrapDto {
  return {
    server: { name: 'flux-atlas', version: '0.1.0', api_version: 1, started_ms: 1 },
    seq,
    generated_ms: 1_000,
    stale: false,
    network: summary(height),
    tiers: [],
    blocks: Array.from({ length: 30 }, (_, k) => ({
      height: height - k,
      hash: hex64(height - k),
      time_ms: 1_000_000 - k * 30_000,
      size: 4_000,
      tx_count: 14,
      kind: 'pon' as const,
      producer: k,
      payouts: [],
      reward: '14.00000000',
      fees: '0.00000000',
      confirm_count: 12,
      start_count: 0,
      transfer_count: 1,
    })),
    apps: [
      {
        name: 'kadenanode',
        display_name: 'KadenaNode',
        owner: 'owner',
        spec_version: 8,
        instances_target: 3,
        instances_running: 3,
        component_count: 1,
        enterprise: false,
        per_instance: { cpu: 0.5, ram_mb: 1000, hdd_gb: 10 },
        totals: { cpu: 1.5, ram_mb: 3000, hdd_gb: 30 },
        height: 2_950_000,
        expire_height: 3_000_000,
      },
    ],
    freshness: [
      {
        job: 'chain_stream',
        last_ok_ms: 1_000,
        last_error: null,
        last_error_ms: null,
        stale: false,
        next_run_ms: null,
      },
    ],
  } as BootstrapDto;
}

export function blockMsg(
  height: number,
  opts: { heartbeats?: number[]; confirms?: number[]; producer?: number; payees?: number[] } = {},
): BlockMsg {
  const payees = opts.payees ?? [10, 20, 30];
  return {
    height,
    hash: hex64(height),
    prev_hash: hex64(height - 1),
    time_ms: 1_000_000 + (height - 2_996_914) * 30_000,
    size: 4_200,
    tx_count: 3 + (opts.heartbeats?.length ?? 0),
    producer:
      opts.producer === undefined
        ? null
        : {
            id: opts.producer,
            outpoint: `${hex64(opts.producer)}:0`,
            tier: 'stratus',
            endpoint: null,
            lat: 1,
            lon: 2,
            country_code: 'DE',
          },
    payouts: payees.map((node, k) => ({
      tier: TIERS[k] ?? 'cumulus',
      node,
      address: `t1payee${node}`,
      amount: ['1.00000000', '3.50000000', '9.00000000'][k] ?? '1.00000000',
    })),
    heartbeats: opts.heartbeats ?? [],
    confirms: opts.confirms ?? [],
    starts: [],
    updates: [],
    transfers_over_threshold: [],
    reward: '14.00000000',
    fees: '0.00010000',
    dev_fund: '0.50010000',
    app_payments: [],
    collateral_spent: [],
  };
}

/** Wraps a body into a LiveMsg envelope. */
export function live<T extends object>(
  t: LiveMsg['t'],
  seq: number,
  body: T,
  observed = 1_000_000,
  event: number | null = null,
): LiveMsg {
  return { seq, observed_ms: observed, event_ms: event, t, ...body } as unknown as LiveMsg;
}
