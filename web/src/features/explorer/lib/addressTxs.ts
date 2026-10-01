// What a transaction means for one address: its net effect, the direction, the counterparties, and
// the balance and payout series reconstructed from a loaded history. All pure, all in exact base units
// until the chart edge.

import type { TxDetailDto } from '../../../api/generated/TxDetailDto';
import { parseFlux } from '../../../lib/format';
import { classifyOutput, type PayoutRole } from './coinbase';

export type Direction = 'in' | 'out' | 'payout' | 'self' | 'none';

/** Outputs to `addr` minus inputs from `addr`: positive when the address gained. */
export function addressDeltaSats(tx: TxDetailDto, addr: string): bigint {
  let delta = 0n;
  for (const o of tx.outputs) if (o.address === addr) delta += parseFlux(o.value) ?? 0n;
  for (const i of tx.inputs) if (i.address === addr) delta -= parseFlux(i.value) ?? 0n;
  return delta;
}

export interface TxForAddress {
  txid: string;
  height: number | null;
  timeMs: number | null;
  confirmations: number;
  kind: TxDetailDto['kind'];
  direction: Direction;
  deltaSats: bigint;
  /** For a coinbase payout: which tier or the dev fund this output was. */
  role: PayoutRole | null;
  counterparties: string[];
  moreCounterparties: number;
}

export function describeTxForAddress(tx: TxDetailDto, addr: string, maxCounterparties = 2): TxForAddress {
  const delta = addressDeltaSats(tx, addr);
  const isCoinbase = tx.kind === 'coinbase' || tx.inputs.some((i) => i.coinbase);
  let role: PayoutRole | null = null;
  if (isCoinbase && tx.height !== null) {
    const mine = tx.outputs.find((o) => o.address === addr);
    if (mine) role = classifyOutput(tx.height, mine.address, parseFlux(mine.value) ?? 0n);
  }
  let direction: Direction;
  if (isCoinbase && delta > 0n) direction = 'payout';
  else if (delta > 0n) direction = 'in';
  else if (delta < 0n) direction = 'out';
  else if (tx.outputs.some((o) => o.address === addr) || tx.inputs.some((i) => i.address === addr))
    direction = 'self';
  else direction = 'none';

  // Counterparties: the other side of the movement.
  const others = new Map<string, bigint>();
  if (direction === 'out' || direction === 'self') {
    for (const o of tx.outputs) {
      if (o.address && o.address !== addr)
        others.set(o.address, (others.get(o.address) ?? 0n) + (parseFlux(o.value) ?? 0n));
    }
  } else if (direction === 'in') {
    for (const i of tx.inputs) {
      if (i.address && i.address !== addr)
        others.set(i.address, (others.get(i.address) ?? 0n) + (parseFlux(i.value) ?? 0n));
    }
  }
  const ranked = [...others.entries()].sort((a, b) => Number(b[1] - a[1])).map(([a]) => a);
  return {
    txid: tx.txid,
    height: tx.height,
    timeMs: tx.time_ms,
    confirmations: tx.confirmations,
    kind: tx.kind,
    direction,
    deltaSats: delta,
    role,
    counterparties: ranked.slice(0, maxCounterparties),
    moreCounterparties: Math.max(0, ranked.length - maxCounterparties),
  };
}

export interface BalancePoint {
  /** Unix ms of the block that included the transaction. */
  t: number;
  /** Balance after the transaction, FLUX. */
  balance: number;
  delta: number;
  height: number | null;
  txid: string;
}

export interface BalanceSeries {
  /** Oldest first. */
  points: BalancePoint[];
  /** Balance before the oldest loaded transaction, FLUX (0 for a complete history). */
  startBalance: number;
  /** True when the whole history is loaded, so the series is anchored at zero and exact. */
  complete: boolean;
}

const toFlux = (s: bigint) => Number(s) / 1e8;

/**
 * The balance after each confirmed transaction. With a partial history the series is anchored on the
 * current balance and walks backwards; with the complete history it is summed forwards from zero.
 * Unconfirmed transactions never move the confirmed balance and are skipped.
 */
export function balanceSeries(
  txsNewestFirst: readonly TxDetailDto[],
  addr: string,
  balanceNowSats: bigint,
  complete: boolean,
): BalanceSeries {
  const confirmed = txsNewestFirst.filter((t) => t.height !== null && t.time_ms !== null);
  const deltas = confirmed.map((t) => addressDeltaSats(t, addr));
  const n = confirmed.length;
  const afterSats: bigint[] = new Array<bigint>(n);
  let startSats: bigint;
  if (complete) {
    // Forward from zero: the oldest transaction is last in the newest-first list.
    let running = 0n;
    for (let i = n - 1; i >= 0; i--) {
      running += deltas[i]!;
      afterSats[i] = running;
    }
    startSats = 0n;
  } else {
    let running = balanceNowSats;
    for (let i = 0; i < n; i++) {
      afterSats[i] = running;
      running -= deltas[i]!;
    }
    startSats = running;
  }
  const points: BalancePoint[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const t = confirmed[i]!;
    points.push({
      t: t.time_ms!,
      balance: toFlux(afterSats[i]!),
      delta: toFlux(deltas[i]!),
      height: t.height,
      txid: t.txid,
    });
  }
  return { points, startBalance: toFlux(startSats), complete };
}

/** Keeps at most `max` points, the last of each equal time bucket (the balance at the end of it). */
export function thinPoints<T extends { t: number }>(points: readonly T[], max: number): T[] {
  if (points.length <= max) return [...points];
  const t0 = points[0]!.t;
  const t1 = points.at(-1)!.t;
  const span = Math.max(1, t1 - t0);
  const out: T[] = [];
  let bucket = -1;
  for (const p of points) {
    const b = Math.min(max - 1, Math.floor(((p.t - t0) / span) * max));
    if (b === bucket) out[out.length - 1] = p;
    else {
      out.push(p);
      bucket = b;
    }
  }
  return out;
}

export interface PayoutEvent {
  t: number;
  height: number;
  txid: string;
  /** Output index in the coinbase: one address can be paid by several outputs of the same block. */
  n: number;
  role: PayoutRole;
  sats: bigint;
}

/** Coinbase payouts to `addr` in a loaded history, oldest first. */
export function payoutEvents(txsNewestFirst: readonly TxDetailDto[], addr: string): PayoutEvent[] {
  const out: PayoutEvent[] = [];
  for (const tx of txsNewestFirst) {
    if (tx.height === null || tx.time_ms === null) continue;
    if (!(tx.kind === 'coinbase' || tx.inputs.some((i) => i.coinbase))) continue;
    for (const o of tx.outputs) {
      if (o.address !== addr) continue;
      const sats = parseFlux(o.value) ?? 0n;
      out.push({
        t: tx.time_ms,
        height: tx.height,
        txid: tx.txid,
        n: o.n,
        role: classifyOutput(tx.height, o.address, sats),
        sats,
      });
    }
  }
  return out.reverse();
}
