// @vitest-environment jsdom
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUi } from '../../../store/ui';
import { click, mount, press } from '../../../ui/internal/testing';
import { type ChainModel, chainModel } from '../lib/chain';
import { DAY, chainDto as dto, FORK_MS, MIN, chainPoints as points, T0 } from '../lib/chainFixture';
import { BlockTimeChart } from './BlockTimeChart';
import { PLOT_MARGIN } from './ChainPlot';
import { DifficultyChart } from './DifficultyChart';

function Pair({ model }: { model: ChainModel }) {
  const [cursor, setCursor] = useState<number | null>(null);
  return (
    <>
      <DifficultyChart model={model} cursor={cursor} onCursor={setCursor} />
      <BlockTimeChart model={model} cursor={cursor} onCursor={setCursor} />
    </>
  );
}

const sliders = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[role="slider"]')];
const tips = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('.cp-tip')];
const crosses = (c: HTMLElement) => c.querySelectorAll('.cp-cross').length;

const WIDTH = 600;
const PLOT_W = WIDTH - PLOT_MARGIN.left - PLOT_MARGIN.right;

beforeEach(() => {
  useUi.getState().setMotion('off');
  // jsdom has no layout. The chart is 600 wide; its slider sits over the plot, inside the margins.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const slider = this.getAttribute('role') === 'slider';
    const left = slider ? PLOT_MARGIN.left : 0;
    const width = slider ? PLOT_W : WIDTH;
    return {
      x: left,
      y: 0,
      left,
      top: 0,
      right: left + width,
      bottom: 232,
      width,
      height: 232,
      toJSON: () => ({}),
    } as DOMRect;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the two charts', () => {
  it('are named figures with a slider each, and the slider says what the chart shows until it is read', () => {
    const model = chainModel(dto());
    const m = mount(<Pair model={model} />);
    const figs = [...m.container.querySelectorAll('figure')];
    expect(figs.map((f) => f.getAttribute('aria-label'))).toEqual([
      'Difficulty over the last 24 hours',
      'Time per block over the last 24 hours',
    ]);
    const [a, b] = sliders(m.container);
    expect(a?.getAttribute('aria-valuemax')).toBe('9');
    expect(a?.getAttribute('aria-valuetext')).toBe(model.summary.difficulty);
    expect(b?.getAttribute('aria-valuetext')).toBe(model.summary.blockTime);
    expect(m.container.querySelector('[data-chart="difficulty"] .cp-line')?.getAttribute('d')).toBeTruthy();
    m.unmount();
  });

  it('read with the arrow keys: the first press lands on the newest bucket, and all four facts are read out', () => {
    const m = mount(<Pair model={chainModel(dto())} />);
    const [a] = sliders(m.container);
    press(a as HTMLElement, 'ArrowLeft');
    expect(a?.getAttribute('aria-valuenow')).toBe('9');
    expect(a?.getAttribute('aria-valuetext')).toBe(
      '2026-09-30 12:18 UTC, block 2,999,036: difficulty 0.359, block time 30.0 s, longest gap 34.0 s',
    );
    press(a as HTMLElement, 'ArrowLeft');
    expect(a?.getAttribute('aria-valuenow')).toBe('8');
    press(a as HTMLElement, 'ArrowRight');
    expect(a?.getAttribute('aria-valuenow')).toBe('9');
    m.unmount();
  });

  it('stop at the ends, jump ten with Shift, and go to the ends with Home and End', () => {
    const m = mount(<Pair model={chainModel(dto())} />);
    const [a] = sliders(m.container);
    press(a as HTMLElement, 'Home');
    expect(a?.getAttribute('aria-valuenow')).toBe('0');
    press(a as HTMLElement, 'ArrowLeft');
    expect(a?.getAttribute('aria-valuenow')).toBe('0');
    press(a as HTMLElement, 'ArrowRight', { shiftKey: true });
    expect(a?.getAttribute('aria-valuenow')).toBe('9');
    press(a as HTMLElement, 'End');
    expect(a?.getAttribute('aria-valuenow')).toBe('9');
    press(a as HTMLElement, 'ArrowRight');
    expect(a?.getAttribute('aria-valuenow')).toBe('9');
    press(a as HTMLElement, 'PageUp');
    expect(a?.getAttribute('aria-valuenow')).toBe('8');
    m.unmount();
  });

  it('show a tooltip on the chart being read and a crosshair on both', () => {
    const m = mount(<Pair model={chainModel(dto())} />);
    expect(tips(m.container)).toHaveLength(0);
    expect(crosses(m.container)).toBe(0);
    const [a] = sliders(m.container);
    press(a as HTMLElement, 'Home');
    const [tip] = tips(m.container);
    expect(tips(m.container)).toHaveLength(1);
    expect(tip?.closest('[data-chart]')?.getAttribute('data-chart')).toBe('difficulty');
    expect(crosses(m.container)).toBe(2);
    expect(tip?.textContent).toContain('2026-09-30 12:00 UTC');
    expect(tip?.textContent).toContain('Block 2,999,000');
    expect(tip?.textContent).toContain('Difficulty');
    expect(tip?.textContent).toContain('0.350');
    expect(tip?.textContent).toContain('Block time');
    expect(tip?.textContent).toContain('30.0 s');
    m.unmount();
  });

  it('end a reading with Escape, and let Escape through when there is none', () => {
    const m = mount(<Pair model={chainModel(dto())} />);
    const [a] = sliders(m.container);
    const seen = vi.fn();
    document.addEventListener('keydown', seen);
    press(a as HTMLElement, 'Escape');
    expect(seen).toHaveBeenCalledTimes(1);
    press(a as HTMLElement, 'ArrowLeft');
    expect(tips(m.container)).toHaveLength(1);
    seen.mockClear();
    press(a as HTMLElement, 'Escape');
    expect(seen).not.toHaveBeenCalled();
    expect(tips(m.container)).toHaveLength(0);
    expect(crosses(m.container)).toBe(0);
    expect(a?.getAttribute('aria-valuetext')).toBe(chainModel(dto()).summary.difficulty);
    document.removeEventListener('keydown', seen);
    m.unmount();
  });

  it('read with the pointer, and drop the reading when a mouse leaves but not when a finger lifts', () => {
    const model = chainModel(dto());
    const m = mount(<Pair model={model} />);
    const [a] = sliders(m.container);
    const [lo, hi] = model.domain;
    // Where bucket i sits on the page: the plot's left edge plus its share of the window.
    const over = (i: number) => PLOT_MARGIN.left + (((model.frame.t[i] ?? 0) - lo) / (hi - lo)) * PLOT_W;
    const send = (type: string, clientX: number, pointerType: string) => {
      const e = new MouseEvent(type, { clientX, bubbles: true });
      Object.defineProperty(e, 'pointerType', { value: pointerType });
      act(() => {
        a?.dispatchEvent(e);
      });
    };
    send('pointermove', over(3) + 2, 'mouse');
    expect(a?.getAttribute('aria-valuenow')).toBe('3');
    expect(tips(m.container)).toHaveLength(1);
    send('pointermove', over(7) - 2, 'mouse');
    expect(a?.getAttribute('aria-valuenow')).toBe('7');
    // React derives onPointerLeave from pointerout, so that is the event the browser sends it.
    send('pointerout', over(7), 'mouse');
    expect(tips(m.container)).toHaveLength(0);
    expect(crosses(m.container)).toBe(0);
    send('pointerdown', over(5), 'touch');
    expect(a?.getAttribute('aria-valuenow')).toBe('5');
    send('pointerout', over(5), 'touch');
    expect(tips(m.container)).toHaveLength(1);
    expect(crosses(m.container)).toBe(2);
    m.unmount();
  });
});

describe('a new window', () => {
  it('starts with nothing under either crosshair, even when a finger had left a reading on a plot', () => {
    const m = mount(<Pair model={chainModel(dto())} />);
    const [a] = sliders(m.container);
    const touch = new MouseEvent('pointerdown', { clientX: PLOT_MARGIN.left + 100, bubbles: true });
    Object.defineProperty(touch, 'pointerType', { value: 'touch' });
    act(() => {
      a?.dispatchEvent(touch);
    });
    expect(crosses(m.container)).toBe(2);
    m.rerender(<Pair model={chainModel(dto({ window: '7d' }))} />);
    expect(crosses(m.container)).toBe(0);
    expect(tips(m.container)).toHaveLength(0);
    m.unmount();
  });

  it('keeps a reading through a refresh of the same window', () => {
    const m = mount(<Pair model={chainModel(dto())} />);
    const [a] = sliders(m.container);
    press(a as HTMLElement, 'Home');
    expect(crosses(m.container)).toBe(2);
    m.rerender(<Pair model={chainModel(dto({ latest_height: 2_999_040 }))} />);
    expect(crosses(m.container)).toBe(2);
    m.unmount();
  });
});

describe('time per block', () => {
  const fig = (c: HTMLElement) => c.querySelector('[data-chart="block-time"]') as HTMLElement;

  it('draws the line, the target and, in a short window, the band of longest gaps', () => {
    const m = mount(<Pair model={chainModel(dto())} />);
    const f = fig(m.container);
    expect(f.querySelector('.cp-line')).not.toBeNull();
    expect(f.querySelector('.cp-target')).not.toBeNull();
    expect(f.querySelector('.cp-band')).not.toBeNull();
    m.unmount();
  });

  it('leaves out the band in a long window, where a bucket holds thousands of blocks', () => {
    const m = mount(<Pair model={chainModel(dto({ block_count: 1_000_000 }))} />);
    expect(fig(m.container).querySelector('.cp-band')).toBeNull();
    expect(fig(m.container).querySelector('.cp-line')).not.toBeNull();
    m.unmount();
  });

  it('marks the gaps that run off the top of the chart, and only those', () => {
    const model = chainModel(dto());
    const m = mount(<Pair model={model} />);
    // The 11 minute stall is the only bucket above the top of the axis.
    expect(model.above).toBe(1);
    expect(fig(m.container).querySelectorAll('.cp-caret')).toHaveLength(1);
    m.unmount();
  });

  it('marks at most a handful of carets however many buckets run off the chart', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      t_ms: T0 + i * 2 * MIN,
      height: 1 + i,
      difficulty: 0.35,
      block_time_s: 30,
      block_time_max_s: 900 + i,
    }));
    const model = chainModel(dto({ points: many }));
    expect(model.above).toBe(60);
    const m = mount(<BlockTimeChart model={model} cursor={null} onCursor={() => {}} />);
    const carets = m.container.querySelectorAll('.cp-caret').length;
    expect(carets).toBeGreaterThan(0);
    expect(carets).toBeLessThanOrEqual(8);
    m.unmount();
  });

  it('draws the target as a step where the window crosses the fork, and names it', () => {
    const across = dto({
      window: '1y',
      from_ms: FORK_MS - 25 * DAY,
      to_ms: FORK_MS + 340 * DAY,
      points: [
        {
          t_ms: FORK_MS - 10 * DAY,
          height: 1_990_000,
          difficulty: 0.3,
          block_time_s: 120,
          block_time_max_s: null,
        },
        {
          t_ms: FORK_MS + 10 * DAY,
          height: 2_050_000,
          difficulty: 0.3,
          block_time_s: 30,
          block_time_max_s: null,
        },
      ],
    });
    const m = mount(<BlockTimeChart model={chainModel(across)} cursor={null} onCursor={() => {}} />);
    const d = m.container.querySelector('.cp-target')?.getAttribute('d') ?? '';
    // M x0 y0 L x1 y0 L x1 y1 L x2 y1: the third corner is straight under the second.
    const corners = [...d.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map((x) => [Number(x[1]), Number(x[2])]);
    expect(corners).toHaveLength(4);
    expect(corners[1]?.[0]).toBe(corners[2]?.[0]);
    expect(corners[1]?.[1]).toBeLessThan(corners[2]?.[1] ?? 0);
    expect(m.container.querySelector('.cp-era text')?.textContent).toBe('Proof of Node');
    m.unmount();
  });

  it('tells the tooltip the target, and the longest gap with the caret key when it is off the chart', () => {
    const m = mount(<Pair model={chainModel(dto())} />);
    const [, b] = sliders(m.container);
    press(b as HTMLElement, 'Home');
    for (let i = 0; i < 6; i++) press(b as HTMLElement, 'ArrowRight');
    const tip = fig(m.container).querySelector('.cp-tip');
    expect(tip?.textContent).toContain('Longest gap');
    expect(tip?.textContent).toContain('11m');
    expect(tip?.textContent).toContain('Target');
    expect(tip?.textContent).toContain('30 s');
    expect(tip?.querySelector('.cp-key[data-caret]')).not.toBeNull();
    expect(tip?.querySelector('.cp-key[data-dashed]')).not.toBeNull();
    m.unmount();
  });

  it('keeps one series on: any can be hidden from the legend, but not the last', () => {
    const m = mount(<Pair model={chainModel(dto())} />);
    const buttons = [...fig(m.container).querySelectorAll<HTMLButtonElement>('.cp-legend-item')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Average', 'Target', 'Longest gap']);
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'true', 'true']);
    click(buttons[2] as HTMLElement);
    expect(fig(m.container).querySelector('.cp-band')).toBeNull();
    expect(fig(m.container).querySelectorAll('.cp-caret')).toHaveLength(0);
    click(buttons[1] as HTMLElement);
    expect(fig(m.container).querySelector('.cp-target')).toBeNull();
    click(buttons[0] as HTMLElement);
    // Average is the last one on: it stays.
    expect(buttons[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(fig(m.container).querySelector('.cp-line')).not.toBeNull();
    click(buttons[1] as HTMLElement);
    expect(fig(m.container).querySelector('.cp-target')).not.toBeNull();
    m.unmount();
  });

  it('has no legend entry for a longest gap the server did not give, or a target it did not give', () => {
    const none = dto({
      targets: [],
      target_block_time_s: Number.NaN,
      points: points().map((p) => ({ ...p, block_time_max_s: null })),
    });
    const m = mount(<BlockTimeChart model={chainModel(none)} cursor={null} onCursor={() => {}} />);
    expect([...m.container.querySelectorAll('.cp-legend-item')].map((b) => b.textContent)).toEqual([
      'Average',
    ]);
    m.unmount();
  });
});

describe('the data table', () => {
  it('carries the same numbers as text, newest first, with Unknown where there is no value', () => {
    const m = mount(<Pair model={chainModel(dto())} />);
    const f = m.container.querySelector('[data-chart="block-time"]') as HTMLElement;
    expect(f.querySelector('table')).toBeNull();
    const toggle = [...f.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Show data',
    );
    click(toggle as HTMLElement);
    const heads = [...f.querySelectorAll('thead th')].map((h) => h.textContent);
    expect(heads).toEqual(['Time', 'Block', 'Block time', 'Longest gap', 'Target']);
    const rows = [...f.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(10);
    expect(rows[0]?.querySelector('th')?.textContent).toBe('2026-09-30 12:18 UTC');
    expect(rows[1]?.textContent).toContain('Unknown');
    expect(rows[1]?.querySelector('td.cp-unknown')?.textContent).toBe('Unknown');
    expect(f.querySelector('caption')?.textContent).toContain('Newest first.');
    click(toggle as HTMLElement);
    expect(f.querySelector('table')).toBeNull();
    m.unmount();
  });

  it('shows an unknown difficulty as Unknown in the difficulty chart', () => {
    const m = mount(<Pair model={chainModel(dto())} />);
    const f = m.container.querySelector('[data-chart="difficulty"]') as HTMLElement;
    click(
      [...f.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent === 'Show data',
      ) as HTMLElement,
    );
    expect(
      [...f.querySelectorAll('tbody tr')].map((r) => r.querySelectorAll('td')[1]?.textContent),
    ).toContain('Unknown');
    m.unmount();
  });
});

describe('difficulty', () => {
  it('breaks the line at a bucket with no value instead of drawing through it', () => {
    const m = mount(<DifficultyChart model={chainModel(dto())} cursor={null} onCursor={() => {}} />);
    const d = m.container.querySelector('.cp-line')?.getAttribute('d') ?? '';
    // One bucket has no difficulty: two runs, so two subpaths.
    expect(d.match(/M/g)).toHaveLength(2);
    m.unmount();
  });
});
