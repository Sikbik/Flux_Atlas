// @vitest-environment jsdom
// The panels of the Apps hub in every state the page can put them in. Each owns its own loading, filling, failed and
// empty state, so one endpoint being down never blanks the page; and where a panel keeps logic of its own (the country
// rows that filter the globe, the owner rows that open in place, the economy that will not call an unknown a zero) it
// is checked here. The queries are handed in as the results they would be, so no server is needed; the shell's
// navigation, the clock and the globe filter are stubbed.

import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEconomyDto } from '../../../api/generated/AppEconomyDto';
import type { AppsOverviewDto } from '../../../api/generated/AppsOverviewDto';
import { ApiError } from '../../../api/http';
import { click, type Mounted, mount } from '../../../ui/internal/testing';
import type { HubQuery } from '..';
import { ExpiringPanel, NewAppsPanel } from './AppLists';
import { CountriesPanel } from './CountriesPanel';
import { DeploymentsPanel } from './DeploymentsPanel';
import { EconomyPanel } from './EconomyPanel';
import { indexTotals } from './lib/apps';
import { app } from './lib/fixtures';
import { OwnersPanel } from './OwnersPanel';

const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TODAY = Date.UTC(2026, 9, 4);

const stub = vi.hoisted(() => ({
  nav: { open: vi.fn(), go: vi.fn() },
  clock: { now: () => Date.UTC(2026, 9, 4, 12, 0, 0), subscribe: () => () => undefined },
  filter: { cc: null as string | null, toggle: vi.fn() },
}));

vi.mock('../../../shell/frame/nav', () => ({ useShellNav: () => stub.nav }));
vi.mock('../../../app/context', () => ({ useRuntime: () => ({ clock: stub.clock }) }));
vi.mock('../../analytics/hooks/useGlobeFilter', () => ({ useGlobeFilter: () => stub.filter }));
// The chart is the wallet's plot, which needs a layout engine; the panel's part is the days it is handed.
vi.mock('./DeploymentsChart', () => ({
  DeploymentsChart: ({ series }: { series: { t: number[] } }) => (
    <div data-testid="chart" data-days={series.t.length} />
  ),
}));

// ---- the server's answers, as the queries would hold them ---------------------------------------------------

const refetch = vi.fn();

const result = <T,>(over: Record<string, unknown>): HubQuery<T> =>
  ({
    data: undefined,
    error: null,
    isPending: false,
    isFetching: false,
    failureReason: null,
    refetch,
    ...over,
  }) as unknown as HubQuery<T>;

const apiError = (status: number) =>
  new ApiError(
    status === 503 ? 'unavailable' : 'upstream',
    'no',
    status,
    '/x',
    status === 503 ? 5 : undefined,
  );

const ready = <T,>(data: T) => result<T>({ data });
const loading = <T,>() => result<T>({ isPending: true });
const waiting = <T,>() => result<T>({ isPending: true, failureReason: apiError(503) });
const failed = <T,>(status: number) => result<T>({ error: apiError(status) });

const day = (n: number) => TODAY + n * DAY;

function overview(over: Partial<AppsOverviewDto> = {}): AppsOverviewDto {
  return {
    generated_ms: NOW - 20_000,
    tip_height: 3_000_000,
    owners: [
      { owner: 'owner-a', apps: 12, instances: 300, cores: 40, ram_gb: 80, ssd_gb: 900 },
      { owner: 'owner-b', apps: 3, instances: 120, cores: 10, ram_gb: 20, ssd_gb: 100 },
    ],
    total_owners: 2,
    countries: [
      { code: 'DE', name: 'Germany', instances: 500 },
      { code: 'FR', name: 'France', instances: 300 },
      { code: 'US', name: 'United States', instances: 100 },
    ],
    unlocated_instances: 150,
    resources: {
      used: { cores: 50, ram_gb: 100, ssd_gb: 1000 },
      network: { cores: 1000, ram_gb: 2000, ssd_gb: 40_000 },
    },
    deployments: [
      { day_ms: day(-2), registered: 3, updated: 4 },
      { day_ms: day(-1), registered: 0, updated: 0 },
      { day_ms: day(0), registered: 1, updated: 1 },
    ],
    history_complete: true,
    newest: [
      { name: 'newapp', display_name: 'NewApp', height: 2_999_900, time_ms: NOW - 3 * HOUR, instances: 2 },
      { name: 'fresh', display_name: '', height: 2_999_990, time_ms: null, instances: 0 },
    ],
    expiring: [
      {
        name: 'soonapp',
        display_name: 'SoonApp',
        expire_height: 3_000_060,
        blocks_left: 60,
        expire_ms: NOW + 30 * 60_000,
        instances: 3,
      },
      {
        name: 'laterapp',
        display_name: 'LaterApp',
        expire_height: 3_020_000,
        blocks_left: 20_000,
        expire_ms: NOW + 7 * DAY,
        instances: 1,
      },
    ],
    enterprise: { apps: 0, instances: 0 },
    ...over,
  };
}

function economy(over: Partial<AppEconomyDto> = {}): AppEconomyDto {
  return {
    generated_ms: NOW - 10_000,
    tip_height: 3_000_000,
    history_complete: true,
    paid_24h: '1000.00000000',
    paid_7d: '7000.00000000',
    paid_30d: '4500.00000000',
    registrations_30d: 120,
    updates_30d: 300,
    messages_total: 5000,
    paid_all_time: '250000.00000000',
    active_apps: 1900,
    // 89 whole days and today: the last 30 paid half as much again as the 30 before.
    days: Array.from({ length: 90 }, (_, i) => ({
      day_ms: day(i - 89),
      registrations: 1,
      updates: 3,
      paid: i >= 59 ? '150.00000000' : '100.00000000',
      active_apps: 1900,
    })),
    top_apps_30d: [
      {
        name: 'bigpayer',
        display_name: 'BigPayer',
        paid: '4000.00000000',
        messages: 4,
        last_height: 2_999_000,
      },
    ],
    top_apps_all_time: [],
    ...over,
  };
}

// ---- the harness ----------------------------------------------------------------------------------------------------

let view: Mounted | null = null;

beforeEach(() => {
  stub.filter.cc = null;
});

afterEach(() => {
  view?.unmount();
  view = null;
  stub.nav.open.mockReset();
  stub.nav.go.mockReset();
  stub.filter.toggle.mockReset();
  refetch.mockReset();
});

function show(el: ReactElement): HTMLElement {
  view = mount(el);
  return view.container;
}

const panel = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`section#${id}`);
const retry = (c: HTMLElement) => [...c.querySelectorAll('button')].find((b) => b.textContent === 'Retry');

// ---- every panel owns its states ---------------------------------------------------------------------------------

interface Case {
  name: string;
  id: string;
  heading: string;
  render: (q: HubQuery<AppsOverviewDto>) => ReactElement;
  /** An overview that has nothing for this panel. */
  empty: Partial<AppsOverviewDto>;
  emptyTitle: string;
  /** What the loading state draws from made-up numbers, as the loaded panel draws it: a selector and how many. */
  made: [selector: string, count: number];
}

const CASES: Case[] = [
  {
    name: 'owners',
    id: 'owners',
    heading: 'Top owners',
    render: (q) => <OwnersPanel overview={q} apps={undefined} totals={null} />,
    empty: { owners: [], total_owners: 0 },
    emptyTitle: 'No owners yet',
    made: ['li.ap-owner', 10],
  },
  {
    name: 'countries',
    id: 'countries',
    heading: 'Where apps run',
    render: (q) => <CountriesPanel overview={q} />,
    empty: { countries: [], unlocated_instances: 0 },
    emptyTitle: 'No instance has a stored location',
    made: ['.ui-barlist__row', 14],
  },
  {
    name: 'deployments',
    id: 'deployments',
    heading: 'Deployments',
    render: (q) => <DeploymentsPanel overview={q} />,
    empty: { deployments: [] },
    emptyTitle: 'No deployments recorded',
    made: ['.ap-mini > div', 3],
  },
  {
    name: 'new apps',
    id: 'new-apps',
    heading: 'New apps',
    render: (q) => <NewAppsPanel overview={q} />,
    empty: { newest: [] },
    emptyTitle: 'No registrations seen yet',
    made: ['li.ap-li', 10],
  },
  {
    name: 'expiring apps',
    id: 'expiring',
    heading: 'Expiring soon',
    render: (q) => <ExpiringPanel overview={q} />,
    empty: { expiring: [] },
    emptyTitle: 'No expiries to show',
    made: ['li.ap-li', 10],
  },
];

describe.each(CASES)('the $name panel', (p) => {
  it('loading: the heading stays, the panel is busy, its rows are made up and out of reach, and nothing is said about waiting', () => {
    const c = show(p.render(loading()));
    const s = panel(c, p.id);
    expect(s?.getAttribute('aria-busy')).toBe('true');
    expect(s?.querySelector('h2')?.textContent).toBe(p.heading);
    const ghost = s?.querySelector('.ap-ghost');
    expect(ghost).not.toBeNull();
    expect(ghost?.getAttribute('aria-hidden')).toBe('true');
    expect(ghost?.hasAttribute('inert')).toBe(true);
    expect(s?.querySelector('.ap-waiting')).toBeNull();
    expect(s?.querySelector('[role="alert"]')).toBeNull();
  });

  it('loading holds the size of the loaded panel: the same rows, and the footer it will have', () => {
    const note = (c: HTMLElement) => panel(c, p.id)?.querySelector('.ap-foot-note')?.textContent ?? '';
    const [selector, count] = p.made;
    const made = show(p.render(loading()));
    expect(panel(made, p.id)?.querySelectorAll(selector)).toHaveLength(count);
    expect(panel(made, p.id)?.querySelector('.hub-panel__foot')).not.toBeNull();
    const madeNote = note(made);
    view?.unmount();
    const real = show(p.render(ready(overview())));
    expect(madeNote).not.toBe('');
    expect(note(real)).toBe(madeNote);
  });

  it('filling (the server answers 503): still loading, and the heading says the numbers are being read', () => {
    const c = show(p.render(waiting()));
    const s = panel(c, p.id);
    expect(s?.getAttribute('aria-busy')).toBe('true');
    expect(s?.querySelector('.ap-ghost')).not.toBeNull();
    const wait = s?.querySelector('.hub-panel__aside .ap-waiting');
    expect(wait?.getAttribute('role')).toBe('status');
    expect(wait?.textContent).toContain('Reading the network');
    expect(wait?.textContent).toContain('reading the network for the first time');
    expect(s?.querySelector('[role="alert"]')).toBeNull();
  });

  it('failed: the heading stays, the error is announced, and Retry asks again', () => {
    const c = show(p.render(failed(500)));
    const s = panel(c, p.id);
    expect(s?.getAttribute('data-state')).toBe('error');
    expect(s?.querySelector('h2')?.textContent).toBe(p.heading);
    expect(s?.querySelector('[role="alert"]')?.textContent).toContain('Could not load');
    const button = retry(c);
    expect(button).toBeDefined();
    if (button) click(button);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('still filling when the retries are spent: says so instead of calling it a failure', () => {
    const c = show(p.render(failed(503)));
    const alert = panel(c, p.id)?.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('still being read');
    expect(alert?.textContent).not.toContain('Could not load');
  });

  it('empty: says what is missing, with no rows and no footnote about them', () => {
    const c = show(p.render(ready(overview(p.empty))));
    const s = panel(c, p.id);
    expect(s?.getAttribute('data-state')).toBe('empty');
    expect(s?.textContent).toContain(p.emptyTitle);
    expect(s?.querySelector('.ap-foot-note')).toBeNull();
  });
});

// ---- the countries --------------------------------------------------------------------------------------------

describe('CountriesPanel', () => {
  const rows = (c: HTMLElement) =>
    [...c.querySelectorAll('.ui-barlist__row')].map((r) => ({
      label: r.querySelector('.ui-barlist__label')?.textContent,
      value: r.querySelector('.ui-barlist__value')?.textContent,
      kind: r.getAttribute('data-kind'),
      pressed: r.getAttribute('aria-pressed'),
    }));

  it('ranks the countries, puts the unlocated instances where their count ranks, and names who hosts half', () => {
    const c = show(<CountriesPanel overview={ready(overview())} />);
    expect(rows(c).map((r) => r.label)).toEqual(['Germany', 'France', 'Unknown', 'United States']);
    expect(rows(c).map((r) => r.value)).toEqual(['500', '300', '150', '100']);
    expect(c.querySelector('.ap-headline')?.textContent).toBe(
      'Germany and France together host 76.2% of the running instances.',
    );
    expect(panel(c, 'countries')?.querySelector('.hub-panel__aside')?.textContent).toBe('3 countries');
  });

  it('leaves the unknown row out when every instance is located: a real zero is not a row', () => {
    const c = show(<CountriesPanel overview={ready(overview({ unlocated_instances: 0 }))} />);
    expect(rows(c).map((r) => r.label)).toEqual(['Germany', 'France', 'United States']);
  });

  it('a country is a button that filters the globe by it; the unknown row is not a button', () => {
    const c = show(<CountriesPanel overview={ready(overview())} />);
    const list = rows(c);
    expect(list.find((r) => r.label === 'Unknown')?.kind).toBe('plain');
    expect(list.find((r) => r.label === 'Germany')?.kind).toBe('button');
    const germany = [...c.querySelectorAll<HTMLElement>('.ui-barlist__row')].find((r) =>
      r.textContent?.startsWith('Germany'),
    );
    if (germany) click(germany);
    expect(stub.filter.toggle).toHaveBeenCalledWith('cc', 'DE');
  });

  it('shows the country the globe is filtered to as pressed', () => {
    stub.filter.cc = 'fr';
    const c = show(<CountriesPanel overview={ready(overview())} />);
    expect(rows(c).find((r) => r.label === 'France')?.pressed).toBe('true');
    expect(rows(c).find((r) => r.label === 'Germany')?.pressed).toBe('false');
  });
});

// ---- the deployments ------------------------------------------------------------------------------------------

describe('DeploymentsPanel', () => {
  it('puts the totals and the busiest whole day above the chart, which gets every day', () => {
    const c = show(<DeploymentsPanel overview={ready(overview())} />);
    const figures = [...c.querySelectorAll('.ap-mini > div')].map((d) => d.textContent);
    expect(figures[0]).toContain('4');
    expect(figures[0]).toContain('apps in 3 days');
    expect(figures[1]).toContain('5');
    // The 2 Oct: 7 messages, the busiest whole day (today is still running and does not count).
    expect(figures[2]).toContain('2 Oct');
    expect(figures[2]).toContain('7 messages');
    expect(c.querySelector('[data-testid="chart"]')?.getAttribute('data-days')).toBe('3');
    expect(c.querySelector('.hub-panel__aside')?.textContent).toBe('last 3 days');
    expect(c.querySelector('.ap-note')).toBeNull();
  });

  it('says when the history is still being read, so a short early bar is not taken for a quiet day', () => {
    const c = show(<DeploymentsPanel overview={ready(overview({ history_complete: false }))} />);
    expect(c.querySelector('.ap-note')?.textContent).toContain('Still filling');
    expect(c.querySelector('.ap-note')?.getAttribute('role')).toBe('status');
  });

  it('has no busiest day when no whole day had any message, and does not make one up', () => {
    const quiet = overview({
      deployments: [
        { day_ms: day(-1), registered: 0, updated: 0 },
        { day_ms: day(0), registered: 2, updated: 2 },
      ],
    });
    const c = show(<DeploymentsPanel overview={ready(quiet)} />);
    const busiest = [...c.querySelectorAll('.ap-mini > div')][2]?.textContent;
    expect(busiest).toContain('None');
  });
});

// ---- what apps pay --------------------------------------------------------------------------------------------------

describe('EconomyPanel', () => {
  it('gives the month, the change against the month before, the other windows, and the biggest payer', () => {
    const c = show(<EconomyPanel economy={ready(economy())} />);
    const text = c.textContent ?? '';
    expect(c.querySelector('.ap-eco__v')?.textContent).toBe('4,500');
    expect(text).toContain('+50.0%');
    expect(text).toContain('vs the 30 days before');
    expect(text).toContain('1,000 FLUX');
    expect(text).toContain('7,000 FLUX');
    expect(text).toContain('All time');
    expect(text).toContain('250,000 FLUX');
    expect(text).toContain('5,000 messages');
    const link = c.querySelector<HTMLAnchorElement>('a.ap-facts__link');
    expect(link?.textContent).toBe('BigPayer');
    if (link) click(link);
    expect(stub.nav.open).toHaveBeenCalledWith({ type: 'app', key: 'bigpayer' });
  });

  it('is Unknown, never zero, while the server is still reading the history; its totals say what they are', () => {
    const partial = economy({
      history_complete: false,
      paid_24h: null,
      paid_7d: null,
      paid_30d: null,
      registrations_30d: null,
      updates_30d: null,
    });
    const c = show(<EconomyPanel economy={ready(partial)} />);
    const text = c.textContent ?? '';
    expect(c.querySelector('.ap-eco__big')?.textContent).toBe('Unknown');
    expect(c.querySelectorAll('.ap-facts .ui-unknown').length).toBe(4);
    expect(text).toContain('Seen so far');
    expect(text).not.toContain('All time');
    expect(text).toContain('Still filling');
    // No change is claimed without two whole months, and no payer is named from part of the history.
    expect(text).not.toContain('vs the 30 days before');
    expect(c.querySelector('a.ap-facts__link')).toBeNull();
  });

  it('is empty only when the whole history is in and holds nothing', () => {
    const none = economy({ messages_total: 0 });
    expect(panel(show(<EconomyPanel economy={ready(none)} />), 'economy')?.getAttribute('data-state')).toBe(
      'empty',
    );
  });

  it('owns its states on its own query, apart from the overview', () => {
    const c = show(<EconomyPanel economy={waiting()} />);
    expect(panel(c, 'economy')?.getAttribute('aria-busy')).toBe('true');
    expect(c.querySelector('.ap-ghost')).not.toBeNull();
    expect(c.querySelector('.ap-waiting')?.textContent).toContain('reading the network for the first time');
  });

  it('loading draws the rows it will have, and the footer, from made-up numbers', () => {
    const c = show(<EconomyPanel economy={loading()} />);
    expect(c.querySelectorAll('.ap-facts > div')).toHaveLength(6);
    expect(c.querySelector('.ap-eco__spark')).not.toBeNull();
    expect(c.querySelector('.ap-foot-note')?.textContent).toBe('FLUX paid to register and update apps.');
    // What is known before the numbers are (the labels) is drawn as it is; the figures are made up and out of reach.
    const labels = [...c.querySelectorAll('.ap-ghost [data-static]')].map((e) => e.textContent);
    expect(labels).toContain('Last 24 hours');
    expect(c.querySelector('.ap-ghost')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('the only link in the loaded panel is the biggest payer', () => {
    const c = show(<EconomyPanel economy={ready(economy())} />);
    expect([...c.querySelectorAll('a')].map((a) => a.textContent)).toEqual(['BigPayer']);
  });
});

// ---- the two short lists ------------------------------------------------------------------------------------------

describe('NewAppsPanel', () => {
  it('words the time as an estimate, falls back to the block (which is exact), and says none running for a new app', () => {
    const c = show(<NewAppsPanel overview={ready(overview())} />);
    const rows = [...c.querySelectorAll('li.ap-li')];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector('.ap-li__name')?.textContent).toBe('NewApp');
    expect(rows[0]?.querySelector('.ap-li__when')?.textContent).toBe('Registered about 3 hours ago');
    expect(rows[0]?.querySelector('.ap-li__running')?.textContent).toBe('2 running');
    expect(rows[0]?.getAttribute('title')).toContain('Estimated 2026-10-04 09:00 UTC');
    // No display name: the key is the name. No time: the block, and no invented estimate.
    expect(rows[1]?.querySelector('.ap-li__name')?.textContent).toBe('fresh');
    expect(rows[1]?.querySelector('.ap-li__when')?.textContent).toBe('Registered at block 2,999,990');
    expect(rows[1]?.getAttribute('title')).toBeNull();
    expect(rows[1]?.querySelector('.ap-li__running')?.textContent).toBe('none running');
  });

  it('a row opens the app', () => {
    const c = show(<NewAppsPanel overview={ready(overview())} />);
    const link = c.querySelector<HTMLAnchorElement>('li.ap-li a.ap-li__name');
    if (link) click(link);
    expect(stub.nav.open).toHaveBeenCalledWith({ type: 'app', key: 'newapp' });
  });

  it('marks an app that arrives while the page is open as fresh, and not the ones already there', () => {
    const first = overview();
    const c = show(<NewAppsPanel overview={ready(first)} />);
    expect(c.querySelectorAll('li.ap-li[data-fresh]')).toHaveLength(0);
    const arrival = {
      name: 'brandnew',
      display_name: 'BrandNew',
      height: 3_000_000,
      time_ms: NOW - 60_000,
      instances: 0,
    };
    view?.rerender(<NewAppsPanel overview={ready(overview({ newest: [arrival, ...first.newest] }))} />);
    const fresh = [...c.querySelectorAll('li.ap-li[data-fresh] .ap-li__name')].map((a) => a.textContent);
    expect(fresh).toEqual(['BrandNew']);
  });

  it('says when it has seen only part of the registrations', () => {
    const c = show(<NewAppsPanel overview={ready(overview({ history_complete: false }))} />);
    expect(c.querySelector('.ap-note')?.textContent).toContain('Still filling');
  });
});

describe('ExpiringPanel', () => {
  it('marks only what goes within the hour, with an icon as well as the colour, and keeps the exact block count', () => {
    const c = show(<ExpiringPanel overview={ready(overview())} />);
    const rows = [...c.querySelectorAll('li.ap-li')];
    expect(rows[0]?.getAttribute('data-soon')).toBe('true');
    expect(rows[0]?.querySelector('.ap-li__when svg')).not.toBeNull();
    expect(rows[0]?.querySelector('.ap-li__when')?.textContent).toBe('Expires in about 30 minutes');
    expect(rows[0]?.querySelector('.ap-li__exact')?.textContent).toBe('60 blocks left');
    expect(rows[1]?.getAttribute('data-soon')).toBeNull();
    expect(rows[1]?.querySelector('.ap-li__when svg')).toBeNull();
    expect(rows[1]?.querySelector('.ap-li__when')?.textContent).toBe('Expires in about 7 days');
    expect(rows[1]?.querySelector('.ap-li__exact')?.textContent).toBe('20,000 blocks left');
  });
});

// ---- the owners ---------------------------------------------------------------------------------------------------

describe('OwnersPanel', () => {
  const apps = [
    app({ name: 'alpha', owner: 'owner-a', instances_running: 5 }),
    app({ name: 'beta', owner: 'owner-a', instances_running: 9 }),
    app({ name: 'gamma', owner: 'owner-b', instances_running: 2 }),
  ];

  const manyOwners = (n: number) =>
    overview({
      owners: Array.from({ length: n }, (_, i) => ({
        owner: `owner-${String(i).padStart(2, '0')}`,
        apps: 2,
        instances: 100 - i,
        cores: 1,
        ram_gb: 1,
        ssd_gb: 1,
      })),
      total_owners: n,
    });

  it('opens a row in place to show the owner and its apps, biggest first, as links, and closes it again', () => {
    const c = show(<OwnersPanel overview={ready(overview())} apps={apps} totals={indexTotals(apps)} />);
    const toggle = c.querySelector<HTMLButtonElement>('button.ap-owner__toggle');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(c.querySelector('.ap-owner__open')).toBeNull();
    if (toggle) click(toggle);
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    const open = c.querySelector('.ap-owner__open');
    expect(open?.querySelector('code')?.textContent).toBe('owner-a');
    expect([...(open?.querySelectorAll('a.ap-chip .ap-chip__name') ?? [])].map((a) => a.textContent)).toEqual(
      ['beta', 'alpha'],
    );
    const chip = open?.querySelector<HTMLAnchorElement>('a.ap-chip');
    if (chip) click(chip);
    expect(stub.nav.open).toHaveBeenCalledWith({ type: 'app', key: 'beta' });
    if (toggle) click(toggle);
    expect(c.querySelector('.ap-owner__open')).toBeNull();
  });

  it('does not lead to the operator window: an app owner often runs no node', () => {
    const c = show(<OwnersPanel overview={ready(overview())} apps={apps} totals={indexTotals(apps)} />);
    expect(c.querySelector('a[href*="operator"]')).toBeNull();
  });

  it('says so in the open row while the app list is not loaded, and still names the owner', () => {
    const c = show(<OwnersPanel overview={ready(overview())} apps={undefined} totals={null} />);
    const toggle = c.querySelector<HTMLButtonElement>('button.ap-owner__toggle');
    if (toggle) click(toggle);
    expect(c.querySelector('.ap-owner__open code')?.textContent).toBe('owner-a');
    expect(c.querySelector('.ap-owner__open')?.textContent).toContain('not loaded yet');
  });

  it('shows ten owners, and all of them behind Show all', () => {
    const c = show(<OwnersPanel overview={ready(manyOwners(25))} apps={apps} totals={indexTotals(apps)} />);
    expect(c.querySelectorAll('li.ap-owner')).toHaveLength(10);
    const all = [...c.querySelectorAll('button')].find((b) => b.textContent === 'Show all 25');
    expect(all).toBeDefined();
    if (all) click(all);
    expect(c.querySelectorAll('li.ap-owner')).toHaveLength(25);
    expect([...c.querySelectorAll('button')].some((b) => b.textContent === 'Show fewer')).toBe(true);
  });
});
