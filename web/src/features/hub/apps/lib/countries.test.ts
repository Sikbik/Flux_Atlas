import { describe, expect, it } from 'vitest';
import type { AppCountryRow } from '../../../../api/generated/AppCountryRow';
import { countryHeadline, countryModel, countrySummary, UNKNOWN_LOCATION } from './countries';

const rows: AppCountryRow[] = [
  { code: 'FR', name: 'France', instances: 300 },
  { code: 'DE', name: 'Germany', instances: 500 },
  { code: 'US', name: 'United States', instances: 100 },
  { code: 'FI', name: 'Finland', instances: 0 },
];

describe('countryModel', () => {
  it('ranks the countries, leaves out one with no instance, and shares out the total with the unlocated ones in it', () => {
    const m = countryModel(rows, 100);
    expect(m.rows.map((r) => r.code)).toEqual(['DE', 'FR', 'US']);
    expect(m.located).toBe(900);
    expect(m.total).toBe(1000);
    expect(m.countries).toBe(3);
    expect(m.rows[0]?.share).toBeCloseTo(0.5);
  });

  it('keeps the unknown location as a row of its own, with the instances that have no country', () => {
    const m = countryModel(rows, 100);
    expect(m.unknown).toMatchObject({
      id: 'unknown',
      code: null,
      name: UNKNOWN_LOCATION,
      instances: 100,
      lead: false,
    });
    expect(m.unknown.share).toBeCloseTo(0.1);
  });

  it('lists the unlocated instances at the rank their count earns, so a folded list does not hide them', () => {
    expect(countryModel(rows, 400).ranked.map((r) => r.id)).toEqual(['DE', 'unknown', 'FR', 'US']);
    expect(countryModel(rows, 150).ranked.map((r) => r.id)).toEqual(['DE', 'FR', 'unknown', 'US']);
    // A tie keeps the countries first.
    expect(countryModel(rows, 100).ranked.map((r) => r.id)).toEqual(['DE', 'FR', 'US', 'unknown']);
    expect(countryModel(rows, 50).ranked.map((r) => r.id)).toEqual(['DE', 'FR', 'US', 'unknown']);
  });

  it('leaves the unlocated row out when every instance is located: a real zero is not a row', () => {
    const m = countryModel(rows, 0);
    expect(m.unknown.instances).toBe(0);
    expect(m.ranked.map((r) => r.id)).toEqual(['DE', 'FR', 'US']);
    expect(m.total).toBe(900);
  });

  it('finds the fewest countries that pass half of all instances, the unlocated ones counted against them', () => {
    const m = countryModel(rows, 100);
    // Germany holds exactly half of 1,000: not more than half, so France joins it.
    expect(m.leaders.names).toEqual(['Germany', 'France']);
    expect(m.leaders.n).toBe(2);
    expect(m.leaders.reached).toBe(true);
    expect(m.rows.map((r) => r.lead)).toEqual([true, true, false]);
  });

  it('marks no country as a leader when the located ones do not pass half together', () => {
    const m = countryModel([{ code: 'DE', name: 'Germany', instances: 10 }], 100);
    expect(m.leaders.reached).toBe(false);
    expect(m.rows[0]?.lead).toBe(false);
  });

  it('is empty for no instances at all', () => {
    const m = countryModel([], 0);
    expect(m.rows).toEqual([]);
    expect(m.total).toBe(0);
    expect(countryHeadline(m)).toBe('');
    expect(countrySummary(m)).toBe('No running instance has a stored location.');
  });
});

describe('countryHeadline', () => {
  it('names who hosts half', () => {
    expect(countryHeadline(countryModel(rows, 100))).toBe(
      'Germany and France together host 80.0% of the running instances.',
    );
  });

  it('says alone for a single country', () => {
    const m = countryModel(
      [
        { code: 'DE', name: 'Germany', instances: 90 },
        { code: 'FR', name: 'France', instances: 10 },
      ],
      0,
    );
    expect(countryHeadline(m)).toBe('Germany alone hosts 90.0% of the running instances.');
  });

  it('says the located countries do not reach half, instead of naming a few', () => {
    const m = countryModel([{ code: 'DE', name: 'Germany', instances: 10 }], 100);
    expect(countryHeadline(m)).toContain('The located countries host 9.1%');
  });
});

describe('countrySummary', () => {
  it('counts the instances and countries and says how many have no location', () => {
    const text = countrySummary(countryModel(rows, 100));
    expect(text).toContain('1,000 running instances in 3 countries.');
    expect(text).toContain('100 have no known location.');
  });

  it('does not mention the unknown location when there is none', () => {
    expect(countrySummary(countryModel(rows, 0))).not.toContain('no known location');
  });
});
