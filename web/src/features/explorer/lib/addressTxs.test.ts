import { describe, expect, it } from 'vitest';
import type { TxDetailDto } from '../../../api/generated/TxDetailDto';
import {
  addressDeltaSats,
  balanceSeries,
  describeTxForAddress,
  payoutEvents,
  thinPoints,
} from './addressTxs';

const ME = 't1Me';

function tx(id: string, t: number | null, over: Partial<TxDetailDto>): TxDetailDto {
  return {
    txid: id.padEnd(64, '0'),
    height: t === null ? null : 1_000 + t,
    block_hash: t === null ? null : 'b'.repeat(64),
    time_ms: t === null ? null : t * 1000,
    confirmations: t === null ? 0 : 5,
    size: 200,
    version: 4,
    kind: 'transfer',
    inputs: [],
    outputs: [],
    value_in: null,
    value_out: '0.00000000',
    fee: null,
    node_tx: null,
    ...over,
  };
}

const o = (n: number, address: string, value: string) => ({
  n,
  address,
  value,
  script_type: 'pubkeyhash',
  spent_txid: null,
  spent_height: null,
  op_return: null,
});
const i = (address: string, value: string) => ({
  coinbase: false,
  prev_txid: 'c'.repeat(64),
  prev_vout: 0,
  address,
  value,
});

// History, oldest to newest: +100 (received), -30 (sent, change 69.99 back), +1 (payout).
const received = tx('a1', 1, { inputs: [i('t1Other', '100.00000000')], outputs: [o(0, ME, '100.00000000')] });
const sent = tx('a2', 2, {
  inputs: [i(ME, '100.00000000')],
  outputs: [o(0, 't1Friend', '30.00000000'), o(1, ME, '69.99900000')],
  fee: '0.00100000',
});
const payout = tx('a3', 3, {
  kind: 'coinbase',
  inputs: [{ coinbase: true, prev_txid: null, prev_vout: null, address: null, value: null }],
  outputs: [
    o(0, 't3hPu1YDeGUCp8m7BQCnnNUmRMJBa5RadyA', '0.50000000'),
    o(1, 't1Cum', '1.00000000'),
    o(2, ME, '3.50000000'),
  ],
  height: 2_997_000,
});
// Newest first, as the API returns them.
const history = [payout, sent, received];

describe('addressDeltaSats', () => {
  it('is outputs to the address minus inputs from it', () => {
    expect(addressDeltaSats(received, ME)).toBe(10_000_000_000n);
    expect(addressDeltaSats(sent, ME)).toBe(-3_000_100_000n);
    expect(addressDeltaSats(payout, ME)).toBe(350_000_000n);
    expect(addressDeltaSats(payout, 't1Nobody')).toBe(0n);
  });
});

describe('describeTxForAddress', () => {
  it('names the direction and the other side', () => {
    const inn = describeTxForAddress(received, ME);
    expect(inn.direction).toBe('in');
    expect(inn.counterparties).toEqual(['t1Other']);

    const out = describeTxForAddress(sent, ME);
    expect(out.direction).toBe('out');
    expect(out.counterparties).toEqual(['t1Friend']);
    expect(out.deltaSats).toBe(-3_000_100_000n);
  });

  it('classifies a coinbase payout by amount', () => {
    const p = describeTxForAddress(payout, ME);
    expect(p.direction).toBe('payout');
    expect(p.role).toBe('nimbus');
  });

  it('is none for an unrelated address and self for a pure change move', () => {
    expect(describeTxForAddress(received, 't1Nobody').direction).toBe('none');
    const self = tx('s', 4, { inputs: [i(ME, '5.00000000')], outputs: [o(0, ME, '5.00000000')] });
    expect(describeTxForAddress(self, ME).direction).toBe('self');
  });

  it('limits the counterparties and counts the rest', () => {
    const many = tx('m', 5, {
      inputs: [i(ME, '10.00000000')],
      outputs: [
        o(0, 't1A', '3.00000000'),
        o(1, 't1B', '2.00000000'),
        o(2, 't1C', '1.00000000'),
        o(3, ME, '3.99900000'),
      ],
    });
    const d = describeTxForAddress(many, ME, 2);
    expect(d.counterparties).toEqual(['t1A', 't1B']);
    expect(d.moreCounterparties).toBe(1);
  });
});

describe('balanceSeries', () => {
  it('walks backwards from the current balance for a partial history', () => {
    // Balance now: 100 - 30.001 + 3.5 = 73.499 (the earlier history is not loaded).
    const now = 7_349_900_000n + 10_000_000_000n - 10_000_000_000n;
    const s = balanceSeries([payout, sent], ME, now, false);
    expect(s.complete).toBe(false);
    expect(s.points.map((p) => p.txid.slice(0, 2))).toEqual(['a2', 'a3']);
    expect(s.points[1]!.balance).toBeCloseTo(73.499, 8);
    expect(s.points[0]!.balance).toBeCloseTo(69.999, 8);
    expect(s.startBalance).toBeCloseTo(100, 8);
  });

  it('sums forwards from zero when the history is complete', () => {
    const s = balanceSeries(history, ME, 7_349_900_000n, true);
    expect(s.points.map((p) => p.balance.toFixed(3))).toEqual(['100.000', '69.999', '73.499']);
    expect(s.startBalance).toBe(0);
    expect(s.points.at(-1)!.balance).toBeCloseTo(73.499, 8);
  });

  it('skips unconfirmed transactions', () => {
    const pending = tx('pp', null, { inputs: [i(ME, '1.00000000')], outputs: [o(0, 't1X', '0.99900000')] });
    const s = balanceSeries([pending, ...history], ME, 7_349_900_000n, true);
    expect(s.points).toHaveLength(3);
  });

  it('is empty for no transactions', () => {
    expect(balanceSeries([], ME, 123n, false).points).toEqual([]);
  });
});

describe('thinPoints', () => {
  it('keeps everything under the cap', () => {
    const pts = Array.from({ length: 5 }, (_, k) => ({ t: k, v: k }));
    expect(thinPoints(pts, 10)).toHaveLength(5);
  });

  it('keeps the last point of each bucket and the last point overall', () => {
    const pts = Array.from({ length: 1000 }, (_, k) => ({ t: k * 1000, v: k }));
    const thin = thinPoints(pts, 100);
    expect(thin.length).toBeLessThanOrEqual(100);
    expect(thin.at(-1)!.v).toBe(999);
    for (let k = 1; k < thin.length; k++) expect(thin[k]!.t).toBeGreaterThan(thin[k - 1]!.t);
  });
});

describe('payoutEvents', () => {
  it('lists the coinbase payouts to the address, oldest first, with their tier', () => {
    const second = tx('a4', 4, { ...payout, txid: 'a4'.padEnd(64, '0'), time_ms: 4000, height: 2_997_001 });
    const events = payoutEvents([second, payout, sent], ME);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.role)).toEqual(['nimbus', 'nimbus']);
    expect(events[0]!.t).toBeLessThan(events[1]!.t);
    expect(events[0]!.sats).toBe(350_000_000n);
  });
});
