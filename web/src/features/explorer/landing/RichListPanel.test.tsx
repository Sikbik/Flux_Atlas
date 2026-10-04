// @vitest-environment jsdom
// The rich list card of the Explorer landing: the share of the supply by rank, the five largest addresses with what is
// known about them, and the movers. It leaves the page when the ranking is empty, says when it is an old copy, and
// fails on its own without touching the rest of the page.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RichListDto } from '../../../api/generated/RichListDto';
import type { RichListEntry } from '../../../api/generated/RichListEntry';
import type { RichMoversDto } from '../../../api/generated/RichMoversDto';
import { shortAddress } from '../../../lib/format';
import { useUi } from '../../../store/ui';
import { click, type Mounted, mount } from '../../../ui/internal/testing';
import { SWAP_POOL_ADDRESS } from '../lib/entities';
import { RichListPanel } from './RichListPanel';

vi.mock('../../../shell/frame/nav', () => ({ useShellNav: () => ({ open: vi.fn(), go: vi.fn() }) }));

// ---- a stand-in for the server ------------------------------------------------------------------------------

interface Reply {
  status?: number;
  body: unknown;
}

const json = ({ status = 200, body }: Reply) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function serve(answer: (url: string) => Reply | Promise<Reply>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => json(await answer(String(input)))),
  );
}

const settle = (ms = 0) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

async function until(check: () => boolean, what: string) {
  const end = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await settle(5);
  }
}

// ---- fixtures -------------------------------------------------------------------------------------------------

const NOW = Date.UTC(2026, 9, 4, 15, 0, 0);
const addr = (n: number) => `t1${String(n).padStart(33, 'q')}`;

function entry(rank: number, address: string, flux: number, share: number, nodes = 0): RichListEntry {
  return { rank, address, balance: flux.toFixed(8), share_pct: share, node_count: nodes };
}

function ranking(over: Partial<RichListDto> = {}): RichListDto {
  const entries = [
    entry(1, SWAP_POOL_ADDRESS, 160_000_000, 37.2),
    entry(2, addr(2), 11_300_000, 2.63, 7),
    entry(3, addr(3), 7_700_000, 1.79, 8),
    entry(4, addr(4), 5_100_000, 1.18, 8),
    entry(5, addr(5), 4_300_000, 1.0, 8),
    ...Array.from({ length: 20 }, (_, i) => entry(6 + i, addr(6 + i), 3_000_000 - i * 1000, 0.7 - i * 0.01)),
  ];
  return { updated_ms: NOW - 600_000, stale: false, entries, ...over };
}

const tracking: RichMoversDto = {
  window: '7d',
  to_ms: NOW,
  from_ms: null,
  snapshots: 1,
  gainers: [],
  losers: [],
  entered: [],
  left: [],
  concentration: [],
};

// ---- the card ---------------------------------------------------------------------------------------------------

let qc: QueryClient;
let view: Mounted | null = null;

beforeEach(() => {
  useUi.getState().setMotion('off');
  // The rich list keeps its own retry rule (it asks again while the server fills); retries here are immediate.
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: Number.POSITIVE_INFINITY } },
  });
});

afterEach(() => {
  view?.unmount();
  view = null;
  qc.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function open(): HTMLElement {
  view = mount(
    <QueryClientProvider client={qc}>
      <RichListPanel />
    </QueryClientProvider>,
  );
  return view.container;
}

const card = (c: HTMLElement) => c.querySelector<HTMLElement>('#ex-rich');

/** The server: the ranking, and a movers answer that has not got two pictures yet. */
const server = (list: RichListDto | Reply, movers: RichMoversDto = tracking) =>
  serve((url) => {
    if (url.includes('/richlist/movers')) return { body: movers };
    return 'entries' in list ? { body: list } : list;
  });

describe('RichListPanel', () => {
  it('holds the shape of the card while the ranking is read', async () => {
    serve(() => new Promise<Reply>(() => undefined));
    const c = open();
    await settle();
    expect(card(c)?.getAttribute('data-state')).toBe('loading');
    expect(card(c)?.getAttribute('aria-busy')).toBe('true');
    expect(c.querySelector('h2')?.textContent).toBe('Who holds the supply');
    expect(c.querySelector('.ex-rich--skeleton')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('ready: the ring, the five largest addresses with their labels, and the way to the whole list', async () => {
    server(ranking());
    const c = open();
    await until(() => card(c)?.getAttribute('data-state') === 'ready', 'the card');
    // The share the largest ten hold, in the middle of the ring.
    expect(c.querySelector('.ex-ring')?.textContent).toContain('held by the top 10');
    const rows = [...c.querySelectorAll('li.hub-lb__row')];
    expect(rows).toHaveLength(5);
    // The first is the swap pool: named, not just shortened.
    expect(rows[0]?.textContent).toContain('Swap pool');
    const links = [...c.querySelectorAll('a.hub-lb__link')].map((a) => a.getAttribute('aria-label'));
    expect(links[0]).toBe(`1. Open address ${shortAddress(SWAP_POOL_ADDRESS)}, the swap pool`);
    expect(links[1]).toBe(`2. Open address ${shortAddress(addr(2))}`);
    // The way on, and how many addresses the ranking holds.
    const more = [...c.querySelectorAll('a')].find((a) => a.textContent === 'Open the rich list');
    expect(more?.getAttribute('href')).toBe('/richlist');
    expect(c.textContent).toContain('25 addresses ranked');
    // No old-copy note on a fresh ranking.
    expect(c.querySelector('.ex-stale')).toBeNull();
  });

  it('says when the ranking is the last good copy', async () => {
    server(ranking({ stale: true }));
    const c = open();
    await until(() => card(c)?.getAttribute('data-state') === 'ready', 'the card');
    expect(c.querySelector('.ex-stale')?.textContent).toContain('The last good copy of the ranking');
    expect(c.querySelector('.ex-stale')?.getAttribute('role')).toBe('status');
  });

  it('leaves the page when the server has no ranking yet, rather than showing an empty card', async () => {
    server(ranking({ entries: [] }));
    const c = open();
    await settle(20);
    await until(() => qc.isFetching() === 0, 'the requests');
    expect(card(c)).toBeNull();
    expect(c.textContent).toBe('');
  });

  it('fails on its own: the heading stays, the error is announced, and Retry asks again', async () => {
    let fail = true;
    serve((url) => {
      if (url.includes('/richlist/movers')) return { body: tracking };
      return fail
        ? { status: 502, body: { error: { code: 'upstream', message: 'behind' } } }
        : { body: ranking() };
    });
    const c = open();
    await until(() => card(c)?.getAttribute('data-state') === 'error', 'the error');
    expect(c.querySelector('h2')?.textContent).toBe('Who holds the supply');
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Could not load the rich list');
    fail = false;
    const retry = [...c.querySelectorAll('button')].find((b) => b.textContent === 'Retry');
    if (retry) click(retry);
    await until(() => card(c)?.getAttribute('data-state') === 'ready', 'the card');
  });

  it('shows the movers beside the ranking, and says they are not tracking yet when they are not', async () => {
    server(ranking());
    const c = open();
    await until(() => card(c)?.getAttribute('data-state') === 'ready', 'the card');
    await until(
      () => c.textContent?.includes('Movers appear after the second daily snapshot') === true,
      'the movers',
    );
    expect(c.querySelector('.ex-movers')?.getAttribute('data-variant')).toBe('card');
  });
});
