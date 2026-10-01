// @vitest-environment jsdom
import { Blocks, Server } from 'lucide-react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { click, mount, press } from '../internal/testing';
import { SegmentedControl, type SegmentedOption } from './SegmentedControl';

const OPTIONS: readonly SegmentedOption[] = [
  { value: 'all', label: 'All' },
  { value: 'blocks', label: 'Blocks', icon: Blocks },
  { value: 'nodes', label: 'Nodes', icon: Server, disabled: true },
  { value: 'apps', label: 'Apps' },
  { value: 'mine', label: 'Mine' },
];

function radios(root: HTMLElement): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
}

function Harness({
  start = 'all',
  onChange,
  iconOnly,
  disabled,
}: {
  start?: string;
  onChange?: (v: string) => void;
  iconOnly?: boolean;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(start);
  return (
    <SegmentedControl
      aria-label="Filter"
      options={OPTIONS}
      value={value}
      iconOnly={iconOnly}
      disabled={disabled}
      onChange={(v) => {
        onChange?.(v);
        setValue(v);
      }}
    />
  );
}

describe('SegmentedControl', () => {
  it('renders a labelled radiogroup with the chosen radio and one tab stop', () => {
    const m = mount(<Harness start="apps" />);
    const group = m.container.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute('aria-label')).toBe('Filter');
    const r = radios(m.container);
    expect(r.map((b) => b.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'false',
      'true',
      'false',
    ]);
    expect(r.map((b) => b.tabIndex)).toEqual([-1, -1, -1, 0, -1]);
    m.unmount();
  });

  it('positions the pill from the selected index and the segment count', () => {
    const m = mount(<Harness start="apps" />);
    const group = m.container.querySelector<HTMLElement>('.ui-seg');
    expect(group?.style.getPropertyValue('--ui-seg-i')).toBe('3');
    expect(group?.style.getPropertyValue('--ui-seg-n')).toBe('5');
    m.unmount();
  });

  it('selects with arrow keys in either axis, skipping disabled radios, and wraps', () => {
    const onChange = vi.fn();
    const m = mount(<Harness onChange={onChange} />);
    const active = () => document.activeElement as HTMLElement;
    radios(m.container)[0]?.focus();
    press(active(), 'ArrowRight');
    expect(onChange).toHaveBeenLastCalledWith('blocks');
    press(active(), 'ArrowDown');
    expect(onChange).toHaveBeenLastCalledWith('apps');
    press(active(), 'ArrowUp');
    expect(onChange).toHaveBeenLastCalledWith('blocks');
    press(active(), 'ArrowLeft');
    expect(onChange).toHaveBeenLastCalledWith('all');
    press(active(), 'ArrowLeft');
    expect(onChange).toHaveBeenLastCalledWith('mine');
    m.unmount();
  });

  it('jumps with Home and End', () => {
    const onChange = vi.fn();
    const m = mount(<Harness start="apps" onChange={onChange} />);
    radios(m.container)[3]?.focus();
    press(document.activeElement as HTMLElement, 'Home');
    expect(onChange).toHaveBeenLastCalledWith('all');
    press(document.activeElement as HTMLElement, 'End');
    expect(onChange).toHaveBeenLastCalledWith('mine');
    m.unmount();
  });

  it('reports a click on another radio only', () => {
    const onChange = vi.fn();
    const m = mount(<Harness onChange={onChange} />);
    const r = radios(m.container);
    click(r[0]!);
    click(r[2]!);
    expect(onChange).not.toHaveBeenCalled();
    click(r[3]!);
    expect(onChange).toHaveBeenCalledWith('apps');
    m.unmount();
  });

  it('puts the tab stop on the first enabled radio when the value matches none', () => {
    const m = mount(<Harness start="nope" />);
    const group = m.container.querySelector<HTMLElement>('.ui-seg');
    expect(radios(m.container).map((b) => b.tabIndex)).toEqual([0, -1, -1, -1, -1]);
    expect(group?.hasAttribute('data-empty')).toBe(true);
    m.unmount();
  });

  it('keeps labels as names and tooltips when only icons are shown', () => {
    const m = mount(<Harness iconOnly />);
    const r = radios(m.container);
    expect(r[1]?.getAttribute('aria-label')).toBe('Blocks');
    expect(r[1]?.getAttribute('title')).toBe('Blocks');
    expect(r[1]?.querySelector('.ui-seg__label')).toBeNull();
    // A segment without an icon still shows its label.
    expect(r[0]?.querySelector('.ui-seg__label')?.textContent).toBe('All');
    m.unmount();
  });

  it('disables every radio when the control is disabled', () => {
    const m = mount(<Harness disabled />);
    expect(radios(m.container).every((b) => b.disabled)).toBe(true);
    expect(m.container.querySelector('[role="radiogroup"]')?.getAttribute('aria-disabled')).toBe('true');
    m.unmount();
  });
});
