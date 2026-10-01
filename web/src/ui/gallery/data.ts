// Real data for the gallery: the live server's bootstrap (tier counts, latest blocks, apps, freshness),
// one real Stratus node with its detail, and the tip block's transactions. Everything here is read
// through the app's own query hooks; nothing is invented.

import { useQuery } from '@tanstack/react-query';
import { queries, useBootstrap, useNodes } from '../../api/queries';
import { parseEndpoint } from '../../lib/format';

/** A metric series for a sparkline: missing or non-positive samples become gaps, never plotted zeros. */
function trend(values: ReadonlyArray<number | null> | undefined): (number | null)[] | undefined {
  return values?.map((v) => (v === null || !(v > 0) ? null : v));
}

export function useGalleryData() {
  const boot = useBootstrap();
  const stratus = useNodes({ tier: 'stratus', sort: 'rank', limit: 3 });
  const first = stratus.data?.items[0];
  const key = first?.endpoint ?? first?.outpoint ?? '';
  const detail = useQuery({ ...queries.nodeDetail(key), enabled: key !== '' });
  const tip = boot.data?.blocks[0];
  const blockDetail = useQuery({ ...queries.block(tip?.height ?? 0), enabled: tip !== undefined });
  const node = detail.data?.node;
  const metrics = useQuery(queries.metrics({ series: ['node_count', 'price_usd'], step: '1h' }));
  return {
    boot,
    network: boot.data?.network,
    tiers: boot.data?.tiers,
    blocks: boot.data?.blocks,
    apps: boot.data?.apps,
    freshness: boot.data?.freshness,
    nodes: stratus.data?.items,
    node,
    /** The node's host (its IP without the port), for host links. */
    host: parseEndpoint(node?.endpoint)?.host ?? null,
    detail: detail.data,
    /** Transactions of the tip block (real txids for hash and link specimens). */
    txs: blockDetail.data?.txs,
    blockDetail: blockDetail.data,
    /** When an ingest job last succeeded (unix ms), from the bootstrap freshness list; null when unknown. */
    lastOk: (job: string): number | null =>
      boot.data?.freshness.find((j) => j.job === job)?.last_ok_ms ?? null,
    /** Hourly node count for the last day (real). */
    nodeSeries: trend(metrics.data?.series.node_count),
    /** Hourly FLUX price; older rows carry 0 and show as gaps. */
    priceSeries: trend(metrics.data?.series.price_usd),
    loading: boot.isPending || stratus.isPending || detail.isPending,
  };
}
