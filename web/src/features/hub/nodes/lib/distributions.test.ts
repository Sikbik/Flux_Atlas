import { describe, expect, it } from 'vitest';
import type { CountBucket } from '../../../../api/generated/CountBucket';
import type { GeoBreakdownDto } from '../../../../api/generated/GeoBreakdownDto';
import type { ProvidersDto } from '../../../../api/generated/ProvidersDto';
import { geoDistribution, providerDistribution, shortOrg, versionDistribution } from './distributions';

const bucket = (key: string, count: number, total = 1000, label = key): CountBucket => ({
  key,
  label,
  count,
  share: count / total,
});

const geo = (countries: CountBucket[], unlocated = 0): GeoBreakdownDto => ({
  continents: [],
  countries,
  regions: [],
  unlocated,
});

describe('geoDistribution', () => {
  const g = geo([
    bucket('FR', 120, 1000, 'France'),
    bucket('DE', 300, 1000, 'Germany'),
    bucket('US', 250, 1000, 'United States'),
    bucket('FI', 100, 1000, 'Finland'),
    bucket('NL', 80, 1000, 'The Netherlands'),
    bucket('CA', 50, 1000, 'Canada'),
    bucket('JP', 40, 1000, 'Japan'),
  ]);

  it('lists the largest few, whatever order the server sent', () => {
    const d = geoDistribution(g, 1000, 4);
    expect(d.rows.map((r) => r.id)).toEqual(['DE', 'US', 'FR', 'FI']);
    expect(d.entries).toBe(7);
  });

  it('marks the fewest places that together pass half, and names them', () => {
    const d = geoDistribution(g, 1000, 6);
    // Germany 30% + United States 25% = 55% of 1000.
    expect(d.rows.filter((r) => r.lead).map((r) => r.id)).toEqual(['DE', 'US']);
    expect(d.reading).toBe('Germany and United States hold 55.0% of all nodes.');
  });

  it('draws the rest in neutral gray only once there is a leading set to set them apart from', () => {
    const d = geoDistribution(g, 1000, 6);
    expect(d.rows.map((r) => r.color)).toEqual([
      undefined,
      undefined,
      'var(--viz-other)',
      'var(--viz-other)',
      'var(--viz-other)',
      'var(--viz-other)',
    ]);
    const flat = geoDistribution(geo([bucket('DE', 100), bucket('US', 100)]), 1000);
    expect(flat.rows.every((r) => r.color === undefined)).toBe(true);
  });

  it('says so when no set of the listed places reaches half', () => {
    const d = geoDistribution(geo([bucket('DE', 100), bucket('US', 100)]), 1000);
    expect(d.rows.some((r) => r.lead)).toBe(false);
    expect(d.reading).toContain('do not hold more than half');
  });

  it('opens the globe filtered to the country, by its code', () => {
    const d = geoDistribution(g, 1000, 1);
    expect(d.rows[0]?.to).toEqual({ kind: 'country', value: 'DE' });
    expect(d.rows[0]?.shareText).toBe('30.0%');
    expect(d.rows[0]?.title).toContain('Germany: 300 nodes, 30.0%');
  });

  it('counts the nodes with no location against the leaders when no total is known', () => {
    const d = geoDistribution(geo([bucket('DE', 400), bucket('US', 100)], 500), null);
    // 500 of 1000 (500 not located) is not more than half, however the located ones are counted.
    expect(d.rows.some((r) => r.lead)).toBe(false);
  });
});

describe('providerDistribution', () => {
  const dto: ProvidersDto = {
    hosting_share: 0.62,
    providers: [
      { asn: 24940, org: 'Hetzner Online GmbH', nodes: 600, hosts: 400, countries: 2, share: 0.6 },
      { asn: 16276, org: 'OVH', nodes: 100, hosts: 60, countries: 5, share: 0.1 },
      { asn: null, org: 'Home Fibre Ltd', nodes: 50, hosts: 50, countries: 1, share: 0.05 },
    ],
  };

  it('names the leaders by their short names', () => {
    const d = providerDistribution(dto, 1000);
    expect(d.reading).toBe('Hetzner Online holds 60.0% of all nodes.');
    expect(d.rows[0]?.lead).toBe(true);
    expect(d.rows[1]?.lead).toBe(false);
  });

  it('opens the provider by its registered name, and keys a provider with no AS number by that name', () => {
    const d = providerDistribution(dto, 1000);
    expect(d.rows[0]?.to).toEqual({ kind: 'provider', value: 'Hetzner Online GmbH' });
    expect(d.rows[2]?.id).toBe('Home Fibre Ltd');
  });
});

describe('shortOrg', () => {
  it('drops the legal form and keeps the first two words', () => {
    expect(shortOrg('Hetzner Online GmbH')).toBe('Hetzner Online');
    expect(shortOrg('OVH')).toBe('OVH');
    expect(shortOrg('GmbH')).toBe('GmbH');
  });

  it('keeps a dot inside a name and drops the punctuation after a word', () => {
    expect(shortOrg('Amazon.com, Inc.')).toBe('Amazon.com');
    expect(shortOrg('OVH Hosting, Inc.')).toBe('OVH Hosting');
    expect(shortOrg('Sakura Internet Inc.')).toBe('Sakura Internet');
  });
});

describe('versionDistribution', () => {
  const buckets = [
    bucket('8.9.0', 5, 1000),
    bucket('unknown', 67, 1000, 'unknown'),
    bucket('8.20.0', 900, 1000),
    bucket('8.18.0', 5, 1000),
  ];

  it('puts the most common first, newer before older on a tie, and the unreported last', () => {
    const d = versionDistribution(buckets, 5);
    expect(d.rows.map((r) => r.id)).toEqual(['8.20.0', '8.18.0', '8.9.0', 'unknown']);
    expect(d.rows.at(-1)?.label).toBe('Not reported');
    expect(d.rows.at(-1)?.to).toBeNull();
    expect(d.rows.at(-1)?.color).toBe('var(--viz-other)');
    expect(d.rows[0]?.color).toBeUndefined();
  });

  it('sorts 8.20.0 above 8.9.0 by number, not by letters', () => {
    const d = versionDistribution([bucket('8.9.0', 5, 100), bucket('8.20.0', 5, 100)]);
    expect(d.rows.map((r) => r.id)).toEqual(['8.20.0', '8.9.0']);
  });

  it('reads the share on the leading version and how many others are in use', () => {
    expect(versionDistribution(buckets).reading).toBe(
      '90.0% of nodes run 8.20.0; 2 other versions are in use.',
    );
    expect(versionDistribution([bucket('8.20.0', 10, 10)]).reading).toBe('100.0% of nodes run 8.20.0.');
  });

  it('is honest when nothing is reported', () => {
    expect(versionDistribution([]).reading).toBe('No version is reported yet.');
    expect(versionDistribution([bucket('unknown', 5, 5)]).rows).toHaveLength(1);
  });

  it('lets a version open the globe filtered to it', () => {
    expect(versionDistribution(buckets).rows[0]?.to).toEqual({ kind: 'version', value: '8.20.0' });
  });
});
