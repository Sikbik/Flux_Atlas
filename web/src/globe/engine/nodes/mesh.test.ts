import { describe, expect, it } from 'vitest';
import { MeshStore } from './mesh';
import type { NodeStore } from './store';

const UNRESOLVED = 0xffffffff;

/** Only `idToSlot` is read by `resolve`. */
function nodesWith(entries: [id: number, slot: number][]): NodeStore {
  return { idToSlot: new Map(entries), high: entries.length } as unknown as NodeStore;
}

describe('MeshStore.resolve', () => {
  it('resolves every edge on the first pass', () => {
    const m = new MeshStore();
    const ab = m.add(1, 2);
    const bc = m.add(2, 3);
    m.resolve(
      nodesWith([
        [1, 10],
        [2, 20],
        [3, 30],
      ]),
    );
    expect([m.sa[ab], m.sb[ab], m.sa[bc], m.sb[bc]]).toEqual([10, 20, 20, 30]);
  });

  it('resolves a streamed edge alone, without a pass over the rest', () => {
    const m = new MeshStore();
    const ab = m.add(1, 2);
    m.resolve(
      nodesWith([
        [1, 10],
        [2, 20],
      ]),
    );
    // The slots move but nothing marks the store dirty: the old edge keeps its slots, so a resolve that
    // touched it would show. Only the new edge is looked up.
    const cd = m.add(3, 4);
    m.resolve(
      nodesWith([
        [1, 11],
        [2, 21],
        [3, 30],
        [4, 40],
      ]),
    );
    expect([m.sa[ab], m.sb[ab]]).toEqual([10, 20]);
    expect([m.sa[cd], m.sb[cd]]).toEqual([30, 40]);
  });

  it('still resolves everything when the node slots change', () => {
    const m = new MeshStore();
    const ab = m.add(1, 2);
    m.resolve(
      nodesWith([
        [1, 10],
        [2, 20],
      ]),
    );
    m.resolveDirty = true;
    m.resolve(
      nodesWith([
        [1, 11],
        [2, 21],
      ]),
    );
    expect([m.sa[ab], m.sb[ab]]).toEqual([11, 21]);
  });

  it('marks an endpoint that is not loaded yet as unresolved', () => {
    const m = new MeshStore();
    m.resolve(nodesWith([]));
    const e = m.add(5, 6);
    m.resolve(nodesWith([[5, 50]]));
    expect([m.sa[e], m.sb[e]]).toEqual([50, UNRESOLVED]);
  });

  it('resolves a reused edge index for its new endpoints', () => {
    const m = new MeshStore();
    const ab = m.add(1, 2);
    m.resolve(
      nodesWith([
        [1, 10],
        [2, 20],
      ]),
    );
    m.remove(1, 2);
    const cd = m.add(3, 4);
    expect(cd).toBe(ab);
    m.resolve(
      nodesWith([
        [1, 10],
        [2, 20],
        [3, 30],
        [4, 40],
      ]),
    );
    expect([m.sa[cd], m.sb[cd]]).toEqual([30, 40]);
  });

  it('falls back to one full pass when a burst outgrows the pending list', () => {
    const m = new MeshStore();
    m.resolve(nodesWith([]));
    const ids: [number, number][] = [];
    for (let i = 1; i <= 10_002; i++) ids.push([i, i * 2]);
    for (let i = 1; i < 10_002; i += 2) m.add(i, i + 1);
    expect(m.resolveDirty).toBe(true);
    m.resolve(nodesWith(ids));
    expect(m.resolveDirty).toBe(false);
    const last = m.find(10_001, 10_002);
    expect([m.sa[last], m.sb[last]]).toEqual([20_002, 20_004]);
  });
});
