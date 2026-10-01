// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUi } from '../../../store/ui';
import { click, type Mounted, mount } from '../../../ui/internal/testing';
import { chainHistoryKey } from '../hooks/useChainHistory';
import { chainDto, chainPoints, DAY, FORK_MS, T0 } from '../lib/chainFixture';
import type { ChainHistoryDto, ChainWindow } from '../lib/chainTypes';
import { ChainTab } from './Chain';

// ---- a stand-in for the server --------------------------------------------------------------------

interface Reply {
  status?: number;
  body: unknown;
}

const json = ({ status = 200, body }: Reply) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Replaces `fetch`: each call is answered by `answer(url)`, or waits for the test when it returns a gate. */
function serve(answer: (url: string) => Reply | Promise<Reply>) {
  const calls: string[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return json(await answer(url));
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

function gate() {
  let open: (r: Reply) => void = () => undefined;
  const reply = new Promise<Reply>((resolve) => {
    open = resolve;
  });
  return { reply, open };
}

const settle = (ms = 0) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

/** Lets the query client, and then React, catch up until `check` holds. */
async function until(check: () => boolean, what: string) {
  const end = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await settle(5);
  }
}

// ---- the tab -------------------------------------------------------------------------------------

let qc: QueryClient;
let view: Mounted | null = null;

beforeEach(() => {
  useUi.getState().setMotion('off');
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } } });
  // jsdom has no layout: the charts need a width to draw.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 232, width: 600, height: 232 }) as DOMRect,
  );
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
      <ChainTab />
    </QueryClientProvider>,
  );
  return view.container;
}

const tile = (c: HTMLElement, label: string) => {
  const el = [...c.querySelectorAll<HTMLElement>('.ui-stat')].find(
    (t) => t.querySelector('.ui-stat__label')?.textContent === label,
  );
  if (!el) throw new Error(`no tile called ${label}`);
  // A live figure draws its digits twice (what is seen, and what a screen reader hears): read the second.
  const spoken = el.querySelector('.ui-number > .ui-sr-only');
  return {
    value: spoken?.textContent ?? el.querySelector('.ui-stat__value')?.textContent ?? '',
    delta: el.querySelector('.ui-stat__delta')?.textContent ?? '',
    caption: el.querySelector('.ui-stat__caption')?.textContent ?? '',
  };
};

const radio = (c: HTMLElement, label: string) =>
  [...c.querySelectorAll<HTMLElement>('[role="radio"]')].find((r) => r.textContent === label) as HTMLElement;
const figures = (c: HTMLElement) =>
  [...c.querySelectorAll('figure')].map((f) => f.getAttribute('data-chart'));

/** The chain with 7 days of buckets, as the server answers for `window=7d`. */
const week = (over: Partial<ChainHistoryDto> = {}) => chainDto({ window: '7d', ...over });

describe('the Chain tab', () => {
  it('asks for a week first, and shows the shape of the answer until it comes', async () => {
    const g = gate();
    const calls = serve(() => g.reply);
    const c = open();
    await settle();
    expect(calls).toEqual(['/api/v1/network/chain-history?window=7d']);
    expect(c.querySelector('h2')?.textContent).toContain('Block difficulty and timing');
    const loading = c.querySelector('[role="status"][aria-busy="true"]');
    expect(loading?.textContent).toContain('Loading');
    expect(c.querySelectorAll('.ui-stat[data-state="loading"]')).toHaveLength(4);
    expect(figures(c)).toEqual([]);
    expect(radio(c, '7D').getAttribute('aria-checked')).toBe('true');
    expect([...c.querySelectorAll('[role="radio"]')].map((r) => r.textContent)).toEqual([
      '24H',
      '7D',
      '30D',
      '1Y',
      'All',
    ]);
    g.open({ body: week() });
    await until(() => figures(c).length === 2, 'the charts');
  });

  it('tells the four numbers and draws both charts', async () => {
    serve(() => ({ body: week() }));
    const c = open();
    await until(() => figures(c).length === 2, 'the charts');
    expect(figures(c)).toEqual(['difficulty', 'block-time']);
    expect(tile(c, 'Blocks in 7 days')).toMatchObject({ value: '40', caption: '2,998,996 to 2,999,036' });
    expect(tile(c, 'Latest height').value).toBe('2,999,036');
    expect(tile(c, 'Average block time').value).toBe('36.2s');
    expect(tile(c, 'Average block time').caption).toBe('Target 30 s');
    expect(tile(c, 'Average block time').delta).toContain('vs target');
    expect(tile(c, 'Latest difficulty').value).toBe('0.359');
    expect(tile(c, 'Latest difficulty').caption).toBe('Median 0.355 over 7 days');
    // 0.359 against the median of the end values, 0.355.
    expect(tile(c, 'Latest difficulty').delta).toContain('+1.1%');
    expect(tile(c, 'Latest difficulty').delta).toContain('vs median');
    expect(c.querySelector('[data-stale]')).toBeNull();
    expect(c.textContent).not.toContain('Indexing chain history');
  });

  it('keeps the last answer on screen, dimmed, while a new window loads', async () => {
    const second = gate();
    const calls = serve((url) => (url.endsWith('window=30d') ? second.reply : { body: week() }));
    const c = open();
    await until(() => figures(c).length === 2, 'the charts');
    click(radio(c, '30D'));
    await settle();
    expect(calls.at(-1)).toBe('/api/v1/network/chain-history?window=30d');
    expect(radio(c, '30D').getAttribute('aria-checked')).toBe('true');
    const body = c.querySelector('.an-chain-body');
    expect(body?.hasAttribute('data-stale')).toBe(true);
    expect(body?.getAttribute('aria-busy')).toBe('true');
    expect(tile(c, 'Latest height').value).toBe('2,999,036');
    second.open({
      body: chainDto({
        window: '30d',
        block_count: 86_000,
        latest_height: 2_999_100,
        from_height: 2_913_000,
      }),
    });
    await until(() => !c.querySelector('[data-stale]'), 'the 30 day answer');
    expect(tile(c, 'Blocks in 30 days').value).toBe('86,000');
    expect(tile(c, 'Latest height').value).toBe('2,999,100');
    expect(c.querySelector('.ui-vh__sub')?.textContent).toBe(
      'How hard blocks are to produce and how evenly they arrive, over the last 30 days.',
    );
  });

  it('asks again for a window it has already seen only when the answer is old', async () => {
    const calls = serve(() => ({ body: week() }));
    const c = open();
    await until(() => figures(c).length === 2, 'the charts');
    click(radio(c, '24H'));
    await until(() => calls.length === 2, 'the 24 hour request');
    await until(() => !c.querySelector('[data-stale]'), 'the 24 hour answer');
    click(radio(c, '7D'));
    await settle(20);
    // The week is still fresh: back on it, nothing more is asked.
    expect(calls).toEqual([
      '/api/v1/network/chain-history?window=7d',
      '/api/v1/network/chain-history?window=24h',
    ]);
    expect(radio(c, '7D').getAttribute('aria-checked')).toBe('true');
  });

  it('says that history is still being read, in one line, and draws what is there', async () => {
    serve(() => ({
      body: week({ coverage: { complete: false, indexed_from_height: 2_950_000, percent: 42 } }),
    }));
    const c = open();
    await until(() => figures(c).length === 2, 'the charts');
    expect(c.querySelector('.an-chain-note')?.textContent).toContain('Indexing chain history: 42%');
    const meter = c.querySelector('.an-chain-note [role="meter"]');
    expect(meter?.getAttribute('aria-valuenow')).toBe('0.42');
    expect(tile(c, 'Blocks in 7 days').caption).toBe('2,998,996 to 2,999,036, still indexing');
    expect(c.querySelectorAll('.cp-line').length).toBeGreaterThan(0);
  });

  it('does not round an almost finished index up to done', async () => {
    serve(() => ({
      body: week({ coverage: { complete: false, indexed_from_height: 10, percent: 99.96 } }),
    }));
    const c = open();
    await until(() => figures(c).length === 2, 'the charts');
    expect(c.querySelector('.an-chain-note')?.textContent).toContain('Indexing chain history: 99%');
  });

  it('shows no note once the history is whole', async () => {
    serve(() => ({ body: week() }));
    const c = open();
    await until(() => figures(c).length === 2, 'the charts');
    expect(c.querySelector('.an-chain-note')).toBeNull();
  });

  it('says so, without charts, when a window holds no blocks', async () => {
    serve(() => ({
      body: week({
        points: [],
        block_count: 0,
        avg_block_time_s: null,
        latest_difficulty: null,
        from_height: 0,
        to_height: 0,
      }),
    }));
    const c = open();
    await until(
      () => c.textContent?.includes('No blocks recorded for this window yet') === true,
      'the empty state',
    );
    expect(figures(c)).toEqual([]);
    expect(tile(c, 'Blocks in 7 days').caption).toBe('None recorded');
    expect(tile(c, 'Average block time').value).toBe('Unknown');
    expect(tile(c, 'Latest difficulty').value).toBe('Unknown');
    expect(tile(c, 'Latest height').caption).toBe('The chain tip');
    expect(c.textContent).toContain('Pick a longer window');
  });

  it('says nothing is indexed yet, rather than a range of nothing, while the server starts', async () => {
    serve(() => ({
      body: week({
        points: [],
        block_count: 0,
        avg_block_time_s: null,
        latest_difficulty: null,
        coverage: { complete: false, indexed_from_height: null, percent: 0 },
      }),
    }));
    const c = open();
    await until(() => c.textContent?.includes('Indexing chain history: 0%') === true, 'the note');
    expect(tile(c, 'Blocks in 7 days').caption).toBe('Nothing indexed yet');
    expect(c.textContent).toContain('The server is still reading the chain');
    expect(figures(c)).toEqual([]);
  });

  it('offers a retry when the first load fails, and recovers on it', async () => {
    let fail = true;
    const calls = serve(() =>
      fail ? { status: 502, body: { error: { code: 'upstream', message: 'behind' } } } : { body: week() },
    );
    const c = open();
    await until(() => c.querySelector('[role="alert"]') !== null, 'the error');
    expect(figures(c)).toEqual([]);
    expect(c.querySelector('[role="radiogroup"]')).not.toBeNull();
    fail = false;
    const retry = [...c.querySelectorAll('button')].find((b) => b.textContent === 'Retry') as HTMLElement;
    click(retry);
    await until(() => figures(c).length === 2, 'the charts after a retry');
    expect(calls).toHaveLength(2);
    expect(c.querySelector('[role="alert"]')).toBeNull();
  });

  it('is calm about a server that has not recorded the chain yet', async () => {
    serve(() => ({ status: 404, body: { error: { code: 'no_history', message: 'no history' } } }));
    const c = open();
    await until(() => c.textContent?.includes('No chain history yet') === true, 'the no-history state');
    expect(c.querySelector('[role="alert"]')).toBeNull();
    expect(figures(c)).toEqual([]);
  });

  it('does not break on a window name from a newer server: it reads it as the one asked for', async () => {
    serve(() => ({ body: week({ window: '90d' as string as ChainWindow }) }));
    const c = open();
    await until(() => figures(c).length === 2, 'the charts');
    expect(tile(c, 'Blocks in 7 days').value).toBe('40');
    expect(c.querySelector('figure')?.getAttribute('aria-label')).toBe('Difficulty over the last 7 days');
  });

  it('puts a difficulty that moved ten times over on a log scale, and gives no percentage against its median', async () => {
    // Half the week at 22,211, half at 0.13: the median is between the two, and the latest is nowhere near it.
    const wide = chainPoints().map((p, i) => ({
      ...p,
      difficulty: i < 5 ? 22_211 : 0.13,
      difficulty_mean: i < 5 ? 22_211 : 0.12,
    }));
    serve(() => ({ body: week({ points: wide, latest_difficulty: 0.1306 }) }));
    const c = open();
    await until(() => figures(c).length === 2, 'the charts');
    expect(c.querySelector('[data-chart="difficulty"] .cp-note')?.textContent).toBe('Log scale');
    const t = tile(c, 'Latest difficulty');
    expect(t.value).toBe('0.131');
    expect(t.delta).toBe('');
    expect(t.caption).toBe('At the newest block');
  });

  it('has no median to compare with from fewer than three buckets', async () => {
    serve(() => ({ body: week({ points: chainPoints().slice(0, 2) }) }));
    const c = open();
    await until(() => figures(c).length === 2, 'the charts');
    expect(tile(c, 'Latest difficulty').delta).toBe('');
    expect(tile(c, 'Latest difficulty').caption).toBe('At the newest block');
  });

  it('quotes no change in difficulty across the change of rules, and marks it on both charts', async () => {
    const day = (d: number, end: number, h: number) => ({
      t_ms: FORK_MS + d * DAY,
      height: h,
      difficulty: end,
      difficulty_mean: end,
      block_time_s: d < 0 ? 120 : 30,
      block_time_max_s: null,
    });
    const crossing = week({
      window: '1y',
      from_ms: FORK_MS - 20 * DAY,
      to_ms: FORK_MS + 340 * DAY,
      bucket_ms: DAY,
      block_count: 996_000,
      points: [day(-10, 0.3, 1_990_000), day(10, 0.4, 2_050_000)],
    });
    serve((url) => ({ body: url.endsWith('window=1y') ? crossing : week() }));
    const c = open();
    await until(() => figures(c).length === 2, 'the week');
    expect(c.querySelector('.cp-era')).toBeNull();
    click(radio(c, '1Y'));
    await until(() => c.querySelector('.cp-era') !== null && !c.querySelector('[data-stale]'), 'the year');
    // A third more, but between two different things.
    expect(tile(c, 'Latest difficulty').delta).toBe('');
    expect(c.querySelectorAll('.cp-era text')).toHaveLength(2);
    expect([...c.querySelectorAll('.cp-era text')].map((t) => t.textContent)).toEqual([
      'Proof of Node',
      'Proof of Node',
    ]);
  });

  it('keeps the data and says how old it is when a refresh fails', async () => {
    serve(() => ({ body: week() }));
    const c = open();
    await until(() => figures(c).length === 2, 'the charts');
    serve(() => ({ status: 502, body: { error: { code: 'upstream', message: 'behind' } } }));
    await act(async () => {
      await qc.refetchQueries({ queryKey: chainHistoryKey('7d') });
    });
    await until(() => c.querySelector('.ui-qb-stale') !== null, 'the stale notice');
    expect(c.querySelector('.ui-qb-stale')?.textContent).toContain('Could not refresh');
    expect(figures(c)).toEqual(['difficulty', 'block-time']);
    expect(tile(c, 'Latest height').value).toBe('2,999,036');
  });

  it('shows data that arrived before the tab opened without asking for it again', async () => {
    const calls = serve(() => ({ body: week() }));
    qc.setQueryData(chainHistoryKey('7d'), week({ latest_height: 3_000_001 }));
    const c = open();
    await settle(20);
    expect(tile(c, 'Latest height').value).toBe('3,000,001');
    expect(calls).toEqual([]);
  });

  it('reads every bucket the server gave, in time order', async () => {
    const shuffled = chainPoints().reverse();
    serve(() => ({ body: week({ points: shuffled }) }));
    const c = open();
    await until(() => figures(c).length === 2, 'the charts');
    const slider = c.querySelector<HTMLElement>('[data-chart="difficulty"] [role="slider"]');
    expect(slider?.getAttribute('aria-valuemax')).toBe('9');
    // The tooltip's first reading is the newest bucket whatever order the points came in.
    const stamp = new Date(T0 + 18 * 60_000).toISOString().slice(0, 16).replace('T', ' ');
    slider?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    await settle();
    expect(c.querySelector('[data-chart="difficulty"] .cp-tip')?.textContent).toContain(stamp);
  });
});
