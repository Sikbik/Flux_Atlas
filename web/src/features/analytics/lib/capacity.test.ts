import { describe, expect, it } from 'vitest';
import type { CapacityDto } from '../../../api/generated/CapacityDto';
import { capacityRows, formatCapacity } from './capacity';

const t = (nodes: number, cores: number, ram_gb: number, ssd_gb: number) => ({
  nodes,
  cores,
  ram_gb,
  ssd_gb,
  down_mbps: 0,
  up_mbps: 0,
});

const dto: CapacityDto = {
  total: t(10, 100, 1000, 20_000),
  by_tier: [
    { tier: 'cumulus', totals: t(6, 20, 200, 8_000) },
    { tier: 'nimbus', totals: t(2, 30, 300, 6_000) },
    { tier: 'stratus', totals: t(2, 50, 500, 6_000) },
  ],
  apps_requested: { cpu: 15, ram_mb: 204_800, hdd_gb: 2_000 },
  apps_locked: { cpu: 10, ram_mb: 102_400, hdd_gb: 1_000 },
};

describe('capacityRows', () => {
  const rows = capacityRows(dto);
  it('keeps cores, memory and storage in their own units', () => {
    expect(rows.map((r) => r.key)).toEqual(['cpu', 'ram', 'ssd']);
    expect(rows[0]!.total).toBe(100);
    expect(rows[1]!.total).toBe(1000);
    expect(rows[2]!.total).toBe(20_000);
  });
  it('turns app memory from MB into GB before comparing', () => {
    expect(rows[1]!.locked).toBe(100);
    expect(rows[1]!.requested).toBe(200);
    expect(rows[1]!.lockedShare).toBeCloseTo(0.1);
    expect(rows[1]!.requestedShare).toBeCloseTo(0.2);
  });
  it('splits each total by tier, base tier first, shares summing to one', () => {
    for (const r of rows) {
      expect(r.tiers.map((x) => x.tier)).toEqual(['cumulus', 'nimbus', 'stratus']);
      expect(r.tiers.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1);
    }
    expect(rows[0]!.tiers[2]!.share).toBeCloseTo(0.5);
  });
  it('reads a missing tier as zero and an empty network as zero shares', () => {
    const empty = capacityRows({ ...dto, total: t(0, 0, 0, 0), by_tier: [] });
    expect(empty[0]!.lockedShare).toBe(0);
    expect(empty[0]!.tiers.every((x) => x.value === 0 && x.share === 0)).toBe(true);
  });
});

describe('formatCapacity', () => {
  it('names the unit: two decimals for PB, one for TB, none for GB', () => {
    expect(formatCapacity('cpu', 55_033)).toBe('55,033 cores');
    expect(formatCapacity('ram', 183_622.9)).toBe('183.6 TB');
    expect(formatCapacity('ram', 25_503.9)).toBe('25.5 TB');
    expect(formatCapacity('ssd', 3_230_683)).toBe('3.23 PB');
    expect(formatCapacity('ssd', 640)).toBe('640 GB');
  });
});
