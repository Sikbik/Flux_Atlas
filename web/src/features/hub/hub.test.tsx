// @vitest-environment jsdom
// The shared frame of the hub windows: the panel and its four states, the leaderboard, the nav and the links. The
// links open windows through the shell's navigation, which is stubbed here so no router is needed.

import { Box } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import { click, mount } from '../../ui/internal/testing';
import { balancedColumns, rowPlan } from './columns';
import { HubFigure, HubFigures, HubHero } from './HubHero';
import { HubButton, HubLink, HubTile, HubTiles, tileLayout } from './HubLink';
import { HubNav } from './HubNav';
import { HubPanel } from './HubPanel';
import { LbBar, Leaderboard } from './Leaderboard';

const nav = vi.hoisted(() => ({
  open: vi.fn(),
  go: vi.fn(),
}));

vi.mock('../../shell/frame/nav', () => ({ useShellNav: () => nav }));

afterEach(() => {
  nav.open.mockReset();
  nav.go.mockReset();
});

describe('HubPanel', () => {
  it('is a labelled section: the title is its heading and the body is its children', () => {
    const m = mount(
      <HubPanel title="Latest blocks" icon={Box} aside="newest first">
        <div data-testid="rows" />
      </HubPanel>,
    );
    const section = m.container.querySelector('section');
    const heading = m.container.querySelector('h2');
    expect(heading?.textContent).toBe('Latest blocks');
    expect(section?.getAttribute('aria-labelledby')).toBe(heading?.id);
    expect(section?.getAttribute('data-state')).toBe('ready');
    expect(section?.getAttribute('aria-busy')).toBeNull();
    expect(m.container.querySelector('.hub-panel__aside')?.textContent).toBe('newest first');
    expect(m.container.querySelector('.hub-panel__body [data-testid="rows"]')).not.toBeNull();
    m.unmount();
  });

  it('takes its place in the grid from span and fill, and its heading level from level', () => {
    const m = mount(
      <HubPanel title="Mempool" span="third" fill="row" level={3}>
        x
      </HubPanel>,
    );
    const section = m.container.querySelector('section');
    expect(section?.getAttribute('data-span')).toBe('third');
    expect(section?.getAttribute('data-fill')).toBe('row');
    expect(m.container.querySelector('h3')?.textContent).toBe('Mempool');
    expect(m.container.querySelector('h2')).toBeNull();
    m.unmount();
  });

  it('loading: busy, the skeleton instead of the body, and no footer', () => {
    const m = mount(
      <HubPanel
        title="Operators"
        state="loading"
        skeleton={<div data-testid="skel" />}
        footer={<a href="/x">Open</a>}
      >
        <div data-testid="rows" />
      </HubPanel>,
    );
    expect(m.container.querySelector('section')?.getAttribute('aria-busy')).toBe('true');
    expect(m.container.querySelector('[data-testid="skel"]')).not.toBeNull();
    expect(m.container.querySelector('[data-testid="rows"]')).toBeNull();
    expect(m.container.querySelector('.hub-panel__foot')).toBeNull();
    expect(m.container.querySelector('h2')?.textContent).toBe('Operators');
    m.unmount();
  });

  it('error: the heading stays, the failure is announced, and Retry asks again', () => {
    const onRetry = vi.fn();
    const m = mount(
      <HubPanel
        title="Operators"
        state="error"
        error={new ApiError('upstream', 'behind', 502, '/api/v1/network/operators')}
        onRetry={onRetry}
        footer={<a href="/x">Open</a>}
      >
        <div data-testid="rows" />
      </HubPanel>,
    );
    expect(m.container.querySelector('h2')?.textContent).toBe('Operators');
    expect(m.container.querySelector('[role="alert"]')).not.toBeNull();
    expect(m.container.querySelector('[data-testid="rows"]')).toBeNull();
    const retry = Array.from(m.container.querySelectorAll('button')).find((b) => b.textContent === 'Retry');
    expect(retry).toBeDefined();
    if (retry) click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
    m.unmount();
  });

  it('error: the words of the caller replace the derived ones', () => {
    const m = mount(
      <HubPanel
        title="Movers"
        state="error"
        errorTitle="Movers could not be read"
        errorText="Try again soon."
      >
        x
      </HubPanel>,
    );
    expect(m.container.querySelector('[role="alert"]')?.textContent).toContain('Movers could not be read');
    expect(m.container.querySelector('[role="alert"]')?.textContent).toContain('Try again soon.');
    m.unmount();
  });

  it('empty: says what is missing instead of a blank body', () => {
    const m = mount(
      <HubPanel
        title="Expiring"
        state="empty"
        emptyTitle="Nothing expires soon"
        emptyText="All apps are renewed."
      >
        <div data-testid="rows" />
      </HubPanel>,
    );
    expect(m.container.querySelector('section')?.getAttribute('data-state')).toBe('empty');
    expect(m.container.textContent).toContain('Nothing expires soon');
    expect(m.container.textContent).toContain('All apps are renewed.');
    expect(m.container.querySelector('[data-testid="rows"]')).toBeNull();
    m.unmount();
  });

  it('keeps the footer under a body that is there, and flushes a table to the edges', () => {
    const m = mount(
      <HubPanel title="Newest" flush footer={<a href="/x">Open the list</a>}>
        <div data-testid="rows" />
      </HubPanel>,
    );
    expect(m.container.querySelector('section')?.getAttribute('data-flush')).toBe('true');
    expect(m.container.querySelector('.hub-panel__foot a')?.textContent).toBe('Open the list');
    m.unmount();
  });
});

interface Op {
  id: string;
  name: string;
  nodes: number;
}

const OPS: Op[] = [
  { id: 'a', name: 'Alpha', nodes: 424 },
  { id: 'b', name: 'Bravo', nodes: 310 },
  { id: 'c', name: 'Charlie', nodes: 120 },
  { id: 'd', name: 'Delta', nodes: 40 },
];

function board(over: Partial<Parameters<typeof Leaderboard<Op>>[0]> = {}) {
  return (
    <Leaderboard<Op>
      label="Top operators"
      rows={OPS}
      rowKey={(r) => r.id}
      rank={(_, i) => i + 1}
      identity={(r) => r.name}
      identitySub={(r) => `${r.nodes} nodes`}
      to={(r) => ({ type: 'operator', key: r.id })}
      linkLabel={(r) => `Open operator ${r.name}`}
      columns={[
        { id: 'nodes', header: 'Nodes', width: '72px', align: 'end', cell: (r) => r.nodes },
        { id: 'share', header: 'Share', width: '96px', hide: 'compact', cell: (r) => `${r.nodes / 10}%` },
      ]}
      {...over}
    />
  );
}

describe('Leaderboard', () => {
  it('keeps a track for every column a medium panel still shows: compact columns go, narrow ones stay', () => {
    const m = mount(
      board({
        columns: [
          { id: 'nodes', header: 'Nodes', width: '72px', cell: (r) => r.nodes },
          { id: 'share', header: 'Share', width: '96px', hide: 'narrow', cell: (r) => `${r.nodes / 10}%` },
          { id: 'rate', header: 'Rate', width: '64px', hide: 'compact', cell: (r) => r.nodes * 2 },
        ],
      }),
    );
    const lb = m.container.querySelector<HTMLElement>('.hub-lb');
    expect(lb?.style.getPropertyValue('--lb-cols')).toBe('2.25rem minmax(0, 1.5fr) 72px 96px 64px 0px');
    expect(lb?.style.getPropertyValue('--lb-cols-compact')).toBe('2.25rem minmax(0, 1.5fr) 72px 96px 0px');
    m.unmount();
  });

  it('is an ordered list named for assistive technology, one item per row', () => {
    const m = mount(board());
    const list = m.container.querySelector('ol');
    expect(list?.getAttribute('aria-label')).toBe('Top operators');
    expect(m.container.querySelectorAll('li.hub-lb__row')).toHaveLength(4);
    expect(Array.from(m.container.querySelectorAll('.hub-lb__rank')).map((e) => e.textContent)).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);
    m.unmount();
  });

  it('makes each row a real link that says its rank and what it opens', () => {
    const m = mount(board());
    const links = Array.from(m.container.querySelectorAll<HTMLAnchorElement>('a.hub-lb__link'));
    expect(links.map((a) => a.getAttribute('aria-label'))).toEqual([
      '1. Open operator Alpha',
      '2. Open operator Bravo',
      '3. Open operator Charlie',
      '4. Open operator Delta',
    ]);
    expect(links[0]?.textContent).toBe('Alpha');
    expect(links[0]?.getAttribute('href')).toContain('operator');
    m.unmount();
  });

  it('opens the row as a window on a plain click, and leaves a modified click to the browser', () => {
    const m = mount(board());
    const link = m.container.querySelector<HTMLAnchorElement>('a.hub-lb__link');
    if (!link) throw new Error('no link');
    click(link);
    expect(nav.open).toHaveBeenCalledWith({ type: 'operator', key: 'a' });
    nav.open.mockReset();
    // jsdom cannot navigate: cancel what the browser would have done after the handler has had its say.
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener('click', stop);
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    document.removeEventListener('click', stop);
    expect(nav.open).not.toHaveBeenCalled();
    m.unmount();
  });

  it('gives every figure its column name for a screen reader', () => {
    const m = mount(board());
    const first = m.container.querySelector('li.hub-lb__row');
    const cells = Array.from(first?.querySelectorAll('.hub-lb__cell') ?? []).map((c) => c.textContent);
    expect(cells).toEqual(['Nodes: 424', 'Share: 42.4%']);
    expect(first?.querySelector('.hub-lb__sub')?.textContent).toBe('424 nodes');
    m.unmount();
  });

  it('marks the podium, and only the podium', () => {
    const m = mount(board());
    const tops = Array.from(m.container.querySelectorAll('li.hub-lb__row')).map((r) =>
      r.getAttribute('data-top'),
    );
    expect(tops).toEqual(['1', '2', '3', null]);
    m.unmount();
  });

  it('lays the columns on one grid, and drops the hidden ones with their tracks in a medium panel', () => {
    const m = mount(board());
    const root = m.container.querySelector<HTMLElement>('.hub-lb');
    expect(root?.style.getPropertyValue('--lb-cols')).toBe('2.25rem minmax(0, 1.5fr) 72px 96px 0px');
    expect(root?.style.getPropertyValue('--lb-cols-compact')).toBe('2.25rem minmax(0, 1.5fr) 72px 0px');
    m.unmount();
  });

  it('adds a track for the extra links when a row has them, and renders them beside the row', () => {
    const m = mount(board({ actions: (r) => <a href={`/w/${r.id}`}>Wallet {r.name}</a> }));
    const root = m.container.querySelector<HTMLElement>('.hub-lb');
    expect(root?.style.getPropertyValue('--lb-cols')).toBe('2.25rem minmax(0, 1.5fr) 72px 96px auto');
    expect(m.container.querySelectorAll('.hub-lb__acts a')).toHaveLength(4);
    expect(m.container.querySelector('.hub-lb__acts a')?.textContent).toBe('Wallet Alpha');
    m.unmount();
  });

  it('keeps the header row out of the reading order: the cells carry the names', () => {
    const m = mount(board());
    expect(m.container.querySelector('.hub-lb__head')?.getAttribute('aria-hidden')).toBe('true');
    m.unmount();
  });

  it('shows no rows for an empty list, but stays a list', () => {
    const m = mount(board({ rows: [] }));
    expect(m.container.querySelector('ol')?.children).toHaveLength(0);
    m.unmount();
  });
});

describe('LbBar', () => {
  const frac = (m: ReturnType<typeof mount>) =>
    m.container.querySelector<HTMLElement>('.hub-lbbar__track i')?.style.getPropertyValue('--frac');

  it('shows the figure as text and the comparison as a bar that is hidden from a screen reader', () => {
    const m = mount(<LbBar value={0.25} text="25%" />);
    expect(m.container.querySelector('.hub-lbbar__text')?.textContent).toBe('25%');
    expect(m.container.querySelector('.hub-lbbar__track')?.getAttribute('aria-hidden')).toBe('true');
    expect(frac(m)).toBe('0.25');
    m.unmount();
  });

  it('measures against max, and stays inside the track', () => {
    const half = mount(<LbBar value={50} max={200} text="50" />);
    expect(frac(half)).toBe('0.25');
    half.unmount();
    const over = mount(<LbBar value={3} max={2} text="3" />);
    expect(frac(over)).toBe('1');
    over.unmount();
    const under = mount(<LbBar value={-1} text="-1" />);
    expect(frac(under)).toBe('0');
    under.unmount();
  });

  it('is empty, not broken, against a max of zero', () => {
    const m = mount(<LbBar value={5} max={0} text="5" />);
    expect(frac(m)).toBe('0');
    m.unmount();
  });
});

describe('HubNav', () => {
  const items = [
    { id: 'explorer', label: 'Explorer', to: { type: 'explorer', key: null } as const },
    { id: 'latest', label: 'Latest block', to: { type: 'block', key: '3007909' } as const, hidden: true },
    { id: 'mempool', label: 'Mempool', to: { type: 'mempool', key: null } as const },
    { id: 'richlist', label: 'Rich list', to: '/richlist' },
  ];

  it('is a labelled list of real links', () => {
    const m = mount(<HubNav label="Explorer" items={items} current="mempool" />);
    expect(m.container.querySelector('nav')?.getAttribute('aria-label')).toBe('Explorer');
    const links = Array.from(m.container.querySelectorAll<HTMLAnchorElement>('a'));
    expect(links.map((a) => a.textContent)).toEqual(['Explorer', 'Mempool', 'Rich list']);
    expect(links.every((a) => a.getAttribute('href')?.startsWith('/'))).toBe(true);
    m.unmount();
  });

  it('marks the page you are on, and only that one', () => {
    const m = mount(<HubNav label="Explorer" items={items} current="mempool" />);
    const current = Array.from(m.container.querySelectorAll('a[aria-current]'));
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toBe('Mempool');
    expect(current[0]?.getAttribute('aria-current')).toBe('page');
    m.unmount();
  });

  it('marks nothing when the page is none of them, and leaves out the links that have nowhere to go', () => {
    const m = mount(<HubNav label="Explorer" items={items} />);
    expect(m.container.querySelector('a[aria-current]')).toBeNull();
    expect(m.container.textContent).not.toContain('Latest block');
    m.unmount();
  });
});

describe('HubLink, HubTile and HubButton', () => {
  it('HubLink is a link with a trailing glyph that a screen reader skips', () => {
    const m = mount(<HubLink to="/richlist">Open the rich list</HubLink>);
    const a = m.container.querySelector('a');
    expect(a?.textContent).toBe('Open the rich list');
    expect(a?.getAttribute('href')).toBe('/richlist');
    expect(a?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    m.unmount();
  });

  it('HubTiles is a named nav of tiles; a tile is a link with a live line, and can be the emphasised one', () => {
    const m = mount(
      <HubTiles label="Quick links">
        <HubTile icon={Box} title="Latest block" caption="Block 3,007,909" to="/block/3007909" />
        <HubTile icon={Box} title="Rich list" caption="Top 10 hold 56%" to="/richlist" emphasis />
      </HubTiles>,
    );
    expect(m.container.querySelector('nav')?.getAttribute('aria-label')).toBe('Quick links');
    const tiles = Array.from(m.container.querySelectorAll('a.hub-tile'));
    expect(tiles).toHaveLength(2);
    expect(tiles[0]?.querySelector('.hub-tile__title')?.textContent).toBe('Latest block');
    expect(tiles[0]?.querySelector('.hub-tile__caption')?.textContent).toBe('Block 3,007,909');
    expect(tiles[0]?.getAttribute('data-emphasis')).toBeNull();
    expect(tiles[1]?.getAttribute('data-emphasis')).toBe('true');
    m.unmount();
  });

  it('a tile without a caption has no empty line under its title', () => {
    const m = mount(<HubTile icon={Box} title="Supply" to="/supply" />);
    expect(m.container.querySelector('.hub-tile__caption')).toBeNull();
    m.unmount();
  });

  it('HubButton wears the kit button and still goes where the window manager says', () => {
    const m = mount(
      <HubButton variant="primary" icon={Box} to={{ type: 'block', key: '3007909' }}>
        Latest block
      </HubButton>,
    );
    const a = m.container.querySelector('a');
    expect(a?.className).toContain('ui-button');
    expect(a?.getAttribute('data-variant')).toBe('primary');
    expect(a?.getAttribute('data-size')).toBe('md');
    expect(a?.querySelector('.ui-button__label')?.textContent).toBe('Latest block');
    if (a) click(a);
    expect(nav.open).toHaveBeenCalledWith({ type: 'block', key: '3007909' });
    m.unmount();
  });
});

describe('HubTiles', () => {
  const FIVE = ['One', 'Two', 'Three', 'Four', 'Five'];

  it('hands the list its columns and each tile its span, and does not count one that is not drawn', () => {
    const m = mount(
      <HubTiles label="Quick links">
        <HubTile icon={Box} title="One" to="/a" />
        <HubTile icon={Box} title="Two" to="/b" />
        {null}
        <HubTile icon={Box} title="Three" to="/c" />
        <HubTile icon={Box} title="Four" to="/d" />
        <HubTile icon={Box} title="Five" to="/e" />
      </HubTiles>,
    );
    const ul = m.container.querySelector<HTMLElement>('ul.hub-tiles');
    expect(ul?.style.getPropertyValue('--tiles-s')).toBe('2');
    expect(ul?.style.getPropertyValue('--tiles-l')).toBe('6');
    expect(ul?.style.getPropertyValue('--tiles-xl')).toBe('5');
    const items = [...m.container.querySelectorAll<HTMLElement>('li.hub-tiles__item')];
    expect(items).toHaveLength(5);
    expect(items.map((li) => li.style.getPropertyValue('--span-m'))).toEqual(['2', '2', '2', '3', '3']);
    expect(items.map((li) => li.style.getPropertyValue('--span-s'))).toEqual(['1', '1', '1', '1', '2']);
    expect(items.map((li) => li.style.getPropertyValue('--span-xl'))).toEqual(['1', '1', '1', '1', '1']);
    m.unmount();
  });

  it('puts the first tile first on a phone when it is the emphasised one', () => {
    const m = mount(
      <HubTiles label="Quick links">
        {FIVE.map((title, i) => (
          <HubTile key={title} icon={Box} title={title} to={`/${i}`} emphasis={i === 0} />
        ))}
      </HubTiles>,
    );
    const items = [...m.container.querySelectorAll<HTMLElement>('li.hub-tiles__item')];
    expect(items.map((li) => li.style.getPropertyValue('--span-s'))).toEqual(['2', '1', '1', '1', '1']);
    m.unmount();
  });

  it('keeps the tiles in a list of items, each holding its own link', () => {
    const m = mount(
      <HubTiles label="Quick links">
        <HubTile icon={Box} title="One" to="/a" />
        <HubTile icon={Box} title="Two" to="/b" />
      </HubTiles>,
    );
    const items = m.container.querySelectorAll('ul > li.hub-tiles__item > a.hub-tile');
    expect(items).toHaveLength(2);
    expect(m.container.querySelector('nav')?.getAttribute('aria-label')).toBe('Quick links');
    m.unmount();
  });

  it('holds a tile whose target is not known as plain text, in its place, until it is', () => {
    const tiles = (height: number | null) => (
      <HubTiles label="Quick links">
        <HubTile
          icon={Box}
          title="Latest block"
          caption={height === null ? 'Reading the chain tip' : `Block ${height}`}
          to={{ type: 'block', key: String(height ?? 0) }}
          pending={height === null}
        />
        <HubTile icon={Box} title="Mempool" to="/mempool" />
      </HubTiles>
    );
    const m = mount(tiles(null));
    const first = m.container.querySelector('li.hub-tiles__item');
    expect(first?.querySelector('a')).toBeNull();
    expect(first?.querySelector('.hub-tile[data-pending]')).not.toBeNull();
    expect(m.container.querySelectorAll('li.hub-tiles__item')).toHaveLength(2);
    m.rerender(tiles(3007909));
    const link = m.container.querySelector('li.hub-tiles__item a.hub-tile');
    expect(link?.textContent).toContain('Block 3007909');
    expect(m.container.querySelectorAll('li.hub-tiles__item')).toHaveLength(2);
    m.unmount();
  });

  it("puts a space between a tile's title and its line so a screen reader does not read them as one word", () => {
    const m = mount(
      <HubTiles label="Quick links">
        <HubTile icon={Box} title="Top owners" caption="47 owners" to="/apps#owners" />
      </HubTiles>,
    );
    expect(m.container.querySelector('.hub-tile__text')?.textContent).toBe('Top owners 47 owners');
    m.unmount();
  });
});

describe('balancedColumns', () => {
  it('lays five figures five across, or three and two, never four and one', () => {
    expect(balancedColumns(5, 5)).toBe(5);
    expect(balancedColumns(5, 4)).toBe(3);
    expect(balancedColumns(5, 3)).toBe(3);
  });

  it('lays four figures four across, or two and two', () => {
    expect(balancedColumns(4, 5)).toBe(4);
    expect(balancedColumns(4, 3)).toBe(2);
  });

  it('keeps the wider layout of two that leave the same holes', () => {
    expect(balancedColumns(6, 3)).toBe(3);
    expect(balancedColumns(7, 5)).toBe(4);
    expect(balancedColumns(3, 2)).toBe(2);
  });

  it('never goes past the columns that fit, or past the figures there are', () => {
    expect(balancedColumns(2, 5)).toBe(2);
    expect(balancedColumns(3, 5)).toBe(3);
    expect(balancedColumns(12, 5)).toBeLessThanOrEqual(5);
  });

  it('is one column for one figure or none', () => {
    expect(balancedColumns(1, 5)).toBe(1);
    expect(balancedColumns(0, 5)).toBe(1);
  });
});

describe('rowPlan', () => {
  it('is one row of equal things when they all fit across', () => {
    expect(rowPlan(5, 5)).toEqual({ sub: 5, spans: [1, 1, 1, 1, 1] });
    expect(rowPlan(3, 3)).toEqual({ sub: 3, spans: [1, 1, 1] });
  });

  it('shares a last row of fewer things evenly: three over two is a grid of six', () => {
    expect(rowPlan(5, 3)).toEqual({ sub: 6, spans: [2, 2, 2, 3, 3] });
    expect(rowPlan(7, 4)).toEqual({ sub: 12, spans: [3, 3, 3, 3, 4, 4, 4] });
  });

  it('fills a last row of one thing, and puts it last by default', () => {
    expect(rowPlan(5, 2)).toEqual({ sub: 2, spans: [1, 1, 1, 1, 2] });
  });

  it('puts the single thing first when asked to lead, and only in two columns', () => {
    expect(rowPlan(5, 2, true)).toEqual({ sub: 2, spans: [2, 1, 1, 1, 1] });
    expect(rowPlan(4, 2, true)).toEqual({ sub: 2, spans: [1, 1, 1, 1] });
    expect(rowPlan(5, 3, true)).toEqual({ sub: 6, spans: [2, 2, 2, 3, 3] });
  });

  it('is empty for nothing and one column for one thing', () => {
    expect(rowPlan(0, 3)).toEqual({ sub: 1, spans: [] });
    expect(rowPlan(1, 3)).toEqual({ sub: 1, spans: [1] });
  });

  it('fills every row at every count and width: each row spans the whole grid', () => {
    for (let n = 1; n <= 12; n++) {
      for (let max = 1; max <= 6; max++) {
        for (const lead of [false, true]) {
          const plan = rowPlan(n, balancedColumns(n, max), lead);
          expect(plan.spans).toHaveLength(n);
          let row = 0;
          for (const span of plan.spans) {
            row += span;
            expect(row).toBeLessThanOrEqual(plan.sub);
            if (row === plan.sub) row = 0;
          }
          expect(row).toBe(0);
        }
      }
    }
  });
});

describe('tileLayout', () => {
  const band = (layout: ReturnType<typeof tileLayout>, id: string) => layout.find((b) => b.band === id);

  it('lays five tiles three over two where five do not fit, and five across where they do', () => {
    const layout = tileLayout(5);
    expect(band(layout, 's')).toEqual({ band: 's', sub: 2, spans: [1, 1, 1, 1, 2] });
    expect(band(layout, 'm')).toEqual({ band: 'm', sub: 6, spans: [2, 2, 2, 3, 3] });
    expect(band(layout, 'l')).toEqual({ band: 'l', sub: 6, spans: [2, 2, 2, 3, 3] });
    expect(band(layout, 'xl')).toEqual({ band: 'xl', sub: 5, spans: [1, 1, 1, 1, 1] });
    expect(band(layout, 'xxl')).toEqual({ band: 'xxl', sub: 5, spans: [1, 1, 1, 1, 1] });
  });

  it('lays four tiles two and two where they cannot be four across', () => {
    const layout = tileLayout(4);
    expect(band(layout, 'm')?.sub).toBe(2);
    expect(band(layout, 'l')?.sub).toBe(4);
  });

  it('leads with the first tile on a phone when it is the one the reader came for', () => {
    expect(band(tileLayout(5, true), 's')?.spans).toEqual([2, 1, 1, 1, 1]);
    expect(band(tileLayout(5, true), 'm')?.spans).toEqual([2, 2, 2, 3, 3]);
  });
});

describe('HubHero', () => {
  const NAMES = ['Block time', 'Transactions', 'Fees', 'Pending', 'Nodes', 'Peers', 'Uptime'];
  const figures = (n: number) =>
    NAMES.slice(0, n).map((name) => <HubFigure key={name} label={name} value={name.length} />);

  it('hands the figure list the columns it should have at each width, from how many figures there are', () => {
    const m = mount(<HubFigures>{figures(5)}</HubFigures>);
    const dl = m.container.querySelector<HTMLElement>('dl.hub-figs');
    expect(dl?.style.getPropertyValue('--figs-s')).toBe('2');
    expect(dl?.style.getPropertyValue('--figs-m')).toBe('3');
    expect(dl?.style.getPropertyValue('--figs-l')).toBe('5');
    m.unmount();
    const four = mount(<HubFigures>{figures(4)}</HubFigures>);
    const dl4 = four.container.querySelector<HTMLElement>('dl.hub-figs');
    expect(dl4?.style.getPropertyValue('--figs-m')).toBe('2');
    expect(dl4?.style.getPropertyValue('--figs-l')).toBe('4');
    four.unmount();
  });

  it('does not count a figure that is not drawn', () => {
    const m = mount(
      <HubFigures>
        {figures(3)}
        {false}
        {null}
      </HubFigures>,
    );
    expect(m.container.querySelector<HTMLElement>('dl.hub-figs')?.style.getPropertyValue('--figs-l')).toBe(
      '3',
    );
    m.unmount();
  });

  it('a figure that is not known says Unknown, never zero', () => {
    const m = mount(
      <HubFigures>
        <HubFigure label="Nodes" value={null} />
        <HubFigure label="Pending" value={0} />
      </HubFigures>,
    );
    const values = Array.from(m.container.querySelectorAll('.hub-fig__value')).map((e) => e.textContent);
    expect(values).toEqual(['Unknown', '0']);
    m.unmount();
  });

  it('shows the label and the figure, and a bar in place of the figure while it loads', () => {
    const m = mount(
      <HubHero label="Chain height" value="3,007,909" caption="Block 3,007,909 was mined 11 s ago.">
        <HubFigures>{figures(2)}</HubFigures>
      </HubHero>,
    );
    expect(m.container.querySelector('.hub-hero__label')?.textContent).toBe('Chain height');
    expect(m.container.querySelector('.hub-hero__value')?.textContent).toBe('3,007,909');
    expect(m.container.querySelector('section')?.getAttribute('aria-busy')).toBeNull();
    m.rerender(
      <HubHero label="Chain height" value="3,007,909" loading>
        <HubFigures>{figures(2)}</HubFigures>
      </HubHero>,
    );
    expect(m.container.querySelector('.hub-hero__value')?.textContent).toBe('');
    expect(m.container.querySelector('section')?.getAttribute('aria-busy')).toBe('true');
    m.unmount();
  });

  it('has a visual slot only when it is given one', () => {
    const plain = mount(<HubHero label="Nodes" value="6,841" />);
    expect(plain.container.querySelector('section')?.hasAttribute('data-visual')).toBe(false);
    plain.unmount();
    const withVisual = mount(<HubHero label="Nodes" value="6,841" visual={<div data-testid="vis" />} />);
    expect(withVisual.container.querySelector('section')?.hasAttribute('data-visual')).toBe(true);
    expect(withVisual.container.querySelector('.hub-hero__visual [data-testid="vis"]')).not.toBeNull();
    withVisual.unmount();
  });
});
