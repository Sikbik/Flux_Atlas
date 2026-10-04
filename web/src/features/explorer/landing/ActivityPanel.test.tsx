// @vitest-environment jsdom
// The chain activity panel is a state machine in front of a chart: waiting for the server's first fill, failed, empty,
// ready, and ready with a figure the server did not have. Each is a designed state; none shows a zero in place of an
// unknown. The server is a stand-in for `fetch`.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChainDailyDto } from '../../../api/generated/ChainDailyDto';
import type { ChainDay } from '../../../api/generated/ChainDay';
import { useUi } from '../../../store/ui';
import { click, type Mounted, mount } from '../../../ui/internal/testing';
import { ActivityPanel } from './ActivityPanel';
import { DAY_MS } from './lib/daily';

vi.mock('../../../shell/frame/nav', () => ({ useShellNav: () => ({ open: vi.fn(), go: vi.fn() }) }));

// ---- a stand-in for the server ------------------------------------------------------------------------------

interface Reply {
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
}

const json = ({ status = 200, body, headers = {} }: Reply) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

function serve(answer: (url: string) => Reply | Promise<Reply>) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      return json(await answer(url));
    }),
  );
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

async function until(check: () => boolean, what: string) {
  const end = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await settle(5);
  }
}

// ---- fixtures -------------------------------------------------------------------------------------------------

const D0 = Date.UTC(2026, 8, 1);

function day(i: number, over: Partial<ChainDay> = {}): ChainDay {
  return {
    day_ms: D0 + i * DAY_MS,
    transactions: 40_000 + i * 10,
    blocks: 2880,
    fees: 0.00004,
    fees_total: 0.12 + i / 1000,
    outputs: 3_000_000,
    supply: 430_000_000 + i * 40_320,
    difficulty: 0.1,
    network_hash: 3.66e10,
    ...over,
  };
}

function daily(count = 40, over: (i: number) => Partial<ChainDay> = () => ({})): ChainDailyDto {
  const days = Array.from({ length: count }, (_, i) => day(i, over(i)));
  const last = days[days.length - 1]?.day_ms ?? D0;
  // Built a day and a minute after the start of the last day: every day shown is a whole one.
  return { generated_ms: last + DAY_MS + 60_000, first_day_ms: days[0]?.day_ms ?? null, days };
}

// ---- the panel -------------------------------------------------------------------------------------------------

let qc: QueryClient;
let view: Mounted | null = null;

beforeEach(() => {
  useUi.getState().setMotion('off');
  // Retries are real, but a millisecond apart: the waiting and the failing are told apart without waiting for them.
  qc = new QueryClient({
    defaultOptions: { queries: { retryDelay: 1, gcTime: Number.POSITIVE_INFINITY } },
  });
  // jsdom has no layout: the chart needs a width to draw.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ x: 0, y: 0, left: 0, top: 0, right: 640, bottom: 252, width: 640, height: 252 }) as DOMRect,
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
      <ActivityPanel />
    </QueryClientProvider>,
  );
  return view.container;
}

const panel = (c: HTMLElement) => c.querySelector<HTMLElement>('#ex-activity');
const tiles = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('.ex-act__tile')];
const tile = (c: HTMLElement, label: string) =>
  tiles(c).find((t) => t.querySelector('.ui-stat__label')?.textContent === label);
const radio = (c: HTMLElement, label: string) =>
  [...c.querySelectorAll<HTMLElement>('[role="radio"]')].find((r) => r.textContent === label);

describe('ActivityPanel', () => {
  it('asks for a year first, and holds the shape of the answer until it comes', async () => {
    const g = gate();
    const calls = serve(() => g.reply);
    const c = open();
    await settle();
    expect(calls).toEqual(['/api/v1/chain/daily?days=365']);
    expect(panel(c)?.getAttribute('data-state')).toBe('loading');
    expect(panel(c)?.getAttribute('aria-busy')).toBe('true');
    expect(c.querySelector('h2')?.textContent).toBe('Chain activity');
    expect(radio(c, '1Y')?.getAttribute('aria-checked')).toBe('true');
    expect([...c.querySelectorAll('[role="radio"]')].map((r) => r.textContent)).toEqual([
      '30D',
      '90D',
      '1Y',
      '2Y',
    ]);
    // Five tiles of skeleton, no chart yet, and no claim about the wait.
    expect(c.querySelectorAll('.ex-act__skeleton .ui-stat')).toHaveLength(5);
    expect(c.querySelector('.ex-act__wait')).toBeNull();
    g.open({ body: daily() });
    await until(() => panel(c)?.getAttribute('data-state') === 'ready', 'the panel');
  });

  it('waits in words while the server says it is still reading the chain, and does not call it an error', async () => {
    serve(() => ({
      status: 503,
      body: { error: { code: 'unavailable', message: 'filling' } },
      headers: { 'retry-after': '5' },
    }));
    const c = open();
    await until(() => c.querySelector('.ex-act__wait') !== null, 'the waiting note');
    expect(c.querySelector('.ex-act__wait')?.textContent).toContain('first time');
    expect(c.querySelector('.ex-act__wait')?.getAttribute('role')).toBe('status');
    expect(panel(c)?.getAttribute('data-state')).toBe('loading');
    expect(c.querySelector('[role="alert"]')).toBeNull();
  });

  it('says what failed, once, with a Retry that asks again', async () => {
    let fail = true;
    const calls = serve(() =>
      fail ? { status: 502, body: { error: { code: 'upstream', message: 'behind' } } } : { body: daily() },
    );
    const c = open();
    await until(() => c.querySelector('[role="alert"]') !== null, 'the error');
    expect(c.querySelector('[role="alert"]')?.textContent).toContain('Could not load the chain activity');
    expect(panel(c)?.getAttribute('data-state')).toBe('error');
    // The heading and the way on stay.
    expect(c.querySelector('h2')?.textContent).toBe('Chain activity');
    expect(c.textContent).toContain('Open in analytics');
    fail = false;
    const before = calls.length;
    const retry = [...c.querySelectorAll('button')].find((b) => b.textContent === 'Retry');
    expect(retry).toBeDefined();
    if (retry) click(retry);
    await until(() => panel(c)?.getAttribute('data-state') === 'ready', 'the panel');
    expect(calls.length).toBeGreaterThan(before);
  });

  it('says so when the server has no days at all', async () => {
    serve(() => ({ body: { generated_ms: D0, first_day_ms: null, days: [] } }));
    const c = open();
    await until(() => panel(c)?.getAttribute('data-state') === 'empty', 'the empty state');
    expect(c.textContent).toContain('No daily figures yet');
    expect(c.querySelector('.ex-act')).toBeNull();
  });

  it('ready: five tiles, the first drawn, and the same numbers as a table on request', async () => {
    serve(() => ({ body: daily() }));
    const c = open();
    await until(() => panel(c)?.getAttribute('data-state') === 'ready', 'the panel');
    expect(tiles(c).map((t) => t.querySelector('.ui-stat__label')?.textContent)).toEqual([
      'Transactions',
      'Fees',
      'FLUX moved',
      'Blocks',
      'Supply',
    ]);
    expect(tiles(c).map((t) => t.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
      'false',
      'false',
    ]);
    expect(c.querySelector('.ex-act__title')?.textContent).toBe('Transactions a day');
    // The chart is read by the keyboard and has its numbers as text.
    expect(c.querySelector('[role="slider"]')).not.toBeNull();
    expect(c.textContent).toContain('Show data');
    expect(c.textContent).toContain('Why there is no difficulty or hash rate');
    expect(c.textContent).toContain('Open in analytics');
  });

  it('draws the figure you choose, and only one at a time', async () => {
    serve(() => ({ body: daily() }));
    const c = open();
    await until(() => panel(c)?.getAttribute('data-state') === 'ready', 'the panel');
    const fees = tile(c, 'Fees');
    expect(fees).toBeDefined();
    if (fees) click(fees);
    await settle();
    expect(tiles(c).map((t) => t.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
      'false',
      'false',
    ]);
    expect(c.querySelector('.ex-act__title')?.textContent).toBe('Fees paid a day');
  });

  it('asks for the range you choose, and keeps the last chart on screen, dimmed, until it comes', async () => {
    const second = gate();
    const calls = serve((url) => (url.includes('days=30') ? second.reply : { body: daily() }));
    const c = open();
    await until(() => panel(c)?.getAttribute('data-state') === 'ready', 'the panel');
    const thirty = radio(c, '30D');
    if (thirty) click(thirty);
    await settle();
    expect(calls).toContain('/api/v1/chain/daily?days=30');
    expect(c.querySelector('.ex-act')?.getAttribute('data-stale')).toBe('true');
    expect(c.querySelector('.ex-act')?.getAttribute('aria-busy')).toBe('true');
    expect(c.querySelector('[role="slider"]')).not.toBeNull();
    second.open({ body: daily(30) });
    await until(() => c.querySelector('.ex-act')?.getAttribute('data-stale') === null, 'the new range');
    expect(radio(c, '30D')?.getAttribute('aria-checked')).toBe('true');
  });

  it('a figure the server did not have is Unknown, never zero, and the chart says there is nothing to draw', async () => {
    serve(() => ({ body: daily(40, () => ({ fees: null, fees_total: null })) }));
    const c = open();
    await until(() => panel(c)?.getAttribute('data-state') === 'ready', 'the panel');
    const fees = tile(c, 'Fees');
    expect(fees?.textContent).toContain('Unknown');
    expect(fees?.querySelector('.ui-stat__value')?.textContent).not.toMatch(/^0/);
    if (fees) click(fees);
    await settle();
    expect(c.textContent).toContain('Nothing to draw');
    expect(c.querySelector('[role="slider"]')).toBeNull();
  });
});
