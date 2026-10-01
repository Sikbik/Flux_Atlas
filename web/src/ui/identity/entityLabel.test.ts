import { describe, expect, it } from 'vitest';
import { entityIsMono, entityLabel } from './entityLabel';
import { entityHref, entityRoute } from './entityRoute';

const txid = '8aa97365b148e2125de355988b4c1be4870edc0e869587f831f8c0d65871beec';

describe('entityLabel', () => {
  it('writes nodes and hosts as endpoints', () => {
    expect(entityLabel('node', '65.109.26.93:16147')).toBe('65.109.26.93:16147');
    expect(entityLabel('node', '[2001:db8::1]:16137')).toBe('[2001:db8::1]:16137');
    expect(entityLabel('host', '65.109.26.93')).toBe('65.109.26.93');
  });

  it('shortens collateral outpoints used as node keys', () => {
    expect(entityLabel('node', `${txid}:0`)).toBe('8aa973…1beec:0');
    expect(entityLabel('node', '4021')).toBe('4021');
  });

  it('groups block heights and shortens block hashes', () => {
    expect(entityLabel('block', '2996929')).toBe('2,996,929');
    expect(entityLabel('block', txid)).toBe('8aa973…1beec');
  });

  it('middle-truncates transactions and addresses', () => {
    expect(entityLabel('tx', txid)).toBe('8aa973…1beec');
    expect(entityLabel('address', 't1cz5PE2QnTYwoBnTRVxd8oiNMxdwFqDg9')).toBe('t1cz5P…qDg9');
    expect(entityLabel('operator', 't1cz5PE2QnTYwoBnTRVxd8oiNMxdwFqDg9')).toBe('t1cz5P…qDg9');
  });

  it('passes names and filter values through', () => {
    expect(entityLabel('app', 'BitcoinWhitepaper')).toBe('BitcoinWhitepaper');
    expect(entityLabel('country', 'FI')).toBe('FI');
    expect(entityLabel('provider', 'Hetzner Online GmbH')).toBe('Hetzner Online GmbH');
    expect(entityLabel('version', '8.20.0')).toBe('8.20.0');
  });

  it('sets data kinds in mono and names in sans', () => {
    expect(entityIsMono('tx')).toBe(true);
    expect(entityIsMono('version')).toBe(true);
    expect(entityIsMono('app')).toBe(false);
    expect(entityIsMono('country')).toBe(false);
    expect(entityIsMono('provider')).toBe(false);
  });
});

describe('entityRoute and entityHref', () => {
  it('maps every windowed kind to its route', () => {
    expect(entityRoute('node', '1.2.3.4:16127')).toEqual({
      to: '/node/$key',
      params: { key: '1.2.3.4:16127' },
    });
    expect(entityRoute('host', '1.2.3.4')).toEqual({ to: '/host/$ip', params: { ip: '1.2.3.4' } });
    expect(entityRoute('app', 'Foo')).toEqual({ to: '/app/$name', params: { name: 'Foo' } });
    expect(entityRoute('block', '12')).toEqual({ to: '/block/$key', params: { key: '12' } });
    expect(entityRoute('tx', 'ab')).toEqual({ to: '/tx/$txid', params: { txid: 'ab' } });
    expect(entityRoute('address', 't1x')).toEqual({ to: '/address/$addr', params: { addr: 't1x' } });
    expect(entityRoute('operator', 't1x')).toEqual({ to: '/operator/$addr', params: { addr: 't1x' } });
  });

  it('opens filter kinds on the globe with the filter applied', () => {
    expect(entityRoute('country', 'FI')).toEqual({ to: '/', search: { cc: 'FI' } });
    expect(entityRoute('provider', 'Hetzner')).toEqual({ to: '/', search: { org: 'Hetzner' } });
    expect(entityRoute('version', '8.20.0')).toEqual({ to: '/', search: { ver: '8.20.0' } });
  });

  it('builds hrefs with encoded keys', () => {
    expect(entityHref('node', '65.109.26.93:16147')).toBe('/node/65.109.26.93%3A16147');
    expect(entityHref('app', 'My App')).toBe('/app/My%20App');
    expect(entityHref('country', 'FI')).toBe('/?cc=FI');
    expect(entityHref('provider', 'Hetzner Online GmbH')).toBe('/?org=Hetzner%20Online%20GmbH');
    expect(entityHref('version', '8.20.0')).toBe('/?ver=8.20.0');
  });
});
