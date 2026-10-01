// Capacity: what the nodes offer and what apps use of it, per resource, in one unit each (cores, and GB
// for memory and disk, shown as TB or PB when large). Apps report CPU in cores, memory in MB and disk
// in GB; `locked` is what running apps hold, `requested` what the public specs ask for.

import type { CapacityDto } from '../../../api/generated/CapacityDto';

export type Resource = 'cpu' | 'ram' | 'ssd';
export type CapTier = 'cumulus' | 'nimbus' | 'stratus';

export interface TierPart {
  tier: CapTier;
  value: number;
  /** Fraction of the resource's total, 0..1. */
  share: number;
}

export interface ResourceRow {
  key: Resource;
  label: string;
  /** Total capacity in the resource's unit (cores, or GB). */
  total: number;
  locked: number;
  requested: number;
  /** Fractions of the total, 0..1. */
  lockedShare: number;
  requestedShare: number;
  tiers: TierPart[];
}

const TIER_ORDER: readonly CapTier[] = ['cumulus', 'nimbus', 'stratus'];

const frac = (part: number, total: number): number => (total > 0 ? part / total : 0);

export function capacityRows(c: CapacityDto): ResourceRow[] {
  const byTier = (pick: (t: CapacityDto['total']) => number): TierPart[] => {
    const total = pick(c.total);
    return TIER_ORDER.map((tier) => {
      const value = pick(c.by_tier.find((t) => t.tier === tier)?.totals ?? emptyTotals);
      return { tier, value, share: frac(value, total) };
    });
  };
  const row = (
    key: Resource,
    label: string,
    pick: (t: CapacityDto['total']) => number,
    locked: number,
    requested: number,
  ): ResourceRow => {
    const total = pick(c.total);
    return {
      key,
      label,
      total,
      locked,
      requested,
      lockedShare: frac(locked, total),
      requestedShare: frac(requested, total),
      tiers: byTier(pick),
    };
  };
  return [
    row('cpu', 'CPU', (t) => t.cores, c.apps_locked.cpu, c.apps_requested.cpu),
    row('ram', 'Memory', (t) => t.ram_gb, c.apps_locked.ram_mb / 1024, c.apps_requested.ram_mb / 1024),
    row('ssd', 'Storage', (t) => t.ssd_gb, c.apps_locked.hdd_gb, c.apps_requested.hdd_gb),
  ];
}

const emptyTotals = { nodes: 0, cores: 0, ram_gb: 0, ssd_gb: 0, down_mbps: 0, up_mbps: 0 };

/** `55,033 cores`, `183.6 TB`, `3.23 PB`: decimal units, two decimals for PB, one for TB, none for GB. */
export function formatCapacity(key: Resource, value: number): string {
  if (key === 'cpu') return `${new Intl.NumberFormat('en-US').format(Math.round(value))} cores`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)} PB`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)} TB`;
  return `${Math.round(value)} GB`;
}
