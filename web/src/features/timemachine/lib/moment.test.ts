import { describe, expect, it } from 'vitest';
import { buildCurve } from './curve';
import { momentAt } from './moment';
import type { ArchiveInfo } from './summary';

const M = 60_000;
const T0 = 1_790_816_000_000;
const ts = (n: number) => Array.from({ length: n }, (_, i) => T0 + i * M);
const curve = buildCurve({ t: ts(5), nodes: [100, 101, null, 103, 104], tip: [10, 11, 12, 13, null] })!;

const info = (nodes: number | null): ArchiveInfo => ({
  t: T0,
  rows: 120,
  nodes,
  tiers: { cumulus: 1, nimbus: 2, stratus: 3 },
  located: 100,
  recorded: [],
  missing: [],
});

describe('the moment the archive shows', () => {
  it('reads the tip and the node count from the recorded history at the playhead', () => {
    expect(momentAt(T0 + M + 5000, curve, null)).toEqual({ at: T0 + M + 5000, tip: 11, nodes: 101 });
  });

  it('takes the node count from the moment the globe shows once it has arrived', () => {
    expect(momentAt(T0 + M, curve, info(6512)).nodes).toBe(6512);
  });

  it('falls back to the history when the moment did not record a count', () => {
    expect(momentAt(T0 + M, curve, info(null)).nodes).toBe(101);
  });

  it('leaves the readings unknown, never zero, where nothing is held', () => {
    expect(momentAt(T0 - 1, curve, null)).toEqual({ at: T0 - 1, tip: null, nodes: null });
    const noTips = buildCurve({ t: ts(3), nodes: [1, 2, 3], tip: [null, null, null] })!;
    expect(momentAt(T0 + M, noTips, null)).toEqual({ at: T0 + M, tip: null, nodes: 2 });
    expect(momentAt(T0, null, null)).toEqual({ at: T0, tip: null, nodes: null });
  });

  it('rounds the instant to whole milliseconds', () => {
    expect(momentAt(T0 + 0.6, null, null).at).toBe(T0 + 1);
  });
});
