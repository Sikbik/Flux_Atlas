import { describe, expect, it } from 'vitest';
import { AlertDeduper, diffWatch, type WatchSnapshot } from './watch';

const snap = (over: Partial<WatchSnapshot> = {}): WatchSnapshot => ({
  tip: 1_000,
  present: true,
  status: 'confirmed',
  reachable: true,
  lastPaid: 100,
  lastConfirmed: 900,
  endpoint: '1.1.1.1:16127',
  ...over,
});

describe('diffWatch', () => {
  it('raises nothing on the first look or when nothing moved', () => {
    expect(diffWatch(1, null, snap())).toEqual([]);
    expect(diffWatch(1, snap(), snap())).toEqual([]);
  });

  it('raises offline once when the node becomes unreachable', () => {
    expect(diffWatch(1, snap(), snap({ reachable: false }))).toEqual([
      { kind: 'offline', id: 1, detail: null },
    ]);
    expect(diffWatch(1, snap({ reachable: false }), snap({ reachable: false }))).toEqual([]);
    expect(diffWatch(1, snap({ reachable: null }), snap({ reachable: false }))).toHaveLength(1);
    expect(diffWatch(1, snap({ reachable: false }), snap({ reachable: true }))).toEqual([]);
  });

  it('raises at risk when the check-in age crosses 560, and expired at 640', () => {
    // Tip moves from 1,459 to 1,460 with the last check-in at 900: 559 then 560 blocks.
    expect(diffWatch(1, snap({ tip: 1_459 }), snap({ tip: 1_460 }))).toEqual([
      { kind: 'at_risk', id: 1, detail: 560 },
    ]);
    expect(diffWatch(1, snap({ tip: 1_458 }), snap({ tip: 1_459 }))).toEqual([]);
    expect(diffWatch(1, snap({ tip: 1_539 }), snap({ tip: 1_540 }))).toEqual([
      { kind: 'expired', id: 1, detail: 640 },
    ]);
    // Already past the line: no repeat.
    expect(diffWatch(1, snap({ tip: 1_470 }), snap({ tip: 1_471 }))).toEqual([]);
  });

  it('knows prev and next ages separately: a check-in that arrives clears the risk without an alert', () => {
    expect(
      diffWatch(1, snap({ tip: 1_459, lastConfirmed: 900 }), snap({ tip: 1_460, lastConfirmed: 1_450 })),
    ).toEqual([]);
  });

  it('does not raise at-risk without a known check-in', () => {
    expect(
      diffWatch(1, snap({ tip: 1_459, lastConfirmed: 0 }), snap({ tip: 1_460, lastConfirmed: 0 })),
    ).toEqual([]);
  });

  it('raises paid when the last payment height moves up', () => {
    expect(diffWatch(1, snap(), snap({ lastPaid: 1_000 }))).toEqual([{ kind: 'paid', id: 1, detail: 1_000 }]);
    expect(diffWatch(1, snap({ lastPaid: 0 }), snap({ lastPaid: 1_000 }))).toEqual([]);
  });

  it('raises ip_changed with the new endpoint', () => {
    expect(diffWatch(1, snap(), snap({ endpoint: '2.2.2.2:16127' }))).toEqual([
      { kind: 'ip_changed', id: 1, detail: '2.2.2.2:16127' },
    ]);
    expect(diffWatch(1, snap({ endpoint: '' }), snap({ endpoint: '2.2.2.2:16127' }))).toEqual([]);
  });

  it('raises expired when the node leaves the table or its status says so, and nothing else', () => {
    expect(diffWatch(1, snap(), snap({ present: false, reachable: false }))).toEqual([
      { kind: 'expired', id: 1, detail: null },
    ]);
    expect(diffWatch(1, snap(), snap({ status: 'expired' }))).toEqual([
      { kind: 'expired', id: 1, detail: null },
    ]);
    expect(diffWatch(1, snap({ status: 'expired' }), snap({ status: 'expired' }))).toEqual([]);
  });

  it('can raise several alerts for one move', () => {
    const e = diffWatch(1, snap(), snap({ reachable: false, lastPaid: 1_000, endpoint: '3.3.3.3:16127' }));
    expect(e.map((x) => x.kind).sort()).toEqual(['ip_changed', 'offline', 'paid']);
  });
});

describe('AlertDeduper', () => {
  it('merges the same alert for the same node inside the window only', () => {
    const d = new AlertDeduper(10_000);
    const a = { kind: 'offline', id: 1, detail: null } as const;
    expect(d.accept(a, 0)).toBe(true);
    expect(d.accept(a, 5_000)).toBe(false);
    expect(d.accept({ ...a, id: 2 }, 5_000)).toBe(true);
    expect(d.accept({ kind: 'paid', id: 1, detail: 1 }, 5_000)).toBe(true);
    expect(d.accept(a, 10_001)).toBe(true);
  });
});
