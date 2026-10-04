// The made-up numbers of the loading states have the shape of the live network, because a loading part is as tall as it
// is only if its rows are as many and its lines as long as the real ones. These checks hold that shape.

import { describe, expect, it } from 'vitest';
import { railRows } from './capacity';
import { DAY_MS, deploySeries } from './deploy';
import { heroCaption } from './hero';
import {
  GHOST_ENTERPRISE_APPS,
  GHOST_HEADLINE,
  GHOST_RESOURCES,
  GHOST_TOTALS,
  ghostCountries,
  ghostDeployDays,
  ghostDeployTotals,
  ghostEconomy,
  ghostExpiringRows,
  ghostNewRows,
  ghostOwners,
  ghostRanked,
} from './placeholders';

const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);

describe('the made-up rails', () => {
  it('read as a small known share of a known network, never as Unknown', () => {
    const rows = railRows(GHOST_RESOURCES);
    expect(rows.map((r) => r.key)).toEqual(['cpu', 'ram', 'ssd']);
    for (const r of rows) {
      expect(r.share).not.toBeNull();
      expect(r.share as number).toBeGreaterThan(0);
      expect(r.share as number).toBeLessThan(0.2);
      expect(r.percent).not.toBe('Unknown');
    }
  });
});

describe('the made-up sentence of the hero', () => {
  it('is the long form, with the share of enterprise apps, so it takes the lines the real one takes', () => {
    const text = heroCaption(GHOST_TOTALS, GHOST_ENTERPRISE_APPS);
    expect(text).toContain('instances are running across');
    expect(text).toMatch(/Enterprise apps are \d+% of all apps and keep their size private\.$/);
  });
});

describe('the made-up owners', () => {
  it('are ten with their own ids, two in five of them with enterprise apps, as on the network', () => {
    const rows = ghostOwners(10);
    expect(rows).toHaveLength(10);
    expect(new Set(rows.map((r) => r.owner)).size).toBe(10);
    expect(rows.filter((r) => (r.enterpriseApps ?? 0) > 0)).toHaveLength(4);
    // Ranked: the most instances first, and every cell a figure (a floor for an owner with enterprise apps).
    expect(rows.map((r) => r.instances)).toEqual([...rows.map((r) => r.instances)].sort((a, b) => b - a));
    for (const r of rows) {
      expect(r.cores.kind).toBe((r.enterpriseApps ?? 0) > 0 ? 'atLeast' : 'exact');
      expect(r.share).not.toBeNull();
    }
  });
});

describe('the made-up countries', () => {
  it('are more than a panel shows at first, ranked, each with its own id', () => {
    const rows = ghostCountries(24);
    expect(rows).toHaveLength(24);
    expect(new Set(rows.map((r) => r.id)).size).toBe(24);
    expect(rows.map((r) => r.value)).toEqual([...rows.map((r) => r.value)].sort((a, b) => b - a));
    expect(GHOST_HEADLINE).toContain('together host');
  });
});

describe('the made-up deployments', () => {
  it('are ninety consecutive UTC days ending today, so the chart has the legend of a running day', () => {
    const days = ghostDeployDays(NOW);
    expect(days).toHaveLength(90);
    for (let i = 1; i < days.length; i++) {
      expect((days[i]?.day_ms as number) - (days[i - 1]?.day_ms as number)).toBe(DAY_MS);
    }
    expect(days[89]?.day_ms).toBe(Date.UTC(2026, 9, 4));
    expect(deploySeries(days, NOW).running).toBe(true);
    const totals = ghostDeployTotals(NOW);
    expect(totals.days).toBe(90);
    expect(totals.busiest).not.toBeNull();
  });
});

describe('the made-up economy', () => {
  it('is complete: every window is a figure, so none of the rows is the word Unknown', () => {
    const g = ghostEconomy(NOW);
    expect(g.complete).toBe(true);
    for (const v of [
      g.paid24h,
      g.paid7d,
      g.paid30d,
      g.paidAllTime,
      g.registrations30d,
      g.updates30d,
      g.change,
    ]) {
      expect(v).not.toBeNull();
    }
    expect(g.daily.length).toBeGreaterThanOrEqual(2);
    expect(g.dailyFromMs).not.toBeNull();
  });
});

describe('the made-up lists', () => {
  it('are ten rows each, the expiring ones with the exact count of blocks and none of them within the hour', () => {
    const fresh = ghostNewRows(10);
    const going = ghostExpiringRows(10);
    expect(fresh).toHaveLength(10);
    expect(going).toHaveLength(10);
    expect(new Set(fresh.map((r) => r.name)).size).toBe(10);
    for (const r of going) {
      expect(r.blocks).toContain('blocks left');
      expect(r.soon).toBe(false);
    }
  });

  it('have the ranked apps beside the picture: ten, each with its own name and a size not hidden', () => {
    const rows = ghostRanked(10);
    expect(rows).toHaveLength(10);
    expect(new Set(rows.map((r) => r.name)).size).toBe(10);
    expect(rows.some((r) => r.enterprise)).toBe(false);
  });
});
