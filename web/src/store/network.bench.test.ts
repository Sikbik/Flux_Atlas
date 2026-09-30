// Performance budgets (brief F1a): applying a block with ~20 child events < 1 ms; a 6.7k-node
// reconcile delta < 5 ms. Medians over repeated runs on a mainnet-sized table.
import { describe, expect, it } from 'vitest';
import type { NodeChange } from '../api/generated/NodeChange';
import { blockMsg, bootstrap, live, syntheticNodesBin } from '../testing/fixtures';
import { NetworkStore } from './network';

const N = 6_724;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function fresh(): NetworkStore {
  const s = new NetworkStore();
  s.loadSnapshot({ bootstrap: bootstrap(100), nodes: syntheticNodesBin(N, 100) });
  // A subscriber, as the globe and React would have.
  s.subscribe(() => {});
  return s;
}

describe('NetworkStore performance', () => {
  it('applies a block with 20 child events in under 1 ms', () => {
    const s = fresh();
    const times: number[] = [];
    let seq = 101;
    for (let k = 0; k < 300; k++) {
      const h = 2_996_915 + k;
      const heartbeats = Array.from({ length: 15 }, (_, j) => (k * 37 + j * 101) % N);
      const confirms = [(k * 13) % N, (k * 17 + 5) % N];
      const msg = live(
        'block',
        seq++,
        blockMsg(h, { heartbeats, confirms, producer: k % N, payees: [k % N, (k + 1) % N, (k + 2) % N] }),
      );
      const t0 = performance.now();
      s.apply(msg);
      times.push(performance.now() - t0);
    }
    const m = median(times.slice(50));
    // biome-ignore lint/suspicious/noConsole: benchmark output
    console.log(`[bench] block apply (20 child events, ${N} nodes): median ${(m * 1000).toFixed(1)} us`);
    expect(m).toBeLessThan(1);
  });

  it('applies a 6.7k-node reconcile delta in under 5 ms', () => {
    const s = fresh();
    const times: number[] = [];
    let prev = 0;
    for (let k = 0; k < 30; k++) {
      const changed: NodeChange[] = [];
      for (let i = 0; i < N; i++) changed.push({ id: i, rank: (i + k) % N, last_paid_height: 2_996_000 + k });
      const seq = 101 + k;
      const msg = live('nodes', seq, { prev_seq: prev, added: [], removed: [], changed, cause: 'reconcile' });
      prev = seq;
      const t0 = performance.now();
      s.apply(msg);
      times.push(performance.now() - t0);
    }
    const m = median(times.slice(5));
    // biome-ignore lint/suspicious/noConsole: benchmark output
    console.log(`[bench] reconcile delta (${N} changed): median ${m.toFixed(2)} ms`);
    expect(m).toBeLessThan(5);
  });

  it('decodes and loads a mainnet-sized snapshot quickly', () => {
    const times: number[] = [];
    for (let k = 0; k < 10; k++) {
      const bin = syntheticNodesBin(N, 100);
      const s = new NetworkStore();
      const t0 = performance.now();
      s.loadSnapshot({ bootstrap: bootstrap(100), nodes: bin });
      times.push(performance.now() - t0);
    }
    const m = median(times);
    // biome-ignore lint/suspicious/noConsole: benchmark output
    console.log(`[bench] snapshot load (${N} nodes): median ${m.toFixed(2)} ms`);
    expect(m).toBeLessThan(20);
  });
});
