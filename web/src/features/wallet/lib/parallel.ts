// Parallel assets: what a claim is worth against what it costs, the order the chains read in, and safe links to
// their explorers. Atlas never claims anything (that happens in Zelcore Fusion); this only reads and advises.

import type { ParallelAssetsDto, ParallelChain, ParallelClaim } from '../types';

/** The ticker a chain wears as its badge: type, not a third party's logo. */
const TICKERS: Record<string, string> = {
  kda: 'KDA',
  bsc: 'BSC',
  eth: 'ETH',
  trx: 'TRX',
  sol: 'SOL',
  avax: 'AVAX',
  erg: 'ERG',
  algo: 'ALGO',
  matic: 'MATIC',
  base: 'BASE',
};

export function chainTicker(chain: string): string {
  return TICKERS[chain.toLowerCase()] ?? chain.toUpperCase().slice(0, 5);
}

export type ClaimVerdict = 'inactive' | 'nothing' | 'worth' | 'fair' | 'wait' | 'underwater';

export interface Efficiency {
  /** What is waiting to be claimed on the chain, FLUX. */
  gross: number;
  /** What claiming costs. */
  fee: number;
  /** What is left after the fee (never below zero). */
  net: number;
  /** The fee as a share of the claim; null when nothing is claimable. */
  feeShare: number | null;
  verdict: ClaimVerdict;
  /** The claim size at which the fee is one percent of it: above this a claim is clearly worth making. */
  worthAt: number;
}

/** The fee shares that change the advice: under one percent is plainly worth it, over five is worth waiting on. */
export const WORTH_SHARE = 0.01;
export const FAIR_SHARE = 0.05;

/** The claimable against the claim fee, and what to make of it. An ended chain is not claimable at all. */
export function claimEfficiency(c: Pick<ParallelChain, 'active' | 'claimable' | 'claim_fee'>): Efficiency {
  const gross = Math.max(0, c.claimable);
  const fee = Math.max(0, c.claim_fee);
  const feeShare = gross > 0 ? fee / gross : null;
  const base = { gross, fee, net: Math.max(0, gross - fee), feeShare, worthAt: fee / WORTH_SHARE };
  if (!c.active) return { ...base, verdict: 'inactive' };
  if (feeShare === null) return { ...base, verdict: 'nothing' };
  if (feeShare >= 1) return { ...base, verdict: 'underwater' };
  if (feeShare <= WORTH_SHARE) return { ...base, verdict: 'worth' };
  if (feeShare <= FAIR_SHARE) return { ...base, verdict: 'fair' };
  return { ...base, verdict: 'wait' };
}

export interface VerdictView {
  /** The word on the card. */
  label: string;
  /** The status colour role (never the only cue: the label says it too). */
  tone: 'ok' | 'pending' | 'warn' | 'crit' | 'off';
}

export function verdictView(v: ClaimVerdict): VerdictView {
  switch (v) {
    case 'worth':
      return { label: 'Worth claiming', tone: 'ok' };
    case 'fair':
      return { label: 'Fee is a small share', tone: 'pending' };
    case 'wait':
      return { label: 'Wait for more', tone: 'warn' };
    case 'underwater':
      return { label: 'Fee exceeds the claim', tone: 'crit' };
    case 'nothing':
      return { label: 'Nothing to claim', tone: 'off' };
    case 'inactive':
      return { label: 'Ended in Fusion', tone: 'off' };
  }
}

/** The fee as it reads: `0.02%`, `1.4%`, `over 100%`. */
export function feeShareText(share: number | null): string {
  if (share === null) return 'Unknown';
  if (share >= 1) return 'over 100%';
  const pct = share * 100;
  if (pct < 0.01) return 'under 0.01%';
  return `${pct < 1 ? pct.toFixed(2) : pct.toFixed(1)}%`;
}

/** Active chains first, then by what can be claimed, largest first; ties by name. */
export function sortChains(chains: readonly ParallelChain[]): ParallelChain[] {
  return [...chains].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) || b.claimable - a.claimable || a.name.localeCompare(b.name, 'en'),
  );
}

export interface ChainTotals {
  /** Over the chains that can still be claimed. */
  claimable: number;
  fees: number;
  net: number;
  active: number;
  inactive: number;
}

/** What the active chains add up to, from the per-chain figures (the server's `multi` is the claim-all quote). */
export function chainTotals(chains: readonly ParallelChain[]): ChainTotals {
  let claimable = 0;
  let fees = 0;
  let active = 0;
  let inactive = 0;
  for (const c of chains) {
    if (!c.active) {
      inactive++;
      continue;
    }
    active++;
    claimable += Math.max(0, c.claimable);
    fees += Math.max(0, c.claim_fee);
  }
  return { claimable, fees, net: Math.max(0, claimable - fees), active, inactive };
}

/** The share of what has been mined that was claimed, 0 to 1; null when nothing has been mined. */
export function claimedShare(dto: Pick<ParallelAssetsDto, 'mined' | 'claimed'>): number | null {
  return dto.mined > 0 ? Math.min(1, Math.max(0, dto.claimed / dto.mined)) : null;
}

// ---- links ----------------------------------------------------------------------------------------

/** A link only if it is a plain web address: an explorer URL from the server is data, never script. */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Fills an explorer template (`https://x/tx/{txid}`) with a value; null when there is no safe address to make. */
export function explorerUrl(
  template: string | null | undefined,
  vars: Record<string, string>,
): string | null {
  if (!template) return null;
  const filled = template.replace(/\{(\w+)\}/g, (_m, k: string) => encodeURIComponent(vars[k] ?? ''));
  return safeHttpUrl(filled);
}

/** The link of one claim: the server's own, else the chain's template filled with the transaction id. */
export function claimLink(claim: ParallelClaim, chains: readonly ParallelChain[]): string | null {
  const own = safeHttpUrl(claim.explorer_url);
  if (own) return own;
  const chain = chains.find((c) => c.chain === claim.chain);
  return explorerUrl(chain?.explorer_tx, { txid: claim.txid });
}

/** The chain's name for a claim row, falling back to its ticker. */
export function chainName(chain: string, chains: readonly ParallelChain[]): string {
  return chains.find((c) => c.chain === chain)?.name ?? chainTicker(chain);
}
