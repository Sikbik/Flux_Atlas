import { describe, expect, it } from 'vitest';
import { parseExtraWindows, pathForWindow, serializeExtraWindows, windowForPath } from './route';
import type { WindowRef } from './types';

describe('windowForPath', () => {
  it('maps every windowed IA route', () => {
    const cases: [string, WindowRef | null][] = [
      ['/nodes', { type: 'nodes', key: null }],
      ['/node/65.109.26.93:16147', { type: 'node', key: '65.109.26.93:16147' }],
      ['/host/65.109.26.93', { type: 'host', key: '65.109.26.93' }],
      ['/apps', { type: 'apps', key: null }],
      ['/app/BitcoinWhitepaper', { type: 'app', key: 'BitcoinWhitepaper' }],
      ['/app/BitcoinWhitepaper/history/3', { type: 'app', key: 'BitcoinWhitepaper' }],
      ['/explorer', { type: 'explorer', key: null }],
      ['/block/2996929', { type: 'block', key: '2996929' }],
      ['/tx/abc', { type: 'tx', key: 'abc' }],
      ['/address/t1abc', { type: 'address', key: 't1abc' }],
      ['/mempool', { type: 'mempool', key: null }],
      ['/supply', { type: 'supply', key: null }],
      ['/richlist', { type: 'richlist', key: null }],
      ['/queue', { type: 'queue', key: null }],
      ['/queue/stratus', { type: 'queue', key: 'stratus' }],
      ['/analytics', { type: 'analytics', key: null }],
      ['/analytics/geography', { type: 'analytics', key: 'geography' }],
      ['/operator/t1op', { type: 'operator', key: 't1op' }],
      ['/terminal', { type: 'terminal', key: null }],
      ['/time', { type: 'time', key: null }],
      ['/weather', { type: 'weather', key: null }],
      ['/about', { type: 'about', key: null }],
      ['/settings', { type: 'settings', key: null }],
    ];
    for (const [path, want] of cases) expect(windowForPath(path), path).toEqual(want);
  });

  it('opens nothing on the bare globe, ambient, search results, dev and unknown paths', () => {
    for (const p of [
      '/',
      '',
      '/ambient',
      '/q/abc',
      '/dev/live',
      '/nope',
      '/node',
      '/node/1/extra',
      '/about/x',
      '/explorer/blocks',
      '/nodes/abc',
      '/apps/abc',
    ])
      expect(windowForPath(p), p).toBeNull();
  });

  it('decodes percent-encoded keys', () => {
    expect(windowForPath('/node/1.2.3.4%3A16127')).toEqual({ type: 'node', key: '1.2.3.4:16127' });
  });

  it('round trips through pathForWindow', () => {
    for (const p of [
      '/node/1.2.3.4%3A16127',
      '/app/x',
      '/queue',
      '/queue/nimbus',
      '/about',
      '/explorer',
      '/nodes',
      '/apps',
      '/analytics/churn',
    ]) {
      const ref = windowForPath(p)!;
      expect(windowForPath(pathForWindow(ref.type, ref.key)!)).toEqual(ref);
    }
    expect(pathForWindow('node', null)).toBeNull();
  });
});

describe('extra windows (?w=)', () => {
  it('parses stack order, keeps at most two, drops unknown and unframed types', () => {
    expect(parseExtraWindows('queue,app:BitcoinWhitepaper')).toEqual([
      { type: 'queue', key: null },
      { type: 'app', key: 'BitcoinWhitepaper' },
    ]);
    expect(parseExtraWindows('bogus,time,queue,app:a,mempool')).toEqual([
      { type: 'queue', key: null },
      { type: 'app', key: 'a' },
    ]);
    expect(parseExtraWindows(undefined)).toEqual([]);
    expect(parseExtraWindows('queue,queue')).toEqual([{ type: 'queue', key: null }]);
  });

  it('serializes URI-safe and round trips keys with colons and commas', () => {
    const list: WindowRef[] = [
      { type: 'node', key: '1.2.3.4:16127' },
      { type: 'app', key: 'a,b' },
    ];
    const w = serializeExtraWindows(list)!;
    expect(w).toBe('node:1.2.3.4%3A16127,app:a%2Cb');
    expect(parseExtraWindows(w)).toEqual(list);
    expect(serializeExtraWindows([])).toBeUndefined();
  });
});
