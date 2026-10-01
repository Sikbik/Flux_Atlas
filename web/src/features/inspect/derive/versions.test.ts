import { describe, expect, it } from 'vitest';
import type { CountBucket } from '../../../api/generated/CountBucket';
import {
  compareVersions,
  latestVersion,
  mostCommon,
  parseVersion,
  shareOf,
  versionStanding,
} from './versions';

const b = (key: string, count: number, total = 1_000): CountBucket => ({
  key,
  label: key,
  count,
  share: count / total,
});

describe('versions', () => {
  it('parses dotted versions and rejects names', () => {
    expect(parseVersion('8.20.0')?.parts).toEqual([8, 20, 0]);
    expect(parseVersion('v9.1')?.parts).toEqual([9, 1]);
    expect(parseVersion('9.1.0-beta2')?.pre).toBe(true);
    expect(parseVersion('jolly wombat')).toBeNull();
    expect(parseVersion('unknown')).toBeNull();
    expect(parseVersion('')).toBeNull();
    expect(parseVersion(null)).toBeNull();
  });

  it('compares numerically, not lexically', () => {
    expect(compareVersions('8.20.0', '8.9.0')).toBeGreaterThan(0);
    expect(compareVersions('8.18.0', '8.20.0')).toBeLessThan(0);
    expect(compareVersions('8.20', '8.20.0')).toBe(0);
    expect(compareVersions('8.20.0-rc1', '8.20.0')).toBeLessThan(0);
    expect(compareVersions('x', '8.20.0')).toBeNull();
  });

  it('picks the latest release that a real share of the network runs', () => {
    const buckets = [b('8.20.0', 900), b('8.19.0', 90), b('8.18.0', 3), b('unknown', 5), b('9.0.0-dev', 1)];
    expect(latestVersion(buckets)).toBe('8.20.0');
    // A single node on a newer build is not "latest".
    expect(latestVersion([b('8.20.0', 900), b('8.21.0', 1)])).toBe('8.20.0');
    // When no bucket clears the bar, fall back to the highest present.
    expect(latestVersion([b('1.0.0', 1), b('1.1.0', 1)], { minCount: 5 })).toBe('1.1.0');
    expect(latestVersion([b('unknown', 10)])).toBeNull();
    expect(latestVersion([])).toBeNull();
  });

  it('says where a version stands', () => {
    expect(versionStanding('8.20.0', '8.20.0')).toBe('latest');
    expect(versionStanding('8.19.0', '8.20.0')).toBe('behind');
    expect(versionStanding('8.21.0', '8.20.0')).toBe('ahead');
    expect(versionStanding(null, '8.20.0')).toBe('unknown');
    expect(versionStanding('8.20.0', null)).toBe('unknown');
    expect(versionStanding('jolly wombat', '8.20.0')).toBe('unknown');
  });

  it('finds the most common name and the share of a key', () => {
    const arcane = [b('unknown', 492), b('jolly wombat', 6_236)];
    expect(mostCommon(arcane)).toBe('jolly wombat');
    expect(mostCommon([b('unknown', 3)])).toBeNull();
    expect(shareOf(arcane, 'jolly wombat')).toBeCloseTo(6.236, 3);
    expect(shareOf(arcane, 'nope')).toBeNull();
    expect(shareOf(arcane, null)).toBeNull();
  });
});
