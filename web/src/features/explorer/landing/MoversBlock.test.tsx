// @vitest-environment jsdom
// The movers block is a state machine in front of a list: tracking (fewer than two daily pictures), ready, quiet, loading
// and failed. Each is a designed state, and none of them is an empty list.

import { describe, expect, it, vi } from 'vitest';
import type { RichEntered } from '../../../api/generated/RichEntered';
import type { RichMove } from '../../../api/generated/RichMove';
import type { RichMoversDto } from '../../../api/generated/RichMoversDto';
import { ApiError } from '../../../api/http';
import { click, mount } from '../../../ui/internal/testing';
import { DAY_MS } from './lib/daily';
import { MoversBlock, type MoversBlockProps } from './MoversBlock';

const T = Date.UTC(2026, 9, 4);
const addr = (n: number) => `t1${String(n).padStart(33, 'q')}`;

const move = (n: number, balance: number, prev: number, rank: number, prevRank: number): RichMove => ({
  address: addr(n),
  rank,
  prev_rank: prevRank,
  balance: balance.toFixed(8),
  prev_balance: prev.toFixed(8),
  delta: (balance - prev).toFixed(8),
  node_count: 0,
});

const entered = (n: number, rank: number): RichEntered => ({
  address: addr(n),
  rank,
  balance: '120000.00000000',
  node_count: 0,
});

function dto(over: Partial<RichMoversDto> = {}): RichMoversDto {
  return {
    window: '7d',
    to_ms: T,
    from_ms: T - 7 * DAY_MS,
    snapshots: 8,
    gainers: [],
    losers: [],
    entered: [],
    left: [],
    concentration: [],
    ...over,
  };
}

type Q = MoversBlockProps['query'];
const ready = (data: RichMoversDto): Q => ({
  data,
  isPending: false,
  isError: false,
  error: null,
  refetch: vi.fn() as unknown as Q['refetch'],
  isFetching: false,
});

function props(query: Q, over: Partial<MoversBlockProps> = {}): MoversBlockProps {
  return { query, window: '7d', onWindow: () => undefined, variant: 'card', ...over };
}

describe('MoversBlock', () => {
  it('tracking: says the movers appear after the second daily snapshot, and offers no window to choose', () => {
    const m = mount(<MoversBlock {...props(ready(dto({ snapshots: 1, from_ms: null })))} />);
    expect(m.container.textContent).toContain('Movers appear after the second daily snapshot');
    expect(m.container.querySelector('[role="radiogroup"], [role="tablist"]')).toBeNull();
    expect(m.container.querySelector('[role="alert"]')).toBeNull();
    expect(m.container.querySelector('.ex-movers__head')?.textContent).toBe('Movers');
    m.unmount();
  });

  it('tracking, on the page: the section already says "Movers", so the block adds no head', () => {
    const m = mount(
      <MoversBlock {...props(ready(dto({ snapshots: 0, from_ms: null })), { variant: 'page' })} />,
    );
    expect(m.container.querySelector('.ex-movers__head')).toBeNull();
    expect(m.container.textContent).toContain('Movers appear after the second daily snapshot');
    m.unmount();
  });

  it('ready: names the window, the comparison and the largest movers in each direction', () => {
    const data = dto({
      gainers: [move(1, 300_000, 100_000, 6, 12), move(2, 210_000, 100_000, 8, 5)],
      losers: [move(3, 100_000, 400_000, 9, 1)],
      entered: [entered(4, 40)],
      left: [],
    });
    const m = mount(<MoversBlock {...props(ready(data))} />);
    expect(m.container.querySelector('.ex-movers__title')?.textContent).toBe('Movers over a week');
    expect(m.container.querySelector('.ex-movers__span')?.textContent).toContain('7 days earlier');
    const gain = Array.from(m.container.querySelectorAll('[data-tone="gain"].ex-mv'));
    expect(gain).toHaveLength(2);
    expect(gain[0]?.textContent).toContain('+200K');
    expect(gain[0]?.querySelector('.ui-sr-only')?.textContent).toBe('up 6 places: ');
    const loss = m.container.querySelector('[data-tone="loss"].ex-mv');
    expect(loss?.textContent).toContain('-300K');
    expect(m.container.querySelector('.ex-movers__flow')?.textContent).toBe(
      '1 entered the ranking and 0 left it.',
    );
    m.unmount();
  });

  it('ready: a card shows three of each, the page ten', () => {
    const many = Array.from({ length: 12 }, (_, i) => move(i + 1, 200_000 + i * 1000, 100_000, i + 2, i + 3));
    const card = mount(<MoversBlock {...props(ready(dto({ gainers: many })))} />);
    expect(card.container.querySelectorAll('[data-tone="gain"].ex-mv')).toHaveLength(3);
    card.unmount();
    const page = mount(<MoversBlock {...props(ready(dto({ gainers: many })), { variant: 'page' })} />);
    expect(page.container.querySelectorAll('[data-tone="gain"].ex-mv')).toHaveLength(10);
    page.unmount();
  });

  it('ready, on the page: the entered list is short and opens to the whole one', () => {
    const ins = Array.from({ length: 14 }, (_, i) => entered(i + 1, i + 30));
    const m = mount(
      <MoversBlock
        {...props(ready(dto({ gainers: [move(99, 2, 1, 1, 2)], entered: ins })), { variant: 'page' })}
      />,
    );
    const rows = () => m.container.querySelectorAll('.ex-mvs__list .ex-mv[data-tone="neutral"]').length;
    expect(rows()).toBe(10);
    const more = Array.from(m.container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Show all 14',
    );
    expect(more?.getAttribute('aria-expanded')).toBe('false');
    if (more) click(more);
    expect(rows()).toBe(14);
    expect(more?.textContent).toBe('Show fewer');
    expect(more?.getAttribute('aria-expanded')).toBe('true');
    m.unmount();
  });

  it('quiet: says that nothing moved, rather than showing two empty lists', () => {
    const m = mount(<MoversBlock {...props(ready(dto()))} />);
    expect(m.container.textContent).toContain('No address gained, lost, entered or left over this window.');
    expect(m.container.querySelector('.ex-mvs')).toBeNull();
    m.unmount();
  });

  it('partial: says when the server has not kept as many days as the window asks for', () => {
    const m = mount(
      <MoversBlock {...props(ready(dto({ from_ms: T - 2 * DAY_MS, gainers: [move(1, 2, 1, 1, 2)] })))} />,
    );
    expect(m.container.querySelector('.ex-movers__span')?.textContent).toContain(
      'The server has not kept a week of pictures yet.',
    );
    m.unmount();
  });

  it('hands the window the reader picks to the caller', () => {
    const onWindow = vi.fn();
    const m = mount(<MoversBlock {...props(ready(dto()), { onWindow })} />);
    const thirty = Array.from(m.container.querySelectorAll('button, [role="radio"], [role="tab"]')).find(
      (b) => b.textContent === '30D',
    );
    expect(thirty).toBeDefined();
    if (thirty) click(thirty);
    expect(onWindow).toHaveBeenCalledWith('30d');
    m.unmount();
  });

  it('loading: a hidden skeleton of the rows, and no claim yet', () => {
    const q: Q = { ...ready(dto()), data: undefined, isPending: true };
    const m = mount(<MoversBlock {...props(q)} />);
    expect(m.container.querySelector('.ex-movers__skeleton')?.getAttribute('aria-hidden')).toBe('true');
    expect(m.container.querySelector('[role="alert"]')).toBeNull();
    m.unmount();
  });

  it('failed: an alert with a Retry that asks again', () => {
    const refetch = vi.fn();
    const q: Q = {
      ...ready(dto()),
      data: undefined,
      isPending: false,
      isError: true,
      error: new ApiError('upstream', 'behind', 502, '/api/v1/richlist/movers'),
      refetch: refetch as unknown as Q['refetch'],
    };
    const m = mount(<MoversBlock {...props(q)} />);
    expect(m.container.querySelector('[role="alert"]')?.textContent).toContain('Could not load the movers');
    const retry = Array.from(m.container.querySelectorAll('button')).find((b) => b.textContent === 'Retry');
    if (retry) click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
    m.unmount();
  });

  it('keeps the last answer on screen, dimmed, while the next window is read', () => {
    const q: Q = { ...ready(dto({ gainers: [move(1, 2, 1, 1, 2)] })), isFetching: true };
    const m = mount(<MoversBlock {...props(q)} />);
    expect(m.container.querySelector('.ex-movers')?.getAttribute('data-stale')).toBe('true');
    expect(m.container.querySelector('.ex-mv')).not.toBeNull();
    m.unmount();
  });
});
