// Coinbase classification. Consensus does not fix the output order of a Proof of Node coinbase, so
// every output is classified by amount (and the dev fund address), exactly like the server
// (`atlas_core::emission::classify_output`): never by index.

import { parseFlux } from '../../../lib/format';
import { PAID_TIERS, type PaidTier, payoutSchedule } from './emission';
import { DEV_FUND_ADDRESS } from './entities';

export type PayoutRole = PaidTier | 'devfund' | 'other';

export function classifyOutput(height: number, address: string | null, sats: bigint): PayoutRole {
  const sched = payoutSchedule(height);
  if (!sched) return 'other';
  if (address === DEV_FUND_ADDRESS) return 'devfund';
  for (const tier of PAID_TIERS) if (sched[tier] === sats) return tier;
  if (address === null && sats >= sched.devFundMin) return 'devfund';
  return 'other';
}

export interface CoinbaseOutput {
  n: number;
  address: string | null;
  value: string;
}

export interface ClassifiedOutput {
  n: number;
  address: string | null;
  sats: bigint;
  role: PayoutRole;
}

/** Classifies every output of a coinbase; unparseable values are dropped. */
export function classifyCoinbase(height: number, outputs: readonly CoinbaseOutput[]): ClassifiedOutput[] {
  const out: ClassifiedOutput[] = [];
  for (const o of outputs) {
    const sats = parseFlux(o.value);
    if (sats === null) continue;
    out.push({ n: o.n, address: o.address, sats, role: classifyOutput(height, o.address, sats) });
  }
  return out;
}

/** The fees of a block: the dev fund output minus its minimum (zero when it is exactly the minimum). */
export function feesFromDevFund(height: number, devFundSats: bigint): bigint | null {
  const sched = payoutSchedule(height);
  if (!sched) return null;
  return devFundSats > sched.devFundMin ? devFundSats - sched.devFundMin : 0n;
}
