import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeMeshBin } from './bin/writer';
import { api } from './endpoints';
import { ApiError, buildQuery, getJson, isAbortError } from './http';
import { qk } from './queryKeys';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

afterEach(() => vi.unstubAllGlobals());

/** The rejection of `p` (fails the test if it resolves). */
const failure = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error('expected a failure');
    },
    (x: unknown) => x as ApiError,
  );

describe('http', () => {
  it('builds queries, skipping empty values and joining arrays', () => {
    expect(buildQuery({ a: 1, b: null, c: undefined, d: '', e: ['x', 'y'], f: [], g: false })).toBe(
      '?a=1&e=x%2Cy&g=false',
    );
    expect(buildQuery({})).toBe('');
  });

  it('returns JSON and forwards the abort signal', async () => {
    const fetch = vi.fn(async () => json(200, { ok: true }));
    vi.stubGlobal('fetch', fetch);
    const ac = new AbortController();
    await expect(getJson('/x', { q: 'a b' }, { signal: ac.signal })).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith('/api/v1/x?q=a+b', expect.objectContaining({ signal: ac.signal }));
  });

  it('normalizes the server error shape', async () => {
    vi.stubGlobal('fetch', async () =>
      json(429, { error: { code: 'rate_limited', message: 'slow down' } }, { 'retry-after': '5' }),
    );
    const e = await failure(getJson('/x'));
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ code: 'rate_limited', message: 'slow down', status: 429, retryAfterS: 5 });
    expect(e.retryable).toBe(true);
  });

  it('classifies non-JSON errors, network failures and bad bodies', async () => {
    vi.stubGlobal('fetch', async () => new Response('gateway', { status: 502, statusText: 'Bad Gateway' }));
    await expect(getJson('/x')).rejects.toMatchObject({ code: 'http', status: 502 });
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(getJson('/x')).rejects.toMatchObject({ code: 'network', status: 0 });
    vi.stubGlobal('fetch', async () => new Response('not json', { status: 200 }));
    await expect(getJson('/x')).rejects.toMatchObject({ code: 'parse' });
    vi.stubGlobal('fetch', async () => json(404, { error: { code: 'not_found', message: 'no such node' } }));
    const e = await failure(getJson('/nodes/9'));
    expect(e.code).toBe('not_found');
    expect(e.retryable).toBe(false);
  });

  it('lets aborts through untouched', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    const e = await failure(getJson('/x'));
    expect(isAbortError(e)).toBe(true);
    expect(e).not.toBeInstanceOf(ApiError);
  });

  it('encodes path keys and decodes binary endpoints', async () => {
    const fetch = vi.fn(async (url: string) =>
      url.endsWith('mesh.bin') ? new Response(encodeMeshBin([[1, 2, 1]], { seq: 9 })) : json(200, {}),
    );
    vi.stubGlobal('fetch', fetch);
    await api.node('[2001:db8::1]:16137');
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/v1/nodes/%5B2001%3Adb8%3A%3A1%5D%3A16137');
    const m = await api.meshBin();
    expect(m.seq).toBe(9);
    expect(Array.from(m.b)).toEqual([2]);
    await api.metrics({ series: ['node_count', 'cumulus'], step: '1h' });
    expect(fetch.mock.calls.at(-1)?.[0]).toBe('/api/v1/metrics?series=node_count%2Ccumulus&step=1h');
  });

  it('builds hierarchical query keys', () => {
    expect(qk.nodes.detail(5)).toEqual(['atlas', 'nodes', 'detail', '5']);
    expect(qk.nodes.detail(5).slice(0, 3)).toEqual([...qk.nodes.all(), 'detail']);
    expect(qk.apps.detail('KadenaNode')).toEqual(['atlas', 'apps', 'detail', 'kadenanode']);
    expect(qk.metrics({ series: ['stratus', 'cumulus'] })[2]).toEqual({ series: ['cumulus', 'stratus'] });
  });
});
