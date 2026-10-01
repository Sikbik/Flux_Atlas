// Shared formatting for the terminal's output: a node as a line of spans, the coinbase split, a block
// in one sentence. Everything reads from the NetworkStore; unknown stays "unknown", never zero.

import type { BlockLite } from '../../../api/generated/BlockLite';
import type { PayoutDto } from '../../../api/generated/PayoutDto';
import { formatBytes, formatFlux, formatInt, formatSats, parseFlux } from '../../../lib/format';
import type { ChainBlock, NetworkStore } from '../../../store/network';
import { Reach } from '../../../store/nodeTable';
import { nodeFacts } from '../palette/local';
import { dim, link, type Span, sp, tierSpan, val } from './output';

/** City, else country name, else nothing. */
export function placeOf(store: NetworkStore, row: number): string {
  const f = nodeFacts(store, row);
  return f.city || (f.countryCode ? f.countryName : '');
}

const STATUS_STYLE: Record<string, 'ok' | 'warn' | 'crit' | 'dim'> = {
  Confirmed: 'ok',
  Started: 'warn',
  DoS: 'crit',
  Offline: 'dim',
  Expired: 'crit',
  Departed: 'dim',
  Unreachable: 'warn',
  Unknown: 'dim',
};

/**
 * A node as spans: tier (coloured), endpoint (opens the node), status, queue position, place. With
 * `columns` the parts line up in a list: the tier, endpoint and status are padded to fixed widths (outside
 * the link, so its underline stops at the endpoint).
 */
export function nodeSpans(
  store: NetworkStore,
  row: number,
  opts: { padEndpoint?: number; columns?: boolean } = {},
): Span[] {
  const f = nodeFacts(store, row);
  const key = f.endpoint || String(store.nodes.ids[row] ?? row);
  const ep = f.endpoint || `node #${store.nodes.ids[row] ?? row}`;
  const out: Span[] = [];
  out.push(f.tier ? tierSpan(f.tier) : dim('Unknown'));
  if (opts.columns) out.push(sp(' '.repeat(Math.max(0, 8 - (f.tier ?? 'unknown').length))));
  out.push(sp('  '));
  out.push(link(ep, { to: '/node/$key', params: { key } }));
  const gap = Math.max(0, (opts.padEndpoint ?? 0) - [...ep].length);
  out.push(sp(`${' '.repeat(gap)}  `));
  out.push(
    sp(opts.columns ? f.status.label.padEnd(11) : f.status.label, STATUS_STYLE[f.status.label] ?? 'dim'),
  );
  if (f.queue !== null) {
    const q = f.queue === 1 ? 'next in line' : `queue #${formatInt(f.queue)}`;
    out.push(dim(`  ${opts.columns ? q.padEnd(12) : q}`));
  } else if (opts.columns) out.push(sp(' '.repeat(14)));
  const place = placeOf(store, row);
  if (place) out.push(dim(`  ${place}`));
  return out;
}

export function isUnreachable(store: NetworkStore, row: number): boolean {
  return store.nodes.reachable[row] === Reach.No;
}

export type TierName = 'cumulus' | 'nimbus' | 'stratus';

/**
 * The dev fund of a block: the node's own figure when the live message carried it, otherwise what the
 * reward leaves after the three payouts (the fourth coinbase output), when all three are known.
 */
export function devFundOf(b: Pick<ChainBlock, 'devFund' | 'reward' | 'payouts'>): string | null {
  if (b.devFund) return b.devFund;
  const reward = parseFlux(b.reward);
  if (reward === null || b.payouts.length < 3) return null;
  let paid = 0n;
  for (const p of b.payouts) {
    const a = parseFlux(p.amount);
    if (a === null) return null;
    paid += a;
  }
  const rest = reward - paid;
  return rest >= 0n ? formatSats(rest, { decimals: 8, unit: false, group: false }) : null;
}

/** Per-tier payout amounts (8-decimal strings) from the latest blocks, and the dev fund. */
export function coinbaseSplit(store: NetworkStore): {
  tiers: Partial<Record<TierName, string>>;
  dev: string | null;
} {
  const tiers: Partial<Record<TierName, string>> = {};
  let dev: string | null = null;
  for (let i = 0; i < Math.min(5, store.blocks.size); i++) {
    const b = store.blocks.at(i);
    if (!b) continue;
    for (const p of b.payouts) {
      const t = p.tier as string;
      if ((t === 'cumulus' || t === 'nimbus' || t === 'stratus') && !tiers[t]) tiers[t] = p.amount;
    }
    if (dev === null) dev = devFundOf(b);
    if (tiers.cumulus && tiers.nimbus && tiers.stratus && dev) break;
  }
  return { tiers, dev };
}

export const flux2 = (amount: string | null | undefined): string => formatFlux(amount, { decimals: 2 });

/** A block of either origin (the live ring or the API) in one shape. */
export interface BlockBrief {
  height: number;
  hash: string;
  timeMs: number;
  size: number;
  txCount: number;
  producer: number | null;
  payouts: readonly PayoutDto[];
}

export function briefOf(b: ChainBlock | BlockLite): BlockBrief {
  if ('timeMs' in b)
    return {
      height: b.height,
      hash: b.hash,
      timeMs: b.timeMs,
      size: b.size,
      txCount: b.txCount,
      producer: b.producer,
      payouts: b.payouts,
    };
  return {
    height: b.height,
    hash: b.hash,
    timeMs: b.time_ms,
    size: b.size,
    txCount: b.tx_count,
    producer: b.producer,
    payouts: b.payouts,
  };
}

/** `Block 2,996,929, 17 tx, 3.6 KB, produced by 213.32.246.1:16137 (Copenhagen)`. */
export function blockSentence(store: NetworkStore, b: BlockBrief): Span[] {
  const spans: Span[] = [
    link(`Block ${formatInt(b.height)}`, { to: '/block/$key', params: { key: String(b.height) } }),
    sp(`, ${formatInt(b.txCount)} tx, ${formatBytes(b.size)}`),
  ];
  if (b.producer !== null) {
    const row = store.nodes.indexOf(b.producer);
    if (row >= 0) {
      const f = nodeFacts(store, row);
      const place = placeOf(store, row);
      spans.push(sp(', produced by '));
      spans.push(
        link(f.endpoint || `node #${b.producer}`, {
          to: '/node/$key',
          params: { key: f.endpoint || String(b.producer) },
        }),
      );
      if (place) spans.push(dim(` (${place})`));
    } else spans.push(dim(`, produced by node #${b.producer}`));
  }
  return spans;
}

export { val };
