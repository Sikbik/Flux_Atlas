import { describe, expect, it } from 'vitest';
import type { CapacityDto } from '../../../api/generated/CapacityDto';
import type { DataAttribution } from '../../../api/generated/DataAttribution';
import type { TierStats } from '../../../api/generated/TierStats';
import {
  capacityRows,
  creditLines,
  cycleLabel,
  devFundShare,
  legendRows,
  roughSpan,
  safeHref,
} from './model';

const tier = (t: TierStats['tier'], count: number, payout: string): TierStats => ({
  tier: t,
  count,
  collateral: '1000.00000000',
  payout,
  pa_payout: payout,
  cycle_blocks: count,
  next: null,
});

const TIERS: TierStats[] = [
  tier('cumulus', 3378, '1.00000000'),
  tier('nimbus', 1582, '3.50000000'),
  tier('stratus', 1764, '9.00000000'),
];

describe('cycleLabel', () => {
  it('turns a queue length into hours at 30 s a block', () => {
    expect(cycleLabel(1764)).toBe('14.7 h');
    expect(cycleLabel(1582)).toBe('13.2 h');
    expect(cycleLabel(3378)).toBe('28.2 h');
    expect(cycleLabel(2400)).toBe('20 h');
  });
});

describe('the legend', () => {
  it('lists the pieces largest first and ends with the development fund', () => {
    const rows = legendRows(TIERS, '14.00000000');
    expect(rows.map((r) => r.piece)).toEqual(['cap', 'big', 'small', 'bar']);
    expect(rows.map((r) => r.name)).toEqual(['Stratus', 'Nimbus', 'Cumulus', 'Dev fund']);
    expect(rows.map((r) => r.payout)).toEqual(['9.00 FLUX', '3.50 FLUX', '1.00 FLUX', '0.50 FLUX']);
    expect(rows[0]?.cycle).toBe('14.7 h cycle');
    expect(rows[3]?.cycle).toBe('every block');
  });

  it('never shows an unknown figure as zero', () => {
    const rows = legendRows([], null);
    expect(rows.every((r) => r.payout === null)).toBe(true);
    expect(rows[0]?.cycle).toBeNull();
    expect(rows[3]?.cycle).toBe('every block');
  });
});

describe('devFundShare', () => {
  it('is the reward left after the three tiers are paid', () => {
    expect(devFundShare('14.00000000', TIERS)).toBe(50_000_000n);
  });

  it('is unknown when the tiers are not all in or nothing is left', () => {
    expect(devFundShare('14.00000000', TIERS.slice(0, 2))).toBeNull();
    expect(devFundShare('13.50000000', TIERS)).toBeNull();
    expect(devFundShare(null, TIERS)).toBeNull();
  });
});

describe('roughSpan', () => {
  it('keeps two units and never speaks in seconds', () => {
    expect(roughSpan((25 * 24 + 18) * 3_600_000 + 17 * 60_000)).toBe('25 days 18 hours');
    expect(roughSpan(24 * 3_600_000)).toBe('1 day');
    expect(roughSpan(3 * 3_600_000 + 12 * 60_000)).toBe('3 hours 12 minutes');
    expect(roughSpan(2 * 3_600_000)).toBe('2 hours');
    expect(roughSpan(5_000)).toBe('1 minute');
    expect(roughSpan(-1)).toBe('1 minute');
  });
});

describe('capacityRows', () => {
  const cap: CapacityDto = {
    total: {
      nodes: 6640,
      cores: 55089,
      ram_gb: 183802.4,
      ssd_gb: 3234433.1,
      down_mbps: 1,
      up_mbps: 1,
    },
    by_tier: [],
    apps_requested: { cpu: 7410.287, ram_mb: 13451517, hdd_gb: 130113 },
    apps_locked: { cpu: 7146.988, ram_mb: 12940017, hdd_gb: 127293 },
  };

  it('reads totals and what apps hold, with the held share', () => {
    const rows = capacityRows(cap);
    expect(rows.map((r) => r.id)).toEqual(['cpu', 'ram', 'ssd']);
    expect(rows[0]?.total).toBe('55,089');
    expect(rows[0]?.locked).toBe('7,147');
    expect(rows[1]?.total).toBe('184 TB');
    expect(rows[1]?.locked).toBe('12.9 TB');
    expect(rows[2]?.total).toBe('3.23 PB');
    expect(rows[2]?.locked).toBe('127 TB');
    expect(rows[0]?.share).toBeCloseTo(0.13, 2);
    expect(rows[2]?.share).toBeCloseTo(0.039, 3);
  });

  it('keeps a share inside 0 to 1 even for odd data', () => {
    const odd = { ...cap, total: { ...cap.total, cores: 0 } };
    expect(capacityRows(odd)[0]?.share).toBe(0);
  });
});

const DBIP: DataAttribution = {
  name: 'DB-IP',
  text: 'IP Geolocation by DB-IP',
  url: 'https://db-ip.com',
  license: 'CC BY 4.0',
  license_url: 'https://creativecommons.org/licenses/by/4.0/',
  scope: 'City names and approximate node locations',
  version: '2026-09',
};

describe('data credits', () => {
  it('draws every attribution the server sends, verbatim, with its licence, scope and version', () => {
    const [c] = creditLines([DBIP]);
    expect(c).toMatchObject({
      text: 'IP Geolocation by DB-IP',
      href: 'https://db-ip.com/',
      license: 'CC BY 4.0',
      licenseHref: 'https://creativecommons.org/licenses/by/4.0/',
      scope: 'City names and approximate node locations',
      version: '2026-09',
    });
  });

  it('keeps the order sent and gives each line its own key', () => {
    const other: DataAttribution = {
      ...DBIP,
      name: 'Other',
      text: 'Other data',
      url: 'https://example.org/a',
    };
    const lines = creditLines([DBIP, other]);
    expect(lines.map((l) => l.text)).toEqual(['IP Geolocation by DB-IP', 'Other data']);
    expect(new Set(lines.map((l) => l.key)).size).toBe(2);
  });

  it('is empty when the server sends none, an older server sends no list, or a line has no text', () => {
    expect(creditLines([])).toEqual([]);
    expect(creditLines(undefined)).toEqual([]);
    expect(creditLines(null)).toEqual([]);
    expect(creditLines([{ ...DBIP, text: '  ' }])).toEqual([]);
  });

  it('leaves the version out when the server does not know it', () => {
    expect(creditLines([{ ...DBIP, version: null }])[0]?.version).toBeNull();
    expect(creditLines([{ ...DBIP, version: '  ' }])[0]?.version).toBeNull();
  });

  it('links web addresses only', () => {
    expect(safeHref('https://db-ip.com')).toBe('https://db-ip.com/');
    expect(safeHref('http://example.org/x')).toBe('http://example.org/x');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,hi')).toBeNull();
    expect(safeHref('not a url')).toBeNull();
    expect(safeHref('')).toBeNull();
    expect(safeHref(null)).toBeNull();
    const [c] = creditLines([{ ...DBIP, url: 'javascript:alert(1)', license_url: 'ftp://x' }]);
    expect(c?.href).toBeNull();
    expect(c?.licenseHref).toBeNull();
    expect(c?.text).toBe('IP Geolocation by DB-IP');
  });
});
