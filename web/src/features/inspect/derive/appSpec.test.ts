import { describe, expect, it } from 'vitest';
import {
  appExpiry,
  appStage,
  defaultAppDomain,
  describeGeoPlace,
  envNames,
  formatGeoRules,
  parseImage,
} from './appSpec';

describe('envNames', () => {
  it('keeps names and never values', () => {
    expect(envNames(['API_KEY=s3cr=et', 'PORT=80', 'FLAG', ' SPACED =1', '=x'])).toEqual([
      'API_KEY',
      'PORT',
      'FLAG',
      'SPACED',
    ]);
    expect(envNames([])).toEqual([]);
  });
});

describe('geo rules', () => {
  it('describes allow and forbid rules in words', () => {
    expect(formatGeoRules([])).toBe('Anywhere');
    expect(formatGeoRules([{ allow: true, continent: 'EU', country: null, region: null }])).toBe(
      'Allow Europe',
    );
    expect(
      formatGeoRules([
        { allow: true, continent: 'EU', country: 'DE', region: null },
        { allow: false, continent: 'AS', country: null, region: null },
      ]),
    ).toBe('Allow Germany, Europe; forbid Asia');
  });

  it('names a region inside its country and survives unknown codes', () => {
    expect(describeGeoPlace({ allow: true, continent: 'NA', country: 'US', region: 'North Carolina' })).toBe(
      'North Carolina, United States',
    );
    expect(describeGeoPlace({ allow: true, continent: 'XX', country: null, region: null })).toBe('XX');
  });
});

describe('parseImage', () => {
  it('splits registry, repository and tag', () => {
    expect(parseImage('yurinnick/folding-at-home:latest')).toEqual({
      registry: 'docker.io',
      repository: 'yurinnick/folding-at-home',
      tag: 'latest',
      href: 'https://hub.docker.com/r/yurinnick/folding-at-home',
    });
    expect(parseImage('nginx')).toMatchObject({
      repository: 'nginx',
      tag: 'latest',
      href: 'https://hub.docker.com/_/nginx',
    });
    expect(parseImage('library/redis:7')).toMatchObject({ href: 'https://hub.docker.com/_/redis', tag: '7' });
  });

  it('keeps a registry port from being read as a tag', () => {
    expect(parseImage('registry.example.com:5000/team/app')).toMatchObject({
      registry: 'registry.example.com:5000',
      repository: 'team/app',
      tag: 'latest',
      href: null,
    });
  });

  it('links quay and leaves other registries unlinked', () => {
    expect(parseImage('quay.io/coreos/etcd:v3')?.href).toBe('https://quay.io/repository/coreos/etcd');
    expect(parseImage('ghcr.io/org/app:1')?.href).toBeNull();
  });

  it('drops digests and rejects empties', () => {
    expect(parseImage('nginx@sha256:abc')?.tag).toBe('latest');
    expect(parseImage('  ')).toBeNull();
  });
});

describe('defaultAppDomain', () => {
  it('lowercases the name', () => {
    expect(defaultAppDomain('MyApp')).toBe('myapp.app.runonflux.io');
  });
});

describe('appExpiry', () => {
  it('counts down in blocks and 30 second steps', () => {
    const e = appExpiry(1_100, 100, 600);
    expect(e.blocksLeft).toBe(500);
    expect(e.msLeft).toBe(500 * 30_000);
    expect(e.fractionLeft).toBeCloseTo(0.5, 5);
    expect(e.state).toBe('soon');
  });

  it('flags the last week and expiry', () => {
    expect(appExpiry(100_000, 0, 10).state).toBe('ok');
    expect(appExpiry(100_000, 0, 100_000).state).toBe('expired');
    expect(appExpiry(100_000, 0, 120_000).blocksLeft).toBe(0);
  });
});

describe('appStage', () => {
  const base = { exists: true, running: 0, target: 3, installing: 0, pending: null } as const;

  it('walks pending, confirmed, installing, running', () => {
    expect(appStage({ ...base, exists: false }).stage).toBe('pending');
    expect(appStage(base).stage).toBe('confirmed');
    expect(appStage({ ...base, installing: 2 }).stage).toBe('installing');
    expect(appStage({ ...base, running: 3 }).stage).toBe('running');
  });

  it('keeps an app running while more instances install', () => {
    const s = appStage({ ...base, running: 1, installing: 2 });
    expect(s.stage).toBe('running');
    expect(s.installing).toBe(2);
  });

  it('marks an update that is broadcast but not mined', () => {
    const s = appStage({ ...base, running: 3, pending: { kind: 'update', expiresMs: 1 } });
    expect(s.stage).toBe('running');
    expect(s.pendingUpdate).toBe(true);
    expect(
      appStage({ ...base, exists: false, pending: { kind: 'register', expiresMs: 1 } }).pendingUpdate,
    ).toBe(false);
  });
});
