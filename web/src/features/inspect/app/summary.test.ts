import { describe, expect, it } from 'vitest';
import type { GeoRule } from '../../../api/generated/GeoRule';
import { componentsSummary, instancesSummary, placementSummary, plural } from './summary';

const rule = (allow: boolean, continent: string, country: string | null = null): GeoRule => ({
  allow,
  continent,
  country,
  region: null,
});
const base = { geolocation: [] as GeoRule[], static_ip: false, datacenter: null, nodes: [] as string[] };

describe('plural', () => {
  it('uses the noun that matches the count and groups thousands', () => {
    expect(plural(1, 'day')).toBe('1 day');
    expect(plural(2, 'day')).toBe('2 days');
    expect(plural(1, 'country', 'countries')).toBe('1 country');
    expect(plural(1234, 'revision')).toBe('1,234 revisions');
  });
});

describe('componentsSummary', () => {
  it('counts components and names a single short image', () => {
    expect(componentsSummary(['yurinnick/folding-at-home:latest'])).toBe('1 component · folding-at-home');
    expect(componentsSummary(['a/b:1', 'c/d:2', 'e/f:3'])).toBe('3 components');
  });
  it('leaves a long image name out so the aside stays short', () => {
    expect(componentsSummary(['org/a-very-long-image-name-indeed:1'])).toBe('1 component');
  });
  it('copes with no component', () => {
    expect(componentsSummary([])).toBe('0 components');
  });
});

describe('placementSummary', () => {
  it('says anywhere when nothing is asked', () => {
    expect(placementSummary(base)).toBe('Anywhere');
  });
  it('names a single rule', () => {
    expect(placementSummary({ ...base, geolocation: [rule(false, 'AS')] })).toBe('Never in Asia');
    expect(placementSummary({ ...base, geolocation: [rule(true, 'EU', 'DE')] })).toBe(
      'Only in Germany, Europe',
    );
  });
  it('counts several rules, however long the list', () => {
    const geolocation = [rule(true, 'EU'), rule(true, 'SA'), rule(true, 'AS'), rule(false, 'AF')];
    expect(placementSummary({ ...base, geolocation })).toBe('3 allowed · 1 forbidden');
    expect(placementSummary({ ...base, geolocation: [rule(true, 'EU'), rule(true, 'NA')] })).toBe(
      '2 allowed',
    );
  });
  it('falls back to the host requirements, then pinned hosts', () => {
    expect(placementSummary({ ...base, static_ip: true })).toBe('Host requirements');
    expect(placementSummary({ ...base, datacenter: false })).toBe('Host requirements');
    expect(placementSummary({ ...base, nodes: ['1.2.3.4:16127', '5.6.7.8'] })).toBe('Pinned to 2 hosts');
  });
});

describe('instancesSummary', () => {
  it('leads with how many run against the target', () => {
    expect(instancesSummary({ running: 100, target: 100, installing: 0, countries: 0 })).toBe('100 of 100');
  });
  it('adds installs first, then the countries', () => {
    expect(instancesSummary({ running: 98, target: 100, installing: 2, countries: 9 })).toBe(
      '98 of 100 · 2 installing',
    );
    expect(instancesSummary({ running: 100, target: 100, installing: 0, countries: 13 })).toBe(
      '100 of 100 · 13 countries',
    );
    expect(instancesSummary({ running: 1, target: 1, installing: 0, countries: 1 })).toBe(
      '1 of 1 · 1 country',
    );
  });
});
