// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUi } from '../../store/ui';
import { click, mount } from '../internal/testing';
import { TimeSeries } from './TimeSeries';
import { rootProps } from './timeSeries';

const T = [1_700_000_000_000, 1_700_000_900_000, 1_700_001_800_000];

beforeEach(() => {
  useUi.getState().setMotion('off');
});

describe('TimeSeries states (rendered without loading the chart chunk)', () => {
  it('shows a busy skeleton while loading and forwards ref, className, style and attributes to the root', () => {
    const ref = createRef<HTMLDivElement>();
    const m = mount(
      <TimeSeries
        ref={ref}
        t={[]}
        series={[]}
        loading
        className="mine"
        style={{ maxWidth: 400 }}
        id="nodes-chart"
        data-testid="ts"
      />,
    );
    const root = m.container.querySelector('.ui-ts') as HTMLElement;
    expect(ref.current).toBe(root);
    expect(root.getAttribute('data-state')).toBe('loading');
    expect(root.getAttribute('aria-busy')).toBe('true');
    expect(root.classList.contains('mine')).toBe(true);
    expect(root.style.maxWidth).toBe('400px');
    expect(root.id).toBe('nodes-chart');
    expect(root.getAttribute('data-testid')).toBe('ts');
    m.unmount();
  });

  it('says No data for this range, with the given sentence, when no series has a value', () => {
    const m = mount(
      <TimeSeries
        t={T}
        series={[{ key: 'a', label: 'Nodes', values: [null, null, null] }]}
        emptyText="Try a longer range."
      />,
    );
    const root = m.container.querySelector('.ui-ts') as HTMLElement;
    expect(root.getAttribute('data-state')).toBe('empty');
    expect(m.container.textContent).toContain('No data for this range');
    expect(m.container.textContent).toContain('Try a longer range.');
    m.unmount();
  });

  it('shows the error state with a retry that calls onRetry', () => {
    const onRetry = vi.fn();
    const m = mount(<TimeSeries t={T} series={[]} error={new Error('boom')} onRetry={onRetry} />);
    expect(m.container.querySelector('.ui-ts')?.getAttribute('data-state')).toBe('error');
    const retry = Array.from(m.container.querySelectorAll('button')).find((b) =>
      /retry/i.test(b.textContent ?? ''),
    );
    expect(retry).toBeDefined();
    click(retry as HTMLElement);
    expect(onRetry).toHaveBeenCalledTimes(1);
    m.unmount();
  });
});

describe('rootProps', () => {
  it('keeps everything meant for the root element and drops the chart props', () => {
    const rest = rootProps({
      t: [],
      series: [],
      height: 200,
      loading: true,
      className: 'x',
      style: { width: 1 },
      id: 'a',
      'data-k': 'v',
      'aria-label': 'n',
    });
    expect(Object.keys(rest).sort()).toEqual(['aria-label', 'className', 'data-k', 'id', 'style']);
  });
});

describe('lazy chart chunk', () => {
  it('keeps uplot and the implementation out of every statically imported file', () => {
    const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
    const wrapper = read('./TimeSeries.tsx');
    expect(wrapper).not.toMatch(/from ['"]uplot/);
    expect(wrapper).not.toMatch(/import [^;]*from ['"]\.\/TimeSeriesImpl['"]/);
    expect(wrapper).toMatch(/lazy\(\(\) => import\(['"]\.\/TimeSeriesImpl['"]\)\)/);
    const barrel = read('./index.ts');
    expect(barrel.replace(/\/\/.*$/gm, '')).not.toMatch(/TimeSeriesImpl|uplot/);
    for (const f of [
      './TimeSeriesSkeleton.tsx',
      './timeSeries.ts',
      './chartTheme.ts',
      './color.ts',
      './scale.ts',
    ]) {
      expect(read(f)).not.toMatch(/from ['"]uplot/);
    }
  });
});
