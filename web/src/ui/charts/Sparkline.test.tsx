// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUi } from '../../store/ui';
import { mount } from '../internal/testing';
import { Sparkline } from './Sparkline';

const root = (c: HTMLElement) => c.querySelector('.ui-spark') as HTMLElement;
const svg = (c: HTMLElement) => c.querySelector('svg') as SVGSVGElement;

beforeEach(() => {
  useUi.getState().setMotion('off');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Sparkline', () => {
  it('renders an image with a generated accessible name', () => {
    const m = mount(<Sparkline values={[0.0718, 0.0725, 0.0746]} />);
    const el = svg(m.container);
    expect(el.getAttribute('role')).toBe('img');
    expect(el.getAttribute('aria-label')).toBe('Trend over 3 samples, from 0.0718 to 0.0746, up 3.9 percent');
    m.unmount();
  });

  it('lets the caller name it or hide it', () => {
    const named = mount(<Sparkline values={[1, 2]} label="Price, last 24 hours" />);
    expect(svg(named.container).getAttribute('aria-label')).toBe('Price, last 24 hours');
    named.unmount();
    const hidden = mount(<Sparkline values={[1, 2]} decorative />);
    expect(svg(hidden.container).getAttribute('aria-hidden')).toBe('true');
    expect(svg(hidden.container).hasAttribute('role')).toBe(false);
    hidden.unmount();
  });

  it('uses the caller format in the generated name', () => {
    const m = mount(<Sparkline values={[100, 150]} format={(n) => `${n} nodes`} />);
    expect(svg(m.container).getAttribute('aria-label')).toContain('from 100 nodes to 150 nodes');
    m.unmount();
  });

  it('is 64 by 26 by default, 120 by 34 for the card preset, and honours explicit sizes', () => {
    const tile = mount(<Sparkline values={[1, 2, 3]} />);
    expect([svg(tile.container).getAttribute('width'), svg(tile.container).getAttribute('height')]).toEqual([
      '64',
      '26',
    ]);
    tile.unmount();
    const card = mount(<Sparkline values={[1, 2, 3]} size="card" />);
    expect([svg(card.container).getAttribute('width'), svg(card.container).getAttribute('height')]).toEqual([
      '120',
      '34',
    ]);
    card.unmount();
    const custom = mount(<Sparkline values={[1, 2, 3]} size="card" width={200} height={40} />);
    expect([
      svg(custom.container).getAttribute('width'),
      svg(custom.container).getAttribute('height'),
    ]).toEqual(['200', '40']);
    custom.unmount();
  });

  it('draws a dashed baseline and says so when there is no data', () => {
    const m = mount(<Sparkline values={[null, null]} />);
    expect(root(m.container).dataset.state).toBe('empty');
    expect(m.container.querySelector('.ui-spark__base')).not.toBeNull();
    expect(m.container.querySelector('.ui-spark__line')).toBeNull();
    expect(svg(m.container).getAttribute('aria-label')).toBe('No data');
    m.unmount();
    const none = mount(<Sparkline values={[]} />);
    expect(root(none.container).dataset.state).toBe('empty');
    none.unmount();
  });

  it('marks a series that did not move as flat and draws it mid-height', () => {
    const m = mount(<Sparkline values={[5, 5, 5, 5]} />);
    expect(root(m.container).dataset.state).toBe('flat');
    const d = m.container.querySelector('.ui-spark__line')?.getAttribute('d') ?? '';
    const ys = [...d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((x) => x[2]);
    expect(new Set(ys).size).toBe(1);
    expect(Number(ys[0])).toBe(13);
    m.unmount();
  });

  it('breaks the line at null gaps', () => {
    const m = mount(<Sparkline values={[1, 2, null, 4, 5]} />);
    const d = m.container.querySelector('.ui-spark__line')?.getAttribute('d') ?? '';
    expect(d.match(/M/g)).toHaveLength(2);
    m.unmount();
  });

  it('draws the end dot on lines and areas but not on bars, and honours endDot={false}', () => {
    const line = mount(<Sparkline values={[1, 3, 2]} />);
    expect(line.container.querySelector('.ui-spark__dot')).not.toBeNull();
    line.unmount();
    const off = mount(<Sparkline values={[1, 3, 2]} endDot={false} />);
    expect(off.container.querySelector('.ui-spark__dot')).toBeNull();
    off.unmount();
    const bars = mount(<Sparkline values={[1, 3, 2]} form="bars" />);
    expect(bars.container.querySelector('.ui-spark__dot')).toBeNull();
    expect(bars.container.querySelector('.ui-spark__bars')).not.toBeNull();
    expect(bars.container.querySelector('.ui-spark__bar-last')).not.toBeNull();
    bars.unmount();
  });

  it('adds a gradient area under the line for the area form', () => {
    const m = mount(<Sparkline values={[1, 3, 2]} form="area" />);
    const area = m.container.querySelector('.ui-spark__area');
    expect(area?.getAttribute('d')).toMatch(/Z$/);
    expect(area?.getAttribute('fill')).toMatch(/^url\(#.+a\)$/);
    expect(m.container.querySelector('linearGradient')).not.toBeNull();
    m.unmount();
  });

  it('sets the colour custom property from the color prop', () => {
    const m = mount(<Sparkline values={[1, 2]} color="var(--viz-3)" />);
    expect(root(m.container).style.getPropertyValue('--ui-spark-color')).toBe('var(--viz-3)');
    m.unmount();
  });

  it('settles on the final geometry after a live-draw transition', () => {
    useUi.getState().setMotion('full');
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const first = [10, 12, 11, 14];
    const second = [12, 11, 14, 18];
    const settled = mount(<Sparkline values={second} />);
    const finalD = settled.container.querySelector('.ui-spark__line')?.getAttribute('d');
    settled.unmount();

    const m = mount(<Sparkline values={first} />);
    m.rerender(<Sparkline values={second} />);
    const during = m.container.querySelector('.ui-spark__line')?.getAttribute('d');
    expect(during).not.toBe(finalD);
    vi.advanceTimersByTime(600);
    expect(m.container.querySelector('.ui-spark__line')?.getAttribute('d')).toBe(finalD);
    m.unmount();
  });

  it('redraws instantly under reduced motion', () => {
    useUi.getState().setMotion('reduced');
    const m = mount(<Sparkline values={[10, 12, 11, 14]} />);
    m.rerender(<Sparkline values={[12, 11, 14, 18]} />);
    const settled = mount(<Sparkline values={[12, 11, 14, 18]} />);
    expect(m.container.querySelector('.ui-spark__line')?.getAttribute('d')).toBe(
      settled.container.querySelector('.ui-spark__line')?.getAttribute('d'),
    );
    settled.unmount();
    m.unmount();
  });
});
