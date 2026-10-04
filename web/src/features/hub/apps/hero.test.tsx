// @vitest-environment jsdom
// The hero of the Apps hub before its answers are in. The rails and the figures under the number wait for the overview
// and the index, and a hero that is shorter while it waits makes the whole page jump when they arrive. So the hero
// draws the same rails, the same sentence and the same figures from made-up numbers, out of reach of the pointer and of
// assistive technology; a failure is laid over the rails and does not take their room. The queries are handed in as the
// results they would be, so no server is needed.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppsIndexDto } from '../../../api/generated/AppsIndexDto';
import type { AppsOverviewDto } from '../../../api/generated/AppsOverviewDto';
import { ApiError } from '../../../api/http';
import { click, type Mounted, mount } from '../../../ui/internal/testing';
import type { HubQuery } from '..';
import { AppsHero } from './AppsHero';
import { CapacityRails } from './CapacityRails';
import { indexTotals } from './lib/apps';
import { app } from './lib/fixtures';

const refetch = vi.fn();

const result = <T,>(over: Record<string, unknown>): HubQuery<T> =>
  ({
    data: undefined,
    error: null,
    isPending: false,
    isError: false,
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
const failed = <T,>(status: number) => result<T>({ error: apiError(status), isError: true });

function overview(over: Partial<AppsOverviewDto> = {}): AppsOverviewDto {
  return {
    generated_ms: 1_791_000_000_000,
    tip_height: 3_000_000,
    owners: [],
    total_owners: 47,
    countries: [{ code: 'DE', name: 'Germany', instances: 500 }],
    unlocated_instances: 0,
    resources: {
      used: { cores: 50, ram_gb: 100, ssd_gb: 1000 },
      network: { cores: 1000, ram_gb: 2000, ssd_gb: 40_000 },
    },
    deployments: [],
    history_complete: true,
    newest: [],
    expiring: [],
    enterprise: { apps: 3, instances: 9 },
    ...over,
  };
}

let view: Mounted | null = null;

afterEach(() => {
  view?.unmount();
  view = null;
  refetch.mockReset();
});

function show(el: React.ReactElement): HTMLElement {
  view = mount(el);
  return view.container;
}

const rails = (c: HTMLElement) => c.querySelector<HTMLElement>('.ap-rails');
const lanes = (c: HTMLElement) => [...c.querySelectorAll('li.ap-rail')];
const note = (c: HTMLElement) => c.querySelector('.ap-rails__note')?.textContent ?? '';

describe('CapacityRails', () => {
  it('ready: three rails, each a meter with its reading, and the note about what is not counted', () => {
    const c = show(<CapacityRails overview={ready(overview())} enterpriseApps={3} />);
    expect(rails(c)?.getAttribute('data-state')).toBe('ready');
    expect(lanes(c)).toHaveLength(3);
    expect(c.querySelectorAll('[role="meter"]')).toHaveLength(3);
    expect(c.querySelector('.ap-ghost')).toBeNull();
    expect(note(c)).toContain('3 enterprise apps keep their size private');
  });

  it('loading: the same three rails and the note, made up and out of reach, and nothing is said about waiting', () => {
    const c = show(<CapacityRails overview={loading()} enterpriseApps={3} />);
    expect(rails(c)?.getAttribute('data-state')).toBe('loading');
    expect(rails(c)?.getAttribute('aria-busy')).toBe('true');
    const ghost = c.querySelector('.ap-ghost');
    expect(ghost?.getAttribute('aria-hidden')).toBe('true');
    expect(ghost?.hasAttribute('inert')).toBe(true);
    expect(lanes(c)).toHaveLength(3);
    expect(c.querySelector('.ap-waiting')).toBeNull();
    // The sentence is the one the loaded rails will say, so it takes the lines they will take.
    expect(note(c)).toBe(
      'These count apps with a public spec. 3 enterprise apps keep their size private, so apps hold at least this much.',
    );
    // The names of the rails are known before their numbers are, and the title row is the one the rails will have.
    expect(c.querySelector('.ap-rails__title')?.textContent).toContain('Locked by apps');
    expect(c.querySelector('.ap-rails__sub')?.textContent).toContain('benchmarked capacity');
  });

  it('loading reserves the long form of the note while the enterprise count is not known yet', () => {
    const c = show(<CapacityRails overview={loading()} enterpriseApps={null} />);
    expect(note(c)).toContain('enterprise apps keep their size private, so apps hold at least this much');
  });

  it('a network with no enterprise app has the short note, and the made-up one is as short', () => {
    const c = show(<CapacityRails overview={loading()} enterpriseApps={0} />);
    expect(note(c)).toBe('These count apps with a public spec.');
  });

  it('filling (503): the title row says the numbers are being read, in the place of the line that names the rails', () => {
    const c = show(<CapacityRails overview={waiting()} enterpriseApps={3} />);
    expect(rails(c)?.getAttribute('data-state')).toBe('loading');
    const wait = c.querySelector('.ap-rails__title .ap-waiting');
    expect(wait?.getAttribute('role')).toBe('status');
    expect(wait?.textContent).toContain('Reading the network');
    expect(c.querySelector('.ap-rails__sub')).toBeNull();
    expect(c.querySelector('.ap-ghost')).not.toBeNull();
    expect(c.querySelector('[role="alert"]')).toBeNull();
  });

  it('failed: the error is laid over the made-up rails, which keep their room, and Retry asks again', () => {
    const c = show(<CapacityRails overview={failed(500)} enterpriseApps={3} />);
    expect(rails(c)?.getAttribute('data-state')).toBe('error');
    expect(rails(c)?.getAttribute('aria-busy')).toBeNull();
    const hold = c.querySelector('.ap-hold');
    expect(hold?.hasAttribute('data-failed')).toBe(true);
    // Both are in the one cell of the hold: the error over the rails, which are only hidden, not removed.
    expect(hold?.querySelector('.ap-hold__under')).not.toBeNull();
    expect(lanes(c)).toHaveLength(3);
    expect(hold?.querySelector('.ap-hold__over [role="alert"]')?.textContent).toContain(
      'Could not load the capacity',
    );
    const retry = [...c.querySelectorAll('button')].find((b) => b.textContent === 'Retry');
    expect(retry).toBeDefined();
    if (retry) click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('a 503 that outlasts the retries is still the server reading, not a failure', () => {
    const c = show(<CapacityRails overview={failed(503)} enterpriseApps={3} />);
    const alert = c.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('still being read');
    expect(alert?.textContent).not.toContain('Could not load');
  });
});

describe('AppsHero', () => {
  const apps = [
    app({ name: 'alpha', instances_running: 5, instances_target: 6 }),
    app({ name: 'beta', instances_running: 3, instances_target: 3, enterprise: true }),
  ];
  const index = (over: Record<string, unknown> = {}) => result<AppsIndexDto>(over);
  const figures = (c: HTMLElement) =>
    [...c.querySelectorAll('.hub-fig')].map((f) => ({
      label: f.querySelector('.hub-fig__label')?.textContent,
      value: f.querySelector('.hub-fig__value'),
      note: f.querySelector('.hub-fig__note'),
    }));

  it('while the index is on its way the sentence under the number is made up, and the number is a placeholder', () => {
    const c = show(<AppsHero index={index({ isPending: true })} overview={loading()} totals={null} />);
    expect(c.querySelector('.hub-hero')?.getAttribute('aria-busy')).toBe('true');
    const caption = c.querySelector('.hub-hero__caption');
    expect(caption?.querySelector('.ap-ghost')?.getAttribute('aria-hidden')).toBe('true');
    // The made-up sentence is the long one the real caption is, so the hero is as tall before as after.
    expect(caption?.textContent).toContain('instances are running across');
    expect(caption?.textContent).toContain('Enterprise apps are');
  });

  it('every figure waiting for an answer is made up and out of reach, notes included, and none says Unknown', () => {
    const c = show(<AppsHero index={index({ isPending: true })} overview={loading()} totals={null} />);
    const list = figures(c);
    expect(list.map((f) => f.label)).toEqual([
      'Instances running',
      'Owners',
      'Enterprise apps',
      'Countries',
      'Apps per owner',
    ]);
    for (const f of list) {
      expect(f.value?.querySelector('.ap-ghost')).not.toBeNull();
      expect(f.note?.querySelector('.ap-ghost')).not.toBeNull();
      expect(f.value?.textContent).not.toContain('Unknown');
    }
  });

  it('a figure that has its answer shows it, while the ones waiting for the other endpoint stay made up', () => {
    const data: AppsIndexDto = { apps } as AppsIndexDto;
    const c = show(<AppsHero index={ready(data)} overview={loading()} totals={indexTotals(apps)} />);
    const [instances, owners, enterprise, countries, perOwner] = figures(c);
    // The index is in: the instances and the enterprise apps are real.
    expect(instances?.value?.querySelector('.ap-ghost')).toBeNull();
    expect(instances?.value?.textContent).toContain('8');
    expect(enterprise?.value?.querySelector('.ap-ghost')).toBeNull();
    expect(enterprise?.note?.textContent).toBe('50% of all apps');
    // The overview is not: the owners, the countries and the ratio of the two wait.
    expect(owners?.value?.querySelector('.ap-ghost')).not.toBeNull();
    expect(countries?.value?.querySelector('.ap-ghost')).not.toBeNull();
    expect(perOwner?.value?.querySelector('.ap-ghost')).not.toBeNull();
    expect(c.querySelector('.hub-hero__caption .ap-ghost')).toBeNull();
  });

  it('says Unknown, never a made-up figure, once an answer has failed', () => {
    const c = show(
      <AppsHero
        index={index({ isError: true, error: apiError(500) })}
        overview={failed(500)}
        totals={null}
      />,
    );
    expect(c.querySelector('.hub-hero__caption .ap-ghost')).toBeNull();
    expect(c.querySelector('.hub-hero__caption')?.textContent).toContain('could not be loaded');
    for (const f of figures(c)) {
      expect(f.value?.textContent).toBe('Unknown');
      expect(f.value?.querySelector('.ap-ghost')).toBeNull();
    }
  });
});
