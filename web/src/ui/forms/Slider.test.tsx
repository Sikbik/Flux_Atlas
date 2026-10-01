// @vitest-environment jsdom
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { mount } from '../internal/testing';
import { Slider } from './Slider';
import { setValue } from './testUtils';

const input = (root: HTMLElement) => root.querySelector('input') as HTMLInputElement;
const readout = (root: HTMLElement) => root.querySelector('.ui-slider__value')?.textContent;

describe('Slider', () => {
  it('links the label to a range input and shows a tabular readout', () => {
    const m = mount(<Slider label="Minimum uptime" defaultValue={42} />);
    const el = input(m.container);
    expect(el.type).toBe('range');
    expect(m.container.querySelector('label')?.getAttribute('for')).toBe(el.id);
    expect(readout(m.container)).toBe('42');
    expect(el.getAttribute('aria-valuetext')).toBe('42');
    expect(m.container.querySelector('.ui-slider__value')?.getAttribute('aria-hidden')).toBe('true');
    m.unmount();
  });

  it('groups large whole values and fixes decimals from the step', () => {
    const big = mount(<Slider aria-label="Height" min={0} max={5000000} defaultValue={2996914} />);
    expect(readout(big.container)).toBe('2,996,914');
    big.unmount();
    const fine = mount(<Slider aria-label="Ratio" min={0} max={1} step={0.05} defaultValue={0.25} />);
    expect(readout(fine.container)).toBe('0.25');
    fine.unmount();
  });

  it('formats the readout and the spoken value with valueText', () => {
    const m = mount(
      <Slider aria-label="Uptime" defaultValue={98.5} step={0.5} valueText={(v) => `${v.toFixed(1)}%`} />,
    );
    expect(readout(m.container)).toBe('98.5%');
    expect(input(m.container).getAttribute('aria-valuetext')).toBe('98.5%');
    m.unmount();
  });

  it('reports numbers as the thumb moves', () => {
    const onChange = vi.fn();
    const m = mount(<Slider aria-label="x" defaultValue={10} onChange={onChange} />);
    setValue(input(m.container), '55');
    expect(onChange).toHaveBeenCalledWith(55);
    expect(typeof onChange.mock.calls[0]?.[0]).toBe('number');
    expect(readout(m.container)).toBe('55');
    m.unmount();
  });

  it('follows the value prop when controlled', () => {
    function Controlled() {
      const [v, setV] = useState(20);
      return <Slider aria-label="x" value={v} onChange={(n) => setV(Math.min(n, 60))} />;
    }
    const m = mount(<Controlled />);
    setValue(input(m.container), '90');
    expect(readout(m.container)).toBe('60');
    expect(input(m.container).value).toBe('60');
    m.unmount();
  });

  it('exposes the fill position as a fraction of the range', () => {
    const m = mount(<Slider aria-label="x" min={10} max={20} defaultValue={15} />);
    const control = m.container.querySelector<HTMLElement>('.ui-slider__control');
    expect(control?.style.getPropertyValue('--ui-slider-p')).toBe('0.5');
    m.unmount();
  });

  it('draws marks inside the range, lit up to the value, with labels', () => {
    const m = mount(
      <Slider
        aria-label="x"
        defaultValue={50}
        marks={[0, { value: 50, label: '50' }, { value: 100, label: 'Max' }, 150]}
      />,
    );
    const marks = Array.from(m.container.querySelectorAll<HTMLElement>('.ui-slider__mark'));
    expect(marks).toHaveLength(3);
    expect(marks.map((x) => x.hasAttribute('data-on'))).toEqual([true, true, false]);
    expect(
      Array.from(m.container.querySelectorAll('.ui-slider__mark-label')).map((l) => l.textContent),
    ).toEqual(['50', 'Max']);
    m.unmount();
  });

  it('can hide the readout and disables the input', () => {
    const m = mount(<Slider aria-label="x" hideValue disabled />);
    expect(m.container.querySelector('.ui-slider__value')).toBeNull();
    expect(input(m.container).disabled).toBe(true);
    m.unmount();
  });
});
