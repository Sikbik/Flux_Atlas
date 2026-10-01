import { describe, expect, it } from 'vitest';
import type { TxDetailDto } from '../../../api/generated/TxDetailDto';
import { buildFlow, layoutFlow, ribbonPath, thicknesses } from './txflow';

const H = (c: string) => c.repeat(64).slice(0, 64);

function tx(over: Partial<TxDetailDto>): TxDetailDto {
  return {
    txid: H('a'),
    height: 2_997_591,
    block_hash: H('b'),
    time_ms: 1_790_817_544_000,
    confirmations: 21,
    size: 244,
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

const out = (n: number, address: string | null, value: string, extra: object = {}) => ({
  n,
  address,
  value,
  script_type: 'pubkeyhash',
  spent_txid: null,
  spent_height: null,
  op_return: null,
  ...extra,
});

const inp = (address: string | null, value: string | null, vout = 1) => ({
  coinbase: false,
  prev_txid: H('c'),
  prev_vout: vout,
  address,
  value,
});

describe('buildFlow: transfers', () => {
  const transfer = tx({
    inputs: [inp('t1Sender', '217591.30000000')],
    outputs: [out(0, 't1Recipient', '190.85625000'), out(1, 't1Sender', '217400.44375000')],
    value_in: '217591.30000000',
    value_out: '217591.30000000',
    fee: '0.00000000',
  });

  it('collapses change back to the sender and keeps the recipient', () => {
    const f = buildFlow(transfer);
    expect(f.coinbase).toBe(false);
    expect(f.inputs.map((c) => c.address)).toEqual(['t1Sender']);
    expect(f.outputs.map((c) => [c.role, c.address])).toEqual([
      ['recipient', 't1Recipient'],
      ['change', 't1Sender'],
    ]);
    expect(f.selfTransfer).toBe(false);
    expect(f.feeSats).toBe(0n);
  });

  it('allocates the single input over the outputs in proportion', () => {
    const f = buildFlow(transfer);
    const total = f.bands.reduce((s, b) => s + b.weight, 0);
    expect(total).toBeCloseTo(217591.3, 3);
    const toRecipient = f.bands.find((b) => b.to === 'out:0')!;
    expect(toRecipient.weight).toBeCloseTo(190.85625, 5);
  });

  it('merges several change outputs into one card and flags a self transfer', () => {
    const f = buildFlow(
      tx({
        inputs: [inp('t1A', '10.00000000'), inp('t1B', '5.00000000')],
        outputs: [out(0, 't1A', '9.00000000'), out(1, 't1B', '5.99999000')],
        value_in: '15.00000000',
        value_out: '14.99999000',
        fee: '0.00001000',
      }),
    );
    expect(f.outputs).toHaveLength(1);
    expect(f.outputs[0]!.role).toBe('change');
    expect(f.outputs[0]!.indices).toEqual([0, 1]);
    expect(f.outputs[0]!.folded).toBe(true);
    expect(f.outputs[0]!.sats).toBe(1_499_999_000n);
    expect(f.selfTransfer).toBe(true);
  });

  it('orders recipients by amount and puts change last', () => {
    const f = buildFlow(
      tx({
        inputs: [inp('t1A', '100.00000000')],
        outputs: [out(0, 't1A', '60.00000000'), out(1, 't1X', '10.00000000'), out(2, 't1Y', '30.00000000')],
        value_in: '100.00000000',
        value_out: '100.00000000',
      }),
    );
    expect(f.outputs.map((c) => c.address)).toEqual(['t1Y', 't1X', 't1A']);
    expect(f.outputs.at(-1)!.role).toBe('change');
  });
});

describe('buildFlow: app messages', () => {
  it('shows the OP_RETURN as data, not as a band', () => {
    const f = buildFlow(
      tx({
        kind: 'app_message',
        inputs: [inp('t1Owner', '3472.56000000', 1)],
        outputs: [
          out(0, 't3AppFee', '25.91000000', { script_type: 'scripthash' }),
          out(1, 't1Owner', '3446.65000000'),
          out(2, null, '0.00000000', { script_type: '', op_return: 'f1601ad786e808e1' }),
        ],
        value_in: '3472.56000000',
        value_out: '3472.56000000',
        fee: '0.00000000',
      }),
    );
    expect(f.outputs.map((c) => c.role)).toEqual(['recipient', 'change']);
    expect(f.data).toEqual([{ id: 'data:2', n: 2, text: 'f1601ad786e808e1' }]);
    expect(f.outputs.some((c) => c.indices.includes(2))).toBe(false);
  });
});

describe('buildFlow: coinbase', () => {
  const coinbase = tx({
    kind: 'coinbase',
    height: 2_997_608,
    inputs: [{ coinbase: true, prev_txid: null, prev_vout: null, address: null, value: null }],
    outputs: [
      out(0, 't3hPu1YDeGUCp8m7BQCnnNUmRMJBa5RadyA', '0.50000000', { script_type: 'scripthash' }),
      out(1, 't1Cum', '1.00000000'),
      out(2, 't1Nim', '3.50000000'),
      out(3, 't1Str', '9.00000000'),
    ],
    value_in: null,
    value_out: '14.00000000',
    fee: null,
  });

  it('classifies the four outputs by amount, largest first', () => {
    const f = buildFlow(coinbase);
    expect(f.coinbase).toBe(true);
    expect(f.outputs.map((c) => [c.role, c.tier ?? null])).toEqual([
      ['tier', 'stratus'],
      ['tier', 'nimbus'],
      ['tier', 'cumulus'],
      ['devfund', null],
    ]);
    expect(f.inputs).toHaveLength(1);
    expect(f.inputs[0]!.role).toBe('coinbase');
    expect(f.inputs[0]!.sats).toBe(1_400_000_000n);
  });

  it('is indifferent to the output order', () => {
    const shuffled = tx({ ...coinbase, outputs: [...coinbase.outputs].reverse() });
    const f = buildFlow(shuffled);
    expect(f.outputs.map((c) => c.tier ?? c.role)).toEqual(['stratus', 'nimbus', 'cumulus', 'devfund']);
  });

  it('keeps a dev fund that includes fees', () => {
    const withFees = tx({
      ...coinbase,
      outputs: [
        out(0, 't3hPu1YDeGUCp8m7BQCnnNUmRMJBa5RadyA', '0.50000300', { script_type: 'scripthash' }),
        ...coinbase.outputs.slice(1),
      ],
    });
    const f = buildFlow(withFees);
    expect(f.outputs.at(-1)!.role).toBe('devfund');
  });
});

describe('buildFlow: no value flow and unknowns', () => {
  it('has no cards for a node transaction', () => {
    const f = buildFlow(tx({ kind: 'node_confirm', height: 2_997_608 }));
    expect(f.inputs).toHaveLength(0);
    expect(f.outputs).toHaveLength(0);
    expect(f.bands).toHaveLength(0);
  });

  it('draws one unknown card when the inputs carry no values', () => {
    const f = buildFlow(
      tx({
        inputs: [inp(null, null), inp(null, null, 2)],
        outputs: [out(0, 't1X', '5.00000000')],
        value_in: null,
        value_out: '5.00000000',
      }),
    );
    expect(f.inputsUnknown).toBe(true);
    expect(f.inputs).toHaveLength(1);
    expect(f.inputs[0]!.role).toBe('unknown');
    expect(f.inputs[0]!.sats).toBeNull();
    expect(f.bands).toHaveLength(1);
  });
});

describe('buildFlow: folding', () => {
  it('folds inputs beyond the cap into one card with the sum', () => {
    const inputs = Array.from({ length: 10 }, (_, i) => inp(`t1In${i}`, `${10 - i}.00000000`, i));
    const f = buildFlow(
      tx({
        inputs,
        outputs: [out(0, 't1X', '55.00000000')],
        value_in: '55.00000000',
        value_out: '55.00000000',
      }),
      { maxInputs: 4 },
    );
    expect(f.inputs).toHaveLength(4);
    const more = f.inputs.at(-1)!;
    expect(more.folded).toBe(true);
    expect(more.indices).toHaveLength(7);
    // 10 + 9 + 8 are shown; the rest (7+6+5+4+3+2+1) fold.
    expect(more.sats).toBe(2_800_000_000n);
  });

  it('folds the tail of the outputs but keeps the change card', () => {
    const outputs = [
      ...Array.from({ length: 10 }, (_, i) => out(i, `t1R${i}`, `${(10 - i) / 10}.00000000`)),
      out(10, 't1In', '0.50000000'),
    ];
    const f = buildFlow(
      tx({ inputs: [inp('t1In', '100.00000000')], outputs, value_in: '100.00000000', value_out: '5.0' }),
      {
        maxOutputs: 5,
      },
    );
    expect(f.outputs).toHaveLength(6);
    expect(f.outputs.some((c) => c.role === 'change')).toBe(true);
    expect(f.outputs.some((c) => c.id === 'out:more')).toBe(true);
  });
});

describe('thicknesses', () => {
  it('splits a budget in proportion to the weights', () => {
    const t = thicknesses([1, 3], 100, 7);
    expect(t[0]! + t[1]!).toBeCloseTo(100, 6);
    expect(t[1]! / t[0]!).toBeCloseTo(3, 6);
  });

  it('pins tiny weights to the minimum and conserves the budget', () => {
    const t = thicknesses([1000, 1, 1], 120, 7);
    expect(t[1]).toBe(7);
    expect(t[2]).toBe(7);
    expect(t[0]! + t[1]! + t[2]!).toBeCloseTo(120, 6);
  });

  it('falls back to the minimum when the budget cannot hold the floors', () => {
    expect(thicknesses([1, 1, 1], 10, 7)).toEqual([7, 7, 7]);
    expect(thicknesses([], 100, 7)).toEqual([]);
    expect(thicknesses([0, 0], 100, 7)).toEqual([7, 7]);
  });
});

describe('layoutFlow', () => {
  const model = buildFlow(
    tx({
      inputs: [inp('t1A', '100.00000000'), inp('t1B', '50.00000000')],
      outputs: [out(0, 't1X', '90.00000000'), out(1, 't1A', '59.99900000')],
      value_in: '150.00000000',
      value_out: '149.99900000',
      fee: '0.00100000',
    }),
  );

  it('places every card and one ribbon per band', () => {
    const l = layoutFlow(model, { width: 640 });
    expect(l.inputs).toHaveLength(2);
    expect(l.outputs).toHaveLength(2);
    expect(l.ribbons).toHaveLength(model.bands.length);
    expect(l.x0).toBeLessThan(l.x1);
    for (const p of [...l.inputs, ...l.outputs]) {
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y + p.h).toBeLessThanOrEqual(l.height + 0.001);
      expect(p.slotY).toBeGreaterThanOrEqual(p.y);
      expect(p.slotY + p.slotH).toBeLessThanOrEqual(p.y + p.h + 0.001);
    }
  });

  it('keeps each ribbon inside its slots and fills the slots exactly', () => {
    const l = layoutFlow(model, { width: 640 });
    for (const p of l.inputs) {
      const mine = l.ribbons.filter((r) => r.from === p.card.id);
      expect(mine.reduce((s, r) => s + r.h0, 0)).toBeCloseTo(p.slotH, 6);
      for (const r of mine) {
        expect(r.y0).toBeGreaterThanOrEqual(p.slotY - 0.001);
        expect(r.y0 + r.h0).toBeLessThanOrEqual(p.slotY + p.slotH + 0.001);
      }
    }
    for (const p of l.outputs) {
      const mine = l.ribbons.filter((r) => r.to === p.card.id);
      expect(mine.reduce((s, r) => s + r.h1, 0)).toBeCloseTo(p.slotH, 6);
    }
  });

  it('gives a smaller output a thinner slot, never under the minimum', () => {
    const tiny = buildFlow(
      tx({
        inputs: [inp('t1A', '100000.00000000')],
        outputs: [out(0, 't1X', '99999.99900000'), out(1, 't1Y', '0.00100000')],
        value_in: '100000.00000000',
        value_out: '100000.00000000',
      }),
    );
    const l = layoutFlow(tiny, { width: 640, minBand: 7 });
    expect(l.outputs[1]!.slotH).toBe(7);
    expect(l.outputs[0]!.slotH).toBeGreaterThan(l.outputs[1]!.slotH);
  });

  it('writes a closed SVG path for a ribbon', () => {
    const l = layoutFlow(model, { width: 640 });
    const d = ribbonPath(l.ribbons[0]!, l.x0, l.x1);
    expect(d.startsWith('M ')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d).not.toContain('NaN');
  });

  it('handles an empty flow', () => {
    const l = layoutFlow(buildFlow(tx({ kind: 'node_confirm' })), { width: 500 });
    expect(l.ribbons).toHaveLength(0);
    expect(Number.isFinite(l.height)).toBe(true);
  });
});
