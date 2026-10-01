import { describe, expect, it } from 'vitest';
import { BootSignalCollector, readMarks } from './signals';

const timing = (name: string, t: Partial<PerformanceResourceTiming>) =>
  ({ name, entryType: 'resource', ...t }) as unknown as PerformanceResourceTiming;

describe('readMarks', () => {
  it('reads when the first byte of the bootstrap request came', () => {
    const m = readMarks([
      timing('http://x/api/v1/nodes.bin', { requestStart: 1, responseStart: 5, responseEnd: 9 }),
      timing('http://x/api/v1/bootstrap', { requestStart: 100, responseStart: 142, responseEnd: 180 }),
    ]);
    expect(m).toEqual({ bootstrapStart: 142, ttfbMs: 42 });
  });

  it('is empty before the request has any timing', () => {
    expect(readMarks([])).toEqual({});
    expect(
      readMarks([timing('http://x/api/v1/bootstrap', { requestStart: 0, responseStart: 0, responseEnd: 0 })]),
    ).toEqual({});
  });

  it('does not mistake another request for the bootstrap', () => {
    expect(
      readMarks([
        timing('http://x/api/v1/bootstrapper', { requestStart: 1, responseStart: 2, responseEnd: 3 }),
      ]),
    ).toEqual({});
  });
});

describe('the collector', () => {
  const idle = { loaded: false, status: 'syncing', globe: 'loading' as const };

  it('records each stage the first time its condition holds, and keeps that time', () => {
    const c = new BootSignalCollector(0);
    expect(c.observe(100, idle, {}).done).toEqual({});
    expect(c.observe(200, idle, { bootstrapStart: 150, ttfbMs: 40 }).done).toEqual({ connect: 150 });
    // The snapshot is in but the globe is not up: the symbol's stages wait for it.
    expect(
      c.observe(300, { loaded: true, status: 'connecting', globe: 'loading' }, { bootstrapStart: 150 }).done
        .tip,
    ).toBeUndefined();
    const s = c.observe(400, { loaded: true, status: 'connecting', globe: 'ready' }, { bootstrapStart: 150 });
    expect(s.done.tip).toBe(400);
    expect(s.done.nodes).toBe(400);
    expect(s.done.hosts).toBe(400);
    expect(s.done.apps).toBe(400);
    expect(s.done.sun).toBe(400);
    expect(s.done.stream).toBeUndefined();
    const live = c.observe(900, { loaded: true, status: 'live', globe: 'ready' }, {});
    expect(live.done.stream).toBe(900);
    expect(live.done.nodes).toBe(400);
    expect(live.failed).toBeNull();
  });

  it('sets the sun as soon as the globe is up, even before the data', () => {
    const c = new BootSignalCollector(0);
    expect(c.observe(100, { ...idle, globe: 'ready' }, {}).done.sun).toBe(100);
  });

  it('counts a globe that cannot start as up, so the boot does not wait for it', () => {
    const c = new BootSignalCollector(0);
    expect(c.observe(100, { loaded: true, status: 'live', globe: 'unsupported' }, {}).done.hosts).toBe(100);
  });

  it('reports a failure and clears it when the stream opens', () => {
    const c = new BootSignalCollector(0);
    expect(c.observe(100, { loaded: true, status: 'connecting', globe: 'ready' }, {}).failed).toBeNull();
    expect(c.observe(20_000, { loaded: true, status: 'reconnecting', globe: 'ready' }, {}).failed).toBe(
      'stream',
    );
    expect(c.observe(20_100, { loaded: true, status: 'live', globe: 'ready' }, {}).failed).toBeNull();
  });

  it('starts the stall clock again on retry', () => {
    const c = new BootSignalCollector(0);
    c.observe(100, { loaded: true, status: 'reconnecting', globe: 'ready' }, {});
    expect(c.observe(20_000, { loaded: true, status: 'reconnecting', globe: 'ready' }, {}).failed).toBe(
      'stream',
    );
    c.retry(20_000);
    expect(c.observe(20_500, { loaded: true, status: 'reconnecting', globe: 'ready' }, {}).failed).toBeNull();
  });
});
