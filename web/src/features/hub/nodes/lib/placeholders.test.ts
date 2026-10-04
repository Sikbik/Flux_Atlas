import { describe, expect, it } from 'vitest';
import { NEWEST_SHOWN } from './newest';
import { OPERATORS_SHOWN } from './operators';
import {
  GHOST_AGE,
  GHOST_CHURN,
  GHOST_DECENTRAL,
  GHOST_DIST,
  GHOST_HEALTH,
  GHOST_QUEUE,
  ghostBench,
  ghostNewest,
  ghostOperators,
} from './placeholders';
import { TIER_KEYS } from './tiers';

// The loading states draw the real markup with these rows, so what matters is that they have every part the real rows
// have (a part missing here is a part that would make the loaded panel taller than its skeleton).
describe('placeholders', () => {
  it('has as many operators as the leaderboard shows, each with the cells and the wallet link of a real row', () => {
    const rows = ghostOperators();
    expect(rows).toHaveLength(OPERATORS_SHOWN);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    for (const r of rows) {
      expect(r.topCountry).not.toBeNull();
      expect(r.topProvider).not.toBeNull();
      expect(r.since).not.toBeNull();
      expect(r.walletAddress).not.toBeNull();
      expect(r.problems.length).toBeGreaterThan(0);
      expect(r.tiers.map((t) => t.tier)).toEqual([...TIER_KEYS]);
    }
  });

  it('has as many newest nodes as the list shows, each with a place and a provider', () => {
    const rows = ghostNewest();
    expect(rows).toHaveLength(NEWEST_SHOWN);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    expect(rows.every((r) => r.country && r.provider)).toBe(true);
  });

  it('draws a benchmark chart with every tier and a minimum for each', () => {
    const model = ghostBench();
    expect(model).not.toBeNull();
    expect(model?.rows.map((r) => r.tier)).toEqual([...TIER_KEYS]);
    expect(model?.rows.every((r) => r.xMin !== null)).toBe(true);
    expect(model?.reading).not.toBe('');
  });

  it('has the three tiers of the queue, each with a next payee', () => {
    expect(GHOST_QUEUE.map((r) => r.tier)).toEqual([...TIER_KEYS]);
    expect(GHOST_QUEUE.every((r) => r.next !== null && r.payout !== null && r.cycleText !== null)).toBe(true);
  });

  it('has a joined-and-left table with a window that is only a floor, so the note is drawn', () => {
    expect(GHOST_CHURN.map((r) => r.window)).toEqual(['24h', '7d']);
    expect(GHOST_CHURN.some((r) => !r.complete && r.note)).toBe(true);
  });

  it('has a health strip whose parts add up to the nodes', () => {
    expect(GHOST_HEALTH.parts.reduce((s, p) => s + p.count, 0)).toBe(GHOST_HEALTH.total);
    expect(GHOST_HEALTH.items).toHaveLength(3);
  });

  it('has the six age buckets and the unknown column', () => {
    expect(GHOST_AGE.bars).toHaveLength(7);
    expect(GHOST_AGE.bars.filter((b) => b.unknown)).toHaveLength(1);
    expect(GHOST_AGE.bars.reduce((s, b) => s + b.count, 0)).toBe(GHOST_AGE.total);
  });

  it('has the three Nakamoto figures, two gauges and a reading', () => {
    expect(GHOST_DECENTRAL.nakamoto).toHaveLength(3);
    expect(GHOST_DECENTRAL.hhi).toHaveLength(2);
    expect(GHOST_DECENTRAL.reading).not.toBe('');
  });

  it('has six bars and a sentence for a distribution', () => {
    expect(GHOST_DIST.rows).toHaveLength(6);
    expect(GHOST_DIST.reading).not.toBe('');
  });
});
