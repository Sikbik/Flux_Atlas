// @vitest-environment jsdom
import { createRef } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useUi } from '../../store/ui';
import { mount } from '../internal/testing';
import { Meter, type MeterZone } from './Meter';

const rail = (c: HTMLElement) => c.querySelector('.ui-meter__rail') as HTMLElement;
const root = (c: HTMLElement) => c.querySelector('.ui-meter') as HTMLElement;

beforeEach(() => {
  useUi.getState().setMotion('off');
});

describe('Meter reading', () => {
  it('is a meter with the range, the value and the value as text', () => {
    const m = mount(<Meter label="Locked capacity" value={0.625} />);
    const r = rail(m.container);
    expect(r.getAttribute('role')).toBe('meter');
    expect(r.getAttribute('aria-label')).toBe('Locked capacity');
    expect(r.getAttribute('aria-valuemin')).toBe('0');
    expect(r.getAttribute('aria-valuemax')).toBe('1');
    expect(r.getAttribute('aria-valuenow')).toBe('0.625');
    expect(r.getAttribute('aria-valuetext')).toBe('62.5%');
    m.unmount();
  });

  it('reads a range in units as a share of it, and the caller can format it', () => {
    const era = mount(<Meter label="Emission era" value={2_670_000} min={2_020_000} max={3_071_200} />);
    expect(rail(era.container).getAttribute('aria-valuenow')).toBe('2670000');
    expect(rail(era.container).getAttribute('aria-valuetext')).toBe('61.8%');
    expect(
      era.container.querySelector<HTMLElement>('.ui-meter__fill')?.style.getPropertyValue('--ui-meter-frac'),
    ).toBe(String((2_670_000 - 2_020_000) / (3_071_200 - 2_020_000)));
    era.unmount();
    const custom = mount(
      <Meter label="Blocks" value={50} min={0} max={200} format={(v) => `${v} of 200 blocks`} />,
    );
    expect(rail(custom.container).getAttribute('aria-valuetext')).toBe('50 of 200 blocks');
    custom.unmount();
  });

  it('keeps aria-valuenow inside the range and draws a full or no fill at the extremes', () => {
    const over = mount(<Meter label="x" value={7} max={5} />);
    expect(rail(over.container).getAttribute('aria-valuenow')).toBe('5');
    expect(
      over.container.querySelector<HTMLElement>('.ui-meter__fill')?.style.getPropertyValue('--ui-meter-frac'),
    ).toBe('1');
    over.unmount();
    const zero = mount(<Meter label="x" value={0} />);
    expect(zero.container.querySelector('.ui-meter__fill')).toBeNull();
    expect(rail(zero.container).getAttribute('role')).toBe('meter');
    zero.unmount();
  });

  it('shows an unknown reading as the word Unknown on an empty track, never as zero', () => {
    const m = mount(<Meter label="Locked capacity" value={null} />);
    const r = rail(m.container);
    expect(r.getAttribute('role')).toBe('img');
    expect(r.getAttribute('aria-label')).toBe('Locked capacity: Unknown');
    expect(r.hasAttribute('aria-valuenow')).toBe(false);
    expect(root(m.container).getAttribute('data-state')).toBe('unknown');
    expect(m.container.querySelector('.ui-meter__fill')).toBeNull();
    expect(m.container.querySelector('.ui-meter__value')?.textContent).toBe('Unknown');
    m.unmount();
  });

  it('is quiet by default and shows the label and reading above the track on request', () => {
    const quiet = mount(<Meter label="Locked" value={0.5} />);
    expect(quiet.container.querySelector('.ui-meter__head')).toBeNull();
    quiet.unmount();
    const full = mount(<Meter label="Locked" value={0.5} showLabel showValue />);
    expect(full.container.querySelector('.ui-meter__label')?.textContent).toBe('Locked');
    expect(full.container.querySelector('.ui-meter__value')?.textContent).toBe('50.0%');
    full.unmount();
  });

  it('paints the fill from the tone and sizes the track', () => {
    const m = mount(<Meter label="x" value={0.4} tone="warn" size="lg" />);
    expect(rail(m.container).style.getPropertyValue('--ui-meter-c')).toBe('var(--status-warn)');
    expect(root(m.container).getAttribute('data-size')).toBe('lg');
    expect(root(m.container).getAttribute('data-tone')).toBe('warn');
    m.unmount();
  });

  it('shows start, middle and end labels under the track', () => {
    const m = mount(
      <Meter label="x" value={0.4} startLabel="2,020,000" midLabel="2,545,600" endLabel="3,071,200" />,
    );
    const ends = Array.from(m.container.querySelectorAll('.ui-meter__end')).map((e) => e.textContent);
    expect(ends).toEqual(['2,020,000', '2,545,600', '3,071,200']);
    m.unmount();
  });

  it('puts a fixed notch at a position in the range, with a title', () => {
    const m = mount(<Meter label="x" value={0.4} marker={0.8} markerLabel="Target" />);
    const mark = m.container.querySelector('.ui-meter__marker') as HTMLElement;
    expect(mark.style.getPropertyValue('--ui-meter-at')).toBe('0.8');
    expect(mark.getAttribute('title')).toBe('Target');
    expect(root(m.container).hasAttribute('data-marker')).toBe(true);
    m.unmount();
  });
});

describe('Meter zones', () => {
  const zones: MeterZone[] = [
    { from: 0, to: 0.5, tone: 'ok', label: 'Healthy' },
    { from: 0.5, to: 0.8, tone: 'warn', label: 'Due' },
    { from: 0.8, to: 1, tone: 'crit', label: 'At risk' },
  ];

  it('draws the bands, lights the one the reading is in and marks the reading with a notch instead of a fill', () => {
    const m = mount(<Meter label="Check-in" value={0.62} zones={zones} />);
    const bands = Array.from(m.container.querySelectorAll<HTMLElement>('.ui-meter__zone'));
    expect(bands.map((b) => b.getAttribute('data-tone'))).toEqual(['ok', 'warn', 'crit']);
    expect(bands.map((b) => b.hasAttribute('data-current'))).toEqual([false, true, false]);
    expect(m.container.querySelector('.ui-meter__fill')).toBeNull();
    const notch = m.container.querySelector('.ui-meter__marker[data-reading]') as HTMLElement;
    expect(notch.style.getPropertyValue('--ui-meter-at')).toBe('0.62');
    expect(root(m.container).getAttribute('data-zone')).toBe('warn');
    m.unmount();
  });

  it('says the zone in words under the gauge and in the value text, so colour is never alone', () => {
    const m = mount(<Meter label="Check-in" value={0.62} zones={zones} />);
    const words = Array.from(m.container.querySelectorAll('.ui-meter__zone-label'));
    expect(words.map((w) => w.textContent)).toEqual(['Healthy', 'Due', 'At risk']);
    expect(words.map((w) => w.hasAttribute('data-current'))).toEqual([false, true, false]);
    expect(rail(m.container).getAttribute('aria-valuetext')).toBe('62.0%: Due');
    m.unmount();
  });

  it('leaves the gauge without a notch or a lit zone when the reading is unknown', () => {
    const m = mount(<Meter label="Check-in" value={null} zones={zones} />);
    expect(m.container.querySelector('.ui-meter__marker')).toBeNull();
    expect(m.container.querySelector('.ui-meter__zone[data-current]')).toBeNull();
    expect(root(m.container).hasAttribute('data-zone')).toBe(false);
    m.unmount();
  });
});

describe('Meter states and attach points', () => {
  it('shows a busy skeleton while loading', () => {
    const m = mount(<Meter label="x" value={0.3} loading />);
    expect(root(m.container).getAttribute('data-state')).toBe('loading');
    expect(root(m.container).getAttribute('aria-busy')).toBe('true');
    expect(m.container.querySelector('[role="meter"]')).toBeNull();
    m.unmount();
  });

  it('forwards ref, className, style and other attributes to the root', () => {
    const ref = createRef<HTMLDivElement>();
    const m = mount(
      <Meter ref={ref} label="x" value={0.3} className="mine" style={{ width: 200 }} id="era" />,
    );
    expect(ref.current).toBe(root(m.container));
    expect(root(m.container).classList.contains('mine')).toBe(true);
    expect(root(m.container).style.width).toBe('200px');
    expect(root(m.container).id).toBe('era');
    expect(root(m.container).getAttribute('data-state')).toBe('ready');
    m.unmount();
  });
});
