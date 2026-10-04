import { describe, expect, it } from 'vitest';
import type { NodeStatusCounts } from '../../../../api/generated/NodeStatusCounts';
import { healthModel } from './status';

const status = (over: Partial<NodeStatusCounts> = {}): NodeStatusCounts => ({
  healthy: 6400,
  at_risk: 30,
  unreachable: 220,
  dos: 3,
  expiring_soon: 30,
  confirmed: 6638,
  started: 5,
  ...over,
});

describe('healthModel', () => {
  it('cuts the confirmed nodes into parts that add up to all of them', () => {
    // 6638 - 6400 = 238 have a problem: 30 at risk + 220 unreachable overlap in 12 nodes.
    const m = healthModel(status());
    expect(m?.total).toBe(6638);
    expect(m?.overlap).toBe(12);
    const counts = Object.fromEntries((m?.parts ?? []).map((p) => [p.id, p.count]));
    expect(counts).toEqual({ healthy: 6400, 'at-risk': 30, unreachable: 208 });
    expect((m?.parts ?? []).reduce((s, p) => s + p.count, 0)).toBe(6638);
  });

  it('lists the whole of each set in the legend, overlap included', () => {
    const m = healthModel(status());
    const counts = Object.fromEntries((m?.items ?? []).map((p) => [p.id, p.count]));
    expect(counts).toEqual({ healthy: 6400, 'at-risk': 30, unreachable: 220 });
  });

  it('has no overlap when the problems are separate nodes', () => {
    const m = healthModel(status({ healthy: 6388, at_risk: 30, unreachable: 220 }));
    expect(m?.overlap).toBe(0);
    expect(m?.parts.find((p) => p.id === 'unreachable')?.count).toBe(220);
  });

  it('puts every problem node in the at-risk part when they are all both', () => {
    // 100 nodes have a problem, all 100 at risk and all 100 unreachable.
    const m = healthModel(status({ confirmed: 1000, healthy: 900, at_risk: 100, unreachable: 100 }));
    expect(m?.overlap).toBe(100);
    expect(m?.parts.map((p) => p.count)).toEqual([900, 100, 0]);
  });

  it('says it in words, naming the overlap only when there is one', () => {
    expect(healthModel(status())?.summary).toBe(
      'Health of 6,638 confirmed nodes: 6,400 healthy (96.4%); 30 at risk (0.5%); 220 unreachable (3.3%), 12 of them also at risk.',
    );
    expect(healthModel(status({ healthy: 6388 }))?.summary).not.toContain('also at risk');
  });

  it('is null with no confirmed nodes rather than a bar of nothing', () => {
    expect(healthModel(status({ confirmed: 0, healthy: 0, at_risk: 0, unreachable: 0 }))).toBeNull();
  });

  it('survives counts that do not add up', () => {
    const m = healthModel(status({ healthy: 7000 }));
    expect(m?.parts.every((p) => p.count >= 0 && p.share <= 1)).toBe(true);
  });
});
